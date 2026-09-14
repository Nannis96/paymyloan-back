import { Prisma } from "@prisma/client";
import type { Session } from "@/middlewares/withAuth";
import { requireContractAccess } from "@/middlewares/requireContractAccess";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import type { RequestMeta } from "@/lib/requestMeta";
import { calculateAccruedInterest, generateAmortizationSchedule, regenerateScheduleAfterTermsChange } from "@/services/amortization.service";
import type {
  AddContractBorrowerInput,
  CancelContractInput,
  CreateContractInput,
  ListContractsQuery,
  ProposeContractTermsInput,
  RejectContractTermsInput,
  UpdateContractInput,
} from "@/validations/contracts.validation";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";

const contractInclude = {
  property: true,
  currentTerms: { include: { feeItems: true } },
  borrowers: { where: { removedAt: null } },
} satisfies Prisma.ContractInclude;

export type ContractDetail = Prisma.ContractGetPayload<{ include: typeof contractInclude }>;

// D-P6-1 (mismo patrón que BE-045/D-P4-1 y PB-017/D-S2-20): resuelve "¿es
// mío?" contra TODAS las LenderCompany del Lender — sin `withTenantScope`
// (descartado).
interface OwnedLenderCompany {
  id: string;
}

async function requireOwnedLenderCompanies(userId: string): Promise<OwnedLenderCompany[]> {
  const profile = await prisma.lenderProfile.findUnique({
    where: { userId },
    include: { lenderCompanies: { where: { deletedAt: null }, select: { id: true } } },
  });
  if (!profile || profile.deletedAt) {
    throw new AppError("Lender profile not found", 404, "LENDER_NOT_FOUND");
  }
  return profile.lenderCompanies;
}

async function resolveTargetLenderCompanyId(userId: string, requestedId: string | undefined): Promise<string> {
  const companies = await requireOwnedLenderCompanies(userId);
  if (companies.length === 0) {
    throw new AppError("You don't have any company registered yet", 409, "NO_LENDER_COMPANY");
  }
  if (requestedId) {
    const match = companies.find((company) => company.id === requestedId);
    if (!match) {
      throw new AppError("Company not found", 404, "NOT_FOUND");
    }
    return match.id;
  }
  if (companies.length === 1) {
    return companies[0].id;
  }
  throw new AppError("You have more than one company — specify lenderCompanyId", 400, "LENDER_COMPANY_REQUIRED");
}

// BE-051. `PML-{año}-{secuencial de 6 dígitos}` (08-contratos.md §8.2).
// Nota: el secuencial cuenta filas existentes dentro de la misma
// transacción — sin tabla de secuencia dedicada, dos creaciones
// concurrentes en el mismo año podrían chocar contra el `@unique` de
// contractNumber (caso no contemplado por ningún ticket de esta fase).
async function generateContractNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `PML-${year}-`;
  const count = await tx.contract.count({ where: { contractNumber: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(6, "0")}`;
}

async function requireActiveLenderBorrowers(lenderCompanyId: string, borrowerProfileIds: string[]): Promise<void> {
  if (borrowerProfileIds.length === 0) return;
  const links = await prisma.lenderBorrower.findMany({
    where: { lenderCompanyId, borrowerProfileId: { in: borrowerProfileIds }, status: "ACTIVE" },
    select: { borrowerProfileId: true },
  });
  if (links.length !== new Set(borrowerProfileIds).size) {
    throw new AppError("Borrower not found", 404, "NOT_FOUND");
  }
}

// D-S2-5/D-S2-21 (Fase 13): un Contract MARKETPLACE siempre tiene exactamente
// un ContractFeeItem(MARKETPLACE_CONNECTION) en cada versión de sus
// ContractTerms — 1pt del principal vigente, mínimo $999. Reutilizado por
// createContractFromLoanQuote (v1) y proposeContractTerms (versiones
// posteriores, D-S2-19 nota de BE-060).
async function insertMarketplaceConnectionFee(tx: Prisma.TransactionClient, contractTermsId: string, principalAmount: Prisma.Decimal | number): Promise<void> {
  const principal = principalAmount instanceof Prisma.Decimal ? principalAmount : new Prisma.Decimal(principalAmount);
  const computedAmount = Prisma.Decimal.max(principal.times(0.01), 999);
  await tx.contractFeeItem.create({
    data: {
      contractTermsId,
      category: "PLATFORM",
      code: "MARKETPLACE_CONNECTION",
      label: "Marketplace Connection Fee",
      amountType: "PERCENTAGE",
      amountValue: 1,
      computedAmount,
    },
  });
}

// Núcleo compartido por BE-051 (creación directa, crea su propia Property) y
// createContractFromLoanQuote (Fase 13, reutiliza la Property del
// LoanRequest) — ambos terminan en el mismo Contract+ContractTerms v1.
async function createContractCore(
  tx: Prisma.TransactionClient,
  params: {
    lenderCompanyId: string;
    propertyId: string;
    insuranceCompanyId?: string;
    createdByUserId: string;
    terms: CreateContractInput["terms"];
    originationSource?: "DIRECT" | "MARKETPLACE" | "PRIVATE_INVITE";
    loanRequestId?: string;
    borrowerProfileIds?: string[];
  },
): Promise<string> {
  const contractNumber = await generateContractNumber(tx);
  const contract = await tx.contract.create({
    data: {
      lenderCompanyId: params.lenderCompanyId,
      propertyId: params.propertyId,
      insuranceCompanyId: params.insuranceCompanyId,
      contractNumber,
      createdByUserId: params.createdByUserId,
      originationSource: params.originationSource ?? "DIRECT",
      loanRequestId: params.loanRequestId,
    },
  });

  const terms = await tx.contractTerms.create({
    data: { ...params.terms, contractId: contract.id, versionNumber: 1, createdByUserId: params.createdByUserId },
  });

  await tx.contract.update({ where: { id: contract.id }, data: { currentTermsId: terms.id } });

  const borrowerProfileIds = params.borrowerProfileIds ?? [];
  if (borrowerProfileIds.length > 0) {
    await tx.contractBorrower.createMany({
      data: borrowerProfileIds.map((borrowerProfileId, index) => ({
        contractId: contract.id,
        borrowerProfileId,
        isPrimary: index === 0,
        addedByUserId: params.createdByUserId,
      })),
    });
  }

  if (params.originationSource === "MARKETPLACE") {
    await insertMarketplaceConnectionFee(tx, terms.id, params.terms.principalAmount);
  }

  return contract.id;
}

// BE-051. Crea Property (D-P6-2, sin endpoint propio) + Contract(DRAFT) +
// ContractTerms(v1, DRAFT) en una sola $transaction (08-contratos.md §8.2).
export async function createContract(userId: string, input: CreateContractInput): Promise<ContractDetail> {
  const lenderCompanyId = await resolveTargetLenderCompanyId(userId, input.lenderCompanyId);

  if (input.insuranceCompanyId) {
    const insuranceCompany = await prisma.insuranceCompanyProfile.findUnique({ where: { id: input.insuranceCompanyId } });
    if (!insuranceCompany || insuranceCompany.deletedAt) {
      throw new AppError("Insurance company not found", 404, "NOT_FOUND");
    }
  }

  const borrowerProfileIds = input.borrowerProfileIds ?? [];
  await requireActiveLenderBorrowers(lenderCompanyId, borrowerProfileIds);

  const contractId = await prisma.$transaction(async (tx) => {
    const property = await tx.property.create({
      data: { ...input.property, lenderCompanyId, createdByUserId: userId },
    });

    return createContractCore(tx, {
      lenderCompanyId,
      propertyId: property.id,
      insuranceCompanyId: input.insuranceCompanyId,
      createdByUserId: userId,
      terms: input.terms,
      borrowerProfileIds,
    });
  });

  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });

  await logAuditEvent({
    action: "CONTRACT_CREATED",
    entityType: "Contract",
    entityId: contract.id,
    actorUserId: userId,
    lenderCompanyId,
    contractId: contract.id,
  });

  return contract;
}

// BE-052. LENDER ve todas sus LenderCompany (D-P4-1); BORROWER ve donde es
// ContractBorrower activo.
export async function listContracts(session: Session, query: ListContractsQuery): Promise<PaginatedResult<ContractDetail>> {
  let where: Prisma.ContractWhereInput;
  if (session.role === "LENDER") {
    const companyIds = (await requireOwnedLenderCompanies(session.userId)).map((company) => company.id);
    if (companyIds.length === 0) return buildPaginatedResult([], 0, query);
    where = { lenderCompanyId: { in: companyIds }, deletedAt: null };
  } else if (session.role === "BORROWER") {
    const borrowerProfile = await prisma.borrowerProfile.findUnique({ where: { userId: session.userId } });
    if (!borrowerProfile) return buildPaginatedResult([], 0, query);
    where = { deletedAt: null, borrowers: { some: { borrowerProfileId: borrowerProfile.id, removedAt: null } } };
  } else {
    throw new AppError("You do not have permission for this operation", 403, "FORBIDDEN");
  }
  if (query.status) where.status = query.status;

  const [total, contracts] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.findMany({
      where,
      include: contractInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return buildPaginatedResult(contracts, total, query);
}

// BE-053.
export async function getContract(session: Session, contractId: string): Promise<ContractDetail> {
  await requireContractAccess(session, contractId);
  return prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
}

// BE-054. `terms` solo aplica si la vigente está DRAFT; property/
// insuranceCompanyId son editables en cualquier estado (08-contratos.md
// §8.2).
export async function updateContract(userId: string, contractId: string, input: UpdateContractInput): Promise<ContractDetail> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);

  if (input.terms) {
    if (!contract.currentTermsId) {
      throw new AppError("Contract has no current terms", 409, "NO_CURRENT_TERMS");
    }
    const currentTerms = await prisma.contractTerms.findUniqueOrThrow({ where: { id: contract.currentTermsId } });
    if (currentTerms.status !== "DRAFT") {
      throw new AppError("Financial terms can only be edited while the current version is DRAFT — propose a new version instead", 409, "TERMS_NOT_EDITABLE");
    }
    await prisma.contractTerms.update({ where: { id: currentTerms.id }, data: input.terms });
  }

  if (input.property) {
    await prisma.property.update({ where: { id: contract.propertyId }, data: input.property });
  }

  if (input.insuranceCompanyId !== undefined) {
    if (input.insuranceCompanyId) {
      const insuranceCompany = await prisma.insuranceCompanyProfile.findUnique({ where: { id: input.insuranceCompanyId } });
      if (!insuranceCompany || insuranceCompany.deletedAt) {
        throw new AppError("Insurance company not found", 404, "NOT_FOUND");
      }
    }
    await prisma.contract.update({ where: { id: contractId }, data: { insuranceCompanyId: input.insuranceCompanyId } });
  }

  await logAuditEvent({ action: "CONTRACT_UPDATED", entityType: "Contract", entityId: contractId, actorUserId: userId, lenderCompanyId: contract.lenderCompanyId, contractId });

  return prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
}

// BE-055 (08-contratos.md §8.1): solo DRAFT sin ninguna Transaction.
export async function deleteContract(userId: string, contractId: string): Promise<void> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);
  if (contract.status !== "DRAFT") {
    throw new AppError("Only DRAFT contracts can be deleted", 409, "CONTRACT_NOT_DELETABLE");
  }
  const transactionCount = await prisma.transaction.count({ where: { contractId } });
  if (transactionCount > 0) {
    throw new AppError("Cannot delete a contract with transactions", 409, "CONTRACT_HAS_TRANSACTIONS");
  }

  await prisma.contract.update({ where: { id: contractId }, data: { deletedAt: new Date() } });
  await logAuditEvent({ action: "CONTRACT_DELETED", entityType: "Contract", entityId: contractId, actorUserId: userId, lenderCompanyId: contract.lenderCompanyId, contractId });
}

// BE-056 (08-contratos.md §8.1): permitido en PENDING_ACCEPTANCE o ACTIVE;
// nunca borra ScheduledPayment/Transaction existentes.
export async function cancelContract(userId: string, contractId: string, input: CancelContractInput): Promise<ContractDetail> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);
  if (contract.status !== "PENDING_ACCEPTANCE" && contract.status !== "ACTIVE" && contract.status !== "DELINQUENT") {
    throw new AppError("Contract cannot be cancelled from its current status", 409, "CONTRACT_NOT_CANCELLABLE");
  }

  await prisma.contract.update({ where: { id: contractId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await logAuditEvent({
    action: "CONTRACT_CANCELLED",
    entityType: "Contract",
    entityId: contractId,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId,
    metadata: { reason: input.reason },
  });

  return prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
}

// BE-057. `borrowerProfile` debe estar vinculado (LenderBorrower ACTIVE) a
// la LenderCompany del contrato — regla corregida en
// 07-autenticacion-y-autorizacion.md §7.5 punto 4 (ya no compara un
// `borrowerProfile.lenderId` que no existe desde D-P1-4). PK compuesta:
// "agregar" a alguien ya removido reactiva la misma fila en vez de duplicar.
export async function addContractBorrower(userId: string, contractId: string, input: AddContractBorrowerInput): Promise<ContractDetail> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);
  await requireActiveLenderBorrowers(contract.lenderCompanyId, [input.borrowerProfileId]);

  const existing = await prisma.contractBorrower.findUnique({
    where: { contractId_borrowerProfileId: { contractId, borrowerProfileId: input.borrowerProfileId } },
  });
  if (existing && !existing.removedAt) {
    throw new AppError("Borrower already associated with this contract", 409, "ALREADY_ASSOCIATED");
  }

  if (existing) {
    await prisma.contractBorrower.update({
      where: { contractId_borrowerProfileId: { contractId, borrowerProfileId: input.borrowerProfileId } },
      data: { removedAt: null, isPrimary: input.isPrimary ?? existing.isPrimary, addedByUserId: userId, addedAt: new Date() },
    });
  } else {
    await prisma.contractBorrower.create({
      data: { contractId, borrowerProfileId: input.borrowerProfileId, isPrimary: input.isPrimary ?? false, addedByUserId: userId },
    });
  }

  await logAuditEvent({
    action: "CONTRACT_BORROWER_ADDED",
    entityType: "ContractBorrower",
    entityId: input.borrowerProfileId,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId,
  });

  return prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
}

export async function removeContractBorrower(userId: string, contractId: string, borrowerProfileId: string): Promise<void> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);
  const link = await prisma.contractBorrower.findUnique({ where: { contractId_borrowerProfileId: { contractId, borrowerProfileId } } });
  if (!link || link.removedAt) {
    throw new AppError("Borrower not found on this contract", 404, "NOT_FOUND");
  }

  await prisma.contractBorrower.update({ where: { contractId_borrowerProfileId: { contractId, borrowerProfileId } }, data: { removedAt: new Date() } });
  await logAuditEvent({
    action: "CONTRACT_BORROWER_REMOVED",
    entityType: "ContractBorrower",
    entityId: borrowerProfileId,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId,
  });
}

// BE-060 (crear). Solo si la vigente NO está DRAFT (PATCH cubre ese caso) —
// mismo shape completo que la creación, sin copiar fees de la versión
// anterior (nota 2026-09-10 de fase-06-contracts.md). La versión anterior
// pasa a SUPERSEDED de inmediato: a partir de acá "vigente" (currentTermsId)
// significa "lo que está sobre la mesa", no necesariamente lo que gobierna
// el calendario activo (eso lo resuelve acceptContractTerms vía
// `supersedesId`, ver más abajo).
export async function proposeContractTerms(userId: string, contractId: string, input: ProposeContractTermsInput): Promise<ContractDetail> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);
  if (!contract.currentTermsId) {
    throw new AppError("Contract has no current terms", 409, "NO_CURRENT_TERMS");
  }
  const currentTerms = await prisma.contractTerms.findUniqueOrThrow({ where: { id: contract.currentTermsId } });
  if (currentTerms.status === "DRAFT") {
    throw new AppError("The current version is still DRAFT — edit it directly with PATCH /api/contracts/:id instead", 409, "TERMS_STILL_DRAFT");
  }

  await prisma.$transaction(async (tx) => {
    const newTerms = await tx.contractTerms.create({
      data: { ...input, contractId, versionNumber: currentTerms.versionNumber + 1, supersedesId: currentTerms.id, createdByUserId: userId },
    });
    await tx.contractTerms.update({ where: { id: currentTerms.id }, data: { status: "SUPERSEDED" } });
    await tx.contract.update({ where: { id: contractId }, data: { currentTermsId: newTerms.id } });

    // D-S2-5 (Fase 13, PB-017 amplía este ticket): MARKETPLACE_CONNECTION se
    // recalcula en cada versión nueva sobre el principal vigente — no se
    // congela en el monto de la cotización original.
    if (contract.originationSource === "MARKETPLACE") {
      await insertMarketplaceConnectionFee(tx, newTerms.id, input.principalAmount);
    }
  });

  await logAuditEvent({ action: "CONTRACT_TERMS_PROPOSED", entityType: "ContractTerms", entityId: contractId, actorUserId: userId, lenderCompanyId: contract.lenderCompanyId, contractId });

  return prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
}

// BE-060 (submit). DRAFT -> PENDING_ACCEPTANCE, notifica a deudores. Si el
// contrato nunca se activó, también avanza Contract.status (08-contratos.md
// §8.1); si ya está ACTIVE (renegociación), el préstamo sigue sirviéndose
// bajo la versión anterior hasta que esta complete su propio quórum.
export async function submitContractTerms(userId: string, contractId: string, termsId: string): Promise<ContractDetail> {
  const contract = await requireContractAccess({ userId, role: "LENDER" }, contractId);
  const terms = await prisma.contractTerms.findUnique({ where: { id: termsId } });
  if (!terms || terms.contractId !== contractId) {
    throw new AppError("Contract terms not found", 404, "NOT_FOUND");
  }
  if (terms.status !== "DRAFT") {
    throw new AppError("Only DRAFT terms can be submitted", 409, "TERMS_NOT_DRAFT");
  }

  const activeBorrowers = await prisma.contractBorrower.findMany({
    where: { contractId, removedAt: null },
    include: { borrowerProfile: { include: { user: true } } },
  });
  if (activeBorrowers.length === 0) {
    throw new AppError("Contract has no borrowers to notify — add at least one before submitting", 409, "NO_BORROWERS");
  }

  await prisma.$transaction(async (tx) => {
    await tx.contractTerms.update({ where: { id: termsId }, data: { status: "PENDING_ACCEPTANCE" } });
    if (contract.status === "DRAFT") {
      await tx.contract.update({ where: { id: contractId }, data: { status: "PENDING_ACCEPTANCE" } });
    }
  });

  await Promise.all(
    activeBorrowers.map((link) =>
      sendEmail({
        to: link.borrowerProfile.user.email,
        subject: "New loan terms to review",
        template: "terms-updated",
        data: { contractNumber: contract.contractNumber },
      }),
    ),
  );

  await logAuditEvent({ action: "CONTRACT_TERMS_SUBMITTED", entityType: "ContractTerms", entityId: termsId, actorUserId: userId, lenderCompanyId: contract.lenderCompanyId, contractId });

  return prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
}

async function requireBorrowerAssociation(userId: string, contractId: string): Promise<{ borrowerProfileId: string }> {
  const borrowerProfile = await prisma.borrowerProfile.findUnique({ where: { userId } });
  if (!borrowerProfile) {
    throw new AppError("Contract not found", 404, "NOT_FOUND");
  }
  await requireContractAccess({ userId, role: "BORROWER" }, contractId);
  return { borrowerProfileId: borrowerProfile.id };
}

async function requirePendingTerms(contractId: string, termsId: string) {
  const terms = await prisma.contractTerms.findUnique({ where: { id: termsId } });
  if (!terms || terms.contractId !== contractId) {
    throw new AppError("Contract terms not found", 404, "NOT_FOUND");
  }
  if (terms.status !== "PENDING_ACCEPTANCE") {
    throw new AppError("These terms are not awaiting acceptance", 409, "TERMS_NOT_PENDING");
  }
  return terms;
}

// BE-061 (accept). Dispara generateAmortizationSchedule (primera activación)
// o regenerateScheduleAfterTermsChange (renegociación de un contrato ya
// ACTIVE) en la misma transacción en la que se completa el quórum
// (04-base-de-datos.md regla 4).
export async function acceptContractTerms(userId: string, contractId: string, termsId: string, meta: RequestMeta): Promise<ContractDetail> {
  const { borrowerProfileId } = await requireBorrowerAssociation(userId, contractId);
  const terms = await requirePendingTerms(contractId, termsId);

  const existingDecision = await prisma.contractTermsAcceptance.findUnique({
    where: { contractTermsId_borrowerProfileId: { contractTermsId: termsId, borrowerProfileId } },
  });
  if (existingDecision) {
    throw new AppError("You already decided on these terms", 409, "ALREADY_DECIDED");
  }

  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });

  await prisma.$transaction(async (tx) => {
    await tx.contractTermsAcceptance.create({
      data: { contractTermsId: termsId, borrowerProfileId, decision: "ACCEPTED", decidedAt: new Date(), ipAddress: meta.ipAddress, userAgent: meta.userAgent },
    });

    const [activeBorrowerCount, acceptedCount] = await Promise.all([
      tx.contractBorrower.count({ where: { contractId, removedAt: null } }),
      tx.contractTermsAcceptance.count({ where: { contractTermsId: termsId, decision: "ACCEPTED" } }),
    ]);

    if (acceptedCount < activeBorrowerCount) return;

    await tx.contractTerms.update({ where: { id: termsId }, data: { status: "ACCEPTED" } });

    if (!contract.activatedAt) {
      await generateAmortizationSchedule(tx, termsId);
      await tx.contract.update({ where: { id: contractId }, data: { status: "ACTIVE", activatedAt: new Date() } });
      await logAuditEvent({ action: "CONTRACT_ACTIVATED", entityType: "Contract", entityId: contractId, actorUserId: userId, lenderCompanyId: contract.lenderCompanyId, contractId });
    } else if (terms.supersedesId) {
      await regenerateScheduleAfterTermsChange(tx, { previousContractTermsId: terms.supersedesId, newContractTermsId: termsId });
    }
  });

  await logAuditEvent({ action: "CONTRACT_TERMS_ACCEPTED", entityType: "ContractTerms", entityId: termsId, actorUserId: userId, lenderCompanyId: contract.lenderCompanyId, contractId });

  return prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
}

// BE-061 (reject). Un solo rechazo termina la versión — no espera a que
// decidan el resto de los co-deudores (08-contratos.md §8.1).
export async function rejectContractTerms(
  userId: string,
  contractId: string,
  termsId: string,
  input: RejectContractTermsInput,
  meta: RequestMeta,
): Promise<ContractDetail> {
  const { borrowerProfileId } = await requireBorrowerAssociation(userId, contractId);
  await requirePendingTerms(contractId, termsId);

  const existingDecision = await prisma.contractTermsAcceptance.findUnique({
    where: { contractTermsId_borrowerProfileId: { contractTermsId: termsId, borrowerProfileId } },
  });
  if (existingDecision) {
    throw new AppError("You already decided on these terms", 409, "ALREADY_DECIDED");
  }

  const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
  const borrower = await prisma.borrowerProfile.findUniqueOrThrow({ where: { id: borrowerProfileId }, include: { user: true } });

  await prisma.$transaction(async (tx) => {
    await tx.contractTermsAcceptance.create({
      data: {
        contractTermsId: termsId,
        borrowerProfileId,
        decision: "REJECTED",
        decidedAt: new Date(),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        comment: input.comment,
      },
    });
    await tx.contractTerms.update({ where: { id: termsId }, data: { status: "REJECTED" } });
    if (!contract.activatedAt) {
      await tx.contract.update({ where: { id: contractId }, data: { status: "DRAFT" } });
    }
  });

  const lender = await prisma.user.findUnique({ where: { id: contract.createdByUserId } });
  if (lender) {
    await sendEmail({
      to: lender.email,
      subject: `Terms rejected — ${contract.contractNumber}`,
      template: "terms-rejected",
      data: { contractNumber: contract.contractNumber, borrowerName: borrower.user.name, comment: input.comment ?? "" },
    });
  }

  await logAuditEvent({
    action: "CONTRACT_TERMS_REJECTED",
    entityType: "ContractTerms",
    entityId: termsId,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId,
    metadata: { comment: input.comment },
  });

  return prisma.contract.findUniqueOrThrow({ where: { id: contractId }, include: contractInclude });
}

// GET /api/contracts/:id/terms — historial completo, más reciente primero.
export async function listContractTermsHistory(session: Session, contractId: string) {
  await requireContractAccess(session, contractId);
  return prisma.contractTerms.findMany({ where: { contractId }, orderBy: { versionNumber: "desc" }, include: { feeItems: true } });
}

// BE-062.
export async function getSchedule(session: Session, contractId: string) {
  await requireContractAccess(session, contractId);
  return prisma.scheduledPayment.findMany({ where: { contractId }, orderBy: [{ dueDate: "asc" }, { sequenceNumber: "asc" }] });
}

export interface ContractBalance {
  principalBalance: Prisma.Decimal;
  accruedInterestNotYetBilled: Prisma.Decimal;
  nextPaymentDueDate: Date | null;
  asOf: Date;
}

// BE-062. Interés devengado no facturado desde la activación (o el último
// evento conocido) — sin un `Transaction` real todavía (Fase 7), este es el
// mejor ancla disponible; se refina cuando Pagos exista.
export async function getBalance(session: Session, contractId: string): Promise<ContractBalance> {
  const contract = await requireContractAccess(session, contractId);
  const asOf = new Date();

  if (!contract.activatedAt || (contract.status !== "ACTIVE" && contract.status !== "DELINQUENT")) {
    const referenceTerms = contract.currentTermsId ? await prisma.contractTerms.findUnique({ where: { id: contract.currentTermsId } }) : null;
    return {
      principalBalance: referenceTerms?.principalAmount ?? new Prisma.Decimal(0),
      accruedInterestNotYetBilled: new Prisma.Decimal(0),
      nextPaymentDueDate: contract.nextPaymentDueDate,
      asOf,
    };
  }

  const governingTerms = (await prisma.contractTerms.findFirst({ where: { contractId, status: "ACCEPTED" } })) ??
    (await prisma.contractTerms.findUniqueOrThrow({ where: { id: contract.currentTermsId! } }));

  const accruedInterestNotYetBilled = calculateAccruedInterest(
    contract.currentPrincipalBalance ?? governingTerms.principalAmount,
    governingTerms.interestRate,
    governingTerms.dayCountConvention,
    contract.activatedAt,
    asOf,
  );

  return {
    principalBalance: contract.currentPrincipalBalance ?? governingTerms.principalAmount,
    accruedInterestNotYetBilled,
    nextPaymentDueDate: contract.nextPaymentDueDate,
    asOf,
  };
}

// PB-017 (Fase 13, D-S2-21). Llamado por loanQuotes.service.ts#selectQuote,
// dentro de su propia $transaction — reutiliza el mismo núcleo que BE-051
// pero sobre la Property que ya existía en el LoanRequest (no crea una
// nueva) y marca originationSource=MARKETPLACE (inserta
// MARKETPLACE_CONNECTION automáticamente, ver createContractCore).
//
// D-P5-3 (2026-09-13, cierra D-P5-1): con BE-045 deshabilitado, esta es la
// ÚNICA forma en que se crea un vínculo LenderBorrower nuevo — al
// seleccionar una cotización se crea (o reactiva si estaba REMOVED) el
// LenderBorrower entre el Borrower dueño del LoanRequest y la LenderCompany
// ganadora, y se lo asocia como ContractBorrower(isPrimary) del Contract
// recién creado. Antes de este fix, createContractFromLoanQuote no dejaba
// ningún ContractBorrower — el propio Borrower que pidió la cotización no
// podía ver el contrato resultante en GET /api/contracts.
export async function createContractFromLoanQuote(
  tx: Prisma.TransactionClient,
  params: {
    loanRequestId: string;
    propertyId: string;
    lenderCompanyId: string;
    borrowerProfileId: string;
    createdByUserId: string;
    invitedByUserId: string;
    terms: CreateContractInput["terms"];
  },
): Promise<{ contractId: string; lenderBorrowerId: string; lenderBorrowerCreated: boolean }> {
  const existingLink = await tx.lenderBorrower.findUnique({
    where: { lenderCompanyId_borrowerProfileId: { lenderCompanyId: params.lenderCompanyId, borrowerProfileId: params.borrowerProfileId } },
  });

  let lenderBorrowerId: string;
  let lenderBorrowerCreated: boolean;
  if (!existingLink) {
    const link = await tx.lenderBorrower.create({
      data: { lenderCompanyId: params.lenderCompanyId, borrowerProfileId: params.borrowerProfileId, invitedByUserId: params.invitedByUserId },
    });
    lenderBorrowerId = link.id;
    lenderBorrowerCreated = true;
  } else {
    if (existingLink.status !== "ACTIVE") {
      await tx.lenderBorrower.update({ where: { id: existingLink.id }, data: { status: "ACTIVE", removedAt: null } });
    }
    lenderBorrowerId = existingLink.id;
    lenderBorrowerCreated = false;
  }

  const contractId = await createContractCore(tx, {
    lenderCompanyId: params.lenderCompanyId,
    propertyId: params.propertyId,
    createdByUserId: params.createdByUserId,
    terms: params.terms,
    originationSource: "MARKETPLACE",
    loanRequestId: params.loanRequestId,
    borrowerProfileIds: [params.borrowerProfileId],
  });

  return { contractId, lenderBorrowerId, lenderBorrowerCreated };
}
