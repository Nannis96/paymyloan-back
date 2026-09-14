import { Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import type {
  AddLoanRequestTargetInput,
  CreateLoanRequestInput,
  ListLoanRequestsQuery,
  UpdateLoanRequestInput,
} from "@/validations/loanRequests.validation";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";

const loanRequestInclude = {
  property: true,
  targets: { where: { removedAt: null }, include: { lenderCompany: { select: { id: true, companyName: true } } } },
} satisfies Prisma.LoanRequestInclude;

export type LoanRequestDetail = Prisma.LoanRequestGetPayload<{ include: typeof loanRequestInclude }>;

async function requireBorrowerProfile(userId: string) {
  const profile = await prisma.borrowerProfile.findUnique({ where: { userId } });
  if (!profile || profile.deletedAt) {
    throw new AppError("Borrower profile not found", 404, "BORROWER_NOT_FOUND");
  }
  return profile;
}

async function requireOwnLoanRequest(borrowerProfileId: string, loanRequestId: string): Promise<LoanRequestDetail> {
  const loanRequest = await prisma.loanRequest.findUnique({ where: { id: loanRequestId }, include: loanRequestInclude });
  if (!loanRequest || loanRequest.borrowerProfileId !== borrowerProfileId) {
    throw new AppError("Loan request not found", 404, "NOT_FOUND");
  }
  return loanRequest;
}

// PB-011. Sin endpoint propio de Property (D-P6-2/D-S2-25) — se crea
// embebida, sin LenderCompany todavía (nace null, se backfillea al
// seleccionar una cotización, PB-017/loanQuotes.service.ts).
export async function createLoanRequest(userId: string, input: CreateLoanRequestInput): Promise<LoanRequestDetail> {
  const borrowerProfile = await requireBorrowerProfile(userId);

  const loanRequestId = await prisma.$transaction(async (tx) => {
    const property = await tx.property.create({ data: { ...input.property, createdByUserId: userId } });
    const loanRequest = await tx.loanRequest.create({
      data: {
        borrowerProfileId: borrowerProfile.id,
        propertyId: property.id,
        projectType: input.projectType,
        purchasePrice: input.purchasePrice,
        rehabAmount: input.rehabAmount,
        totalLoanAmountRequested: input.totalLoanAmountRequested,
        requestedClosingDate: input.requestedClosingDate,
        requestedTimelineNotes: input.requestedTimelineNotes,
        visibility: input.visibility,
      },
    });
    return loanRequest.id;
  });

  await logAuditEvent({ action: "LOAN_REQUEST_CREATED", entityType: "LoanRequest", entityId: loanRequestId, actorUserId: userId });

  return prisma.loanRequest.findUniqueOrThrow({ where: { id: loanRequestId }, include: loanRequestInclude });
}

export async function listOwnLoanRequests(userId: string, query: ListLoanRequestsQuery): Promise<PaginatedResult<LoanRequestDetail>> {
  const borrowerProfile = await requireBorrowerProfile(userId);
  const where: Prisma.LoanRequestWhereInput = { borrowerProfileId: borrowerProfile.id };
  if (query.status) where.status = query.status;

  const [total, items] = await Promise.all([
    prisma.loanRequest.count({ where }),
    prisma.loanRequest.findMany({
      where,
      include: loanRequestInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return buildPaginatedResult(items, total, query);
}

export async function getOwnLoanRequest(userId: string, id: string): Promise<LoanRequestDetail> {
  const borrowerProfile = await requireBorrowerProfile(userId);
  return requireOwnLoanRequest(borrowerProfile.id, id);
}

// BE-054-style: editable (property incluida) solo mientras DRAFT.
export async function updateLoanRequest(userId: string, id: string, input: UpdateLoanRequestInput): Promise<LoanRequestDetail> {
  const borrowerProfile = await requireBorrowerProfile(userId);
  const loanRequest = await requireOwnLoanRequest(borrowerProfile.id, id);
  if (loanRequest.status !== "DRAFT") {
    throw new AppError("Loan request can only be edited while DRAFT", 409, "LOAN_REQUEST_NOT_EDITABLE");
  }

  if (input.property) {
    await prisma.property.update({ where: { id: loanRequest.propertyId }, data: input.property });
  }

  const data: Prisma.LoanRequestUpdateInput = {};
  if (input.projectType !== undefined) data.projectType = input.projectType;
  if (input.purchasePrice !== undefined) data.purchasePrice = input.purchasePrice;
  if (input.rehabAmount !== undefined) data.rehabAmount = input.rehabAmount;
  if (input.totalLoanAmountRequested !== undefined) data.totalLoanAmountRequested = input.totalLoanAmountRequested;
  if (input.requestedClosingDate !== undefined) data.requestedClosingDate = input.requestedClosingDate;
  if (input.requestedTimelineNotes !== undefined) data.requestedTimelineNotes = input.requestedTimelineNotes;
  if (Object.keys(data).length > 0) {
    await prisma.loanRequest.update({ where: { id }, data });
  }

  await logAuditEvent({ action: "LOAN_REQUEST_UPDATED", entityType: "LoanRequest", entityId: id, actorUserId: userId });
  return requireOwnLoanRequest(borrowerProfile.id, id);
}

export async function publishLoanRequest(userId: string, id: string): Promise<LoanRequestDetail> {
  const borrowerProfile = await requireBorrowerProfile(userId);
  const loanRequest = await requireOwnLoanRequest(borrowerProfile.id, id);
  if (loanRequest.status !== "DRAFT") {
    throw new AppError("Only DRAFT loan requests can be published", 409, "LOAN_REQUEST_NOT_DRAFT");
  }

  await prisma.loanRequest.update({ where: { id }, data: { status: "PUBLISHED" } });
  await logAuditEvent({ action: "LOAN_REQUEST_PUBLISHED", entityType: "LoanRequest", entityId: id, actorUserId: userId });
  return requireOwnLoanRequest(borrowerProfile.id, id);
}

// PUBLISHED -> WITHDRAWN, en cualquier momento — declina las cotizaciones
// SUBMITTED que hubiera recibido (regla 21 de 04 §4.7, mismo criterio que
// una selección).
export async function withdrawLoanRequest(userId: string, id: string): Promise<LoanRequestDetail> {
  const borrowerProfile = await requireBorrowerProfile(userId);
  const loanRequest = await requireOwnLoanRequest(borrowerProfile.id, id);
  if (loanRequest.status !== "PUBLISHED") {
    throw new AppError("Only PUBLISHED loan requests can be withdrawn", 409, "LOAN_REQUEST_NOT_PUBLISHED");
  }

  await prisma.$transaction([
    prisma.loanRequest.update({ where: { id }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } }),
    prisma.loanQuote.updateMany({ where: { loanRequestId: id, status: "SUBMITTED" }, data: { status: "DECLINED" } }),
  ]);

  await logAuditEvent({ action: "LOAN_REQUEST_WITHDRAWN", entityType: "LoanRequest", entityId: id, actorUserId: userId });
  return requireOwnLoanRequest(borrowerProfile.id, id);
}

// D-S2-22. Reemplaza al viejo invitedLenderCompanyId singular.
export async function addLoanRequestTarget(userId: string, id: string, input: AddLoanRequestTargetInput): Promise<LoanRequestDetail> {
  const borrowerProfile = await requireBorrowerProfile(userId);
  const loanRequest = await requireOwnLoanRequest(borrowerProfile.id, id);
  if (loanRequest.status !== "DRAFT" && loanRequest.status !== "PUBLISHED") {
    throw new AppError("Cannot add targets to a loan request in its current status", 409, "LOAN_REQUEST_NOT_TARGETABLE");
  }

  const lenderCompany = await prisma.lenderCompany.findUnique({ where: { id: input.lenderCompanyId } });
  if (!lenderCompany || lenderCompany.deletedAt) {
    throw new AppError("Lender company not found", 404, "NOT_FOUND");
  }

  const existing = await prisma.loanRequestLenderTarget.findUnique({
    where: { loanRequestId_lenderCompanyId: { loanRequestId: id, lenderCompanyId: input.lenderCompanyId } },
  });
  if (existing && !existing.removedAt) {
    throw new AppError("This lender is already targeted", 409, "ALREADY_TARGETED");
  }

  if (existing) {
    await prisma.loanRequestLenderTarget.update({
      where: { loanRequestId_lenderCompanyId: { loanRequestId: id, lenderCompanyId: input.lenderCompanyId } },
      data: { removedAt: null, invitedByUserId: userId, createdAt: new Date() },
    });
  } else {
    await prisma.loanRequestLenderTarget.create({
      data: { loanRequestId: id, lenderCompanyId: input.lenderCompanyId, invitedByUserId: userId },
    });
  }

  await logAuditEvent({
    action: "LOAN_REQUEST_TARGET_ADDED",
    entityType: "LoanRequestLenderTarget",
    entityId: input.lenderCompanyId,
    actorUserId: userId,
    lenderCompanyId: input.lenderCompanyId,
  });

  return requireOwnLoanRequest(borrowerProfile.id, id);
}

export async function removeLoanRequestTarget(userId: string, id: string, lenderCompanyId: string): Promise<void> {
  const borrowerProfile = await requireBorrowerProfile(userId);
  await requireOwnLoanRequest(borrowerProfile.id, id);

  const target = await prisma.loanRequestLenderTarget.findUnique({
    where: { loanRequestId_lenderCompanyId: { loanRequestId: id, lenderCompanyId } },
  });
  if (!target || target.removedAt) {
    throw new AppError("Target not found", 404, "NOT_FOUND");
  }

  await prisma.loanRequestLenderTarget.update({
    where: { loanRequestId_lenderCompanyId: { loanRequestId: id, lenderCompanyId } },
    data: { removedAt: new Date() },
  });

  await logAuditEvent({
    action: "LOAN_REQUEST_TARGET_REMOVED",
    entityType: "LoanRequestLenderTarget",
    entityId: lenderCompanyId,
    actorUserId: userId,
    lenderCompanyId,
  });
}

async function requireOwnedLenderCompanyIds(userId: string): Promise<string[]> {
  const profile = await prisma.lenderProfile.findUnique({
    where: { userId },
    include: { lenderCompanies: { where: { deletedAt: null }, select: { id: true } } },
  });
  if (!profile || profile.deletedAt) {
    throw new AppError("Lender profile not found", 404, "LENDER_NOT_FOUND");
  }
  return profile.lenderCompanies.map((company) => company.id);
}

// Regla 17 de 04 §4.7: PUBLIC nunca expone borrowerProfileId ni la
// dirección exacta en listados — solo tras seleccionar una cotización. Un
// LoanRequest PRIVATE ya fue compartido a propósito con ese Lender puntual
// (LoanRequestLenderTarget), así que no aplica el enmascarado ahí.
function maskLoanRequestForMarketplace(loanRequest: LoanRequestDetail) {
  if (loanRequest.visibility !== "PUBLIC") return loanRequest;
  return {
    ...loanRequest,
    borrowerProfileId: null as unknown as string,
    property: {
      ...loanRequest.property,
      addressLine1: "",
      addressLine2: null,
      county: null,
      parcelNumber: null,
    },
  };
}

export async function listMarketplaceLoanRequests(userId: string, query: ListLoanRequestsQuery) {
  const companyIds = await requireOwnedLenderCompanyIds(userId);
  const where: Prisma.LoanRequestWhereInput = {
    status: "PUBLISHED",
    OR: [{ visibility: "PUBLIC" }, { targets: { some: { lenderCompanyId: { in: companyIds }, removedAt: null } } }],
  };

  const [total, items] = await Promise.all([
    prisma.loanRequest.count({ where }),
    prisma.loanRequest.findMany({
      where,
      include: loanRequestInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return buildPaginatedResult(items.map(maskLoanRequestForMarketplace), total, query);
}

export async function getMarketplaceLoanRequest(userId: string, id: string) {
  const companyIds = await requireOwnedLenderCompanyIds(userId);
  const loanRequest = await prisma.loanRequest.findUnique({ where: { id }, include: loanRequestInclude });
  if (!loanRequest || loanRequest.status !== "PUBLISHED") {
    throw new AppError("Loan request not found", 404, "NOT_FOUND");
  }
  if (loanRequest.visibility === "PRIVATE") {
    const isTargeted = loanRequest.targets.some((target) => companyIds.includes(target.lenderCompanyId));
    if (!isTargeted) {
      throw new AppError("Loan request not found", 404, "NOT_FOUND");
    }
  }
  return maskLoanRequestForMarketplace(loanRequest);
}
