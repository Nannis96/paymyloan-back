import { Prisma, type BorrowerProfile, type User } from "@prisma/client";
import { generateOpaqueToken } from "@/auth/jwt";
import { hashPassword } from "@/auth/password";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { issueTemporaryPassword } from "@/services/userActivation.service";
import { type SafeUser, toSafeUser } from "@/services/users.service";
import type { CreateBorrowerInput, ListBorrowersQuery, UpdateBorrowerProfileInput } from "@/validations/borrowers.validation";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";

export interface BorrowerListItem {
  id: string;
  user: SafeUser;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** Solo las empresas del Lender que consulta, no todas las que tenga el deudor. */
  lenderCompanies: { id: string; companyName: string }[];
}

interface OwnedLenderCompany {
  id: string;
  companyName: string;
}

// D-P4-1: todas las lecturas/escrituras de este módulo resuelven "¿es mío?"
// contra TODAS las LenderCompany del Lender — no hace falta un selector de
// empresa activa para lo que Fase 5 necesita.
async function requireOwnedLenderCompanies(userId: string): Promise<OwnedLenderCompany[]> {
  const profile = await prisma.lenderProfile.findUnique({
    where: { userId },
    include: { lenderCompanies: { where: { deletedAt: null }, select: { id: true, companyName: true } } },
  });
  if (!profile || profile.deletedAt) {
    throw new AppError("Lender profile not found", 404, "LENDER_NOT_FOUND");
  }
  return profile.lenderCompanies;
}

type BorrowerProfileWithRelations = BorrowerProfile & {
  user: User;
  lenders: { lenderCompany: { id: string; companyName: string } }[];
};

function mapBorrowerListItem(profile: BorrowerProfileWithRelations): BorrowerListItem {
  const { id, phone, addressLine1, city, state, postalCode } = profile;
  return {
    id,
    user: toSafeUser(profile.user),
    phone,
    addressLine1,
    city,
    state,
    postalCode,
    lenderCompanies: profile.lenders.map((link) => link.lenderCompany),
  };
}

// BE-045. Crea User(role=BORROWER)+BorrowerProfile (sin lenderId, D-P1-4) +
// LenderBorrower — activo de inmediato con contraseña temporal por correo,
// nunca en la respuesta (mismo patrón que BE-040). Un `lenderCompanyId`
// ajeno enviado en el body nunca se usa — 404, no se confía en el cliente
// para decidir a qué empresa pertenece (§7.5).
export async function createBorrower(userId: string, input: CreateBorrowerInput): Promise<{ borrower: BorrowerListItem; emailSent: boolean }> {
  const companies = await requireOwnedLenderCompanies(userId);
  if (companies.length === 0) {
    throw new AppError("You don't have any company registered yet", 409, "NO_LENDER_COMPANY");
  }

  let targetCompanyId: string;
  if (input.lenderCompanyId) {
    const match = companies.find((company) => company.id === input.lenderCompanyId);
    if (!match) {
      throw new AppError("Company not found", 404, "NOT_FOUND");
    }
    targetCompanyId = match.id;
  } else if (companies.length === 1) {
    targetCompanyId = companies[0].id;
  } else {
    throw new AppError("You have more than one company — specify lenderCompanyId", 400, "LENDER_COMPANY_REQUIRED");
  }

  const existingEmail = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingEmail) {
    throw new AppError("A user with that email already exists", 409, "EMAIL_TAKEN");
  }

  const placeholderPassword = await hashPassword(generateOpaqueToken());

  const { user, borrowerProfile, link } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, phone: input.phone, password: placeholderPassword, role: "BORROWER", isActive: true },
    });
    const borrowerProfile = await tx.borrowerProfile.create({
      data: { userId: user.id, createdByUserId: userId },
    });
    const link = await tx.lenderBorrower.create({
      data: { lenderCompanyId: targetCompanyId, borrowerProfileId: borrowerProfile.id, invitedByUserId: userId },
    });
    return { user, borrowerProfile, link };
  });

  const { emailSent } = await issueTemporaryPassword(user);

  await logAuditEvent({
    action: "BORROWER_CREATED",
    entityType: "User",
    entityId: user.id,
    actorUserId: userId,
    lenderCompanyId: targetCompanyId,
  });
  await logAuditEvent({
    action: "BORROWER_LINKED_TO_LENDER",
    entityType: "LenderBorrower",
    entityId: link.id,
    actorUserId: userId,
    lenderCompanyId: targetCompanyId,
  });

  const borrower = await getBorrowerForLender(userId, borrowerProfile.id);
  return { borrower, emailSent };
}

// BE-046.
export async function listBorrowers(userId: string, query: ListBorrowersQuery): Promise<PaginatedResult<BorrowerListItem>> {
  const companyIds = (await requireOwnedLenderCompanies(userId)).map((company) => company.id);
  if (companyIds.length === 0) {
    return buildPaginatedResult([], 0, query);
  }

  const where: Prisma.BorrowerProfileWhereInput = {
    deletedAt: null,
    lenders: { some: { lenderCompanyId: { in: companyIds }, status: "ACTIVE" } },
  };
  if (query.search) {
    where.user = {
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
      ],
    };
  }

  const [total, profiles] = await Promise.all([
    prisma.borrowerProfile.count({ where }),
    prisma.borrowerProfile.findMany({
      where,
      include: {
        user: true,
        lenders: { where: { lenderCompanyId: { in: companyIds }, status: "ACTIVE" }, include: { lenderCompany: { select: { id: true, companyName: true } } } },
      },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return buildPaginatedResult(profiles.map(mapBorrowerListItem), total, query);
}

// BE-047. Mismo criterio anti-enumeración que requireContractAccess
// (BE-038): un deudor que existe pero no es mío responde 404, nunca 403.
export async function getBorrowerForLender(userId: string, borrowerProfileId: string): Promise<BorrowerListItem> {
  const companyIds = (await requireOwnedLenderCompanies(userId)).map((company) => company.id);

  const profile = await prisma.borrowerProfile.findUnique({
    where: { id: borrowerProfileId },
    include: {
      user: true,
      lenders: { where: { lenderCompanyId: { in: companyIds }, status: "ACTIVE" }, include: { lenderCompany: { select: { id: true, companyName: true } } } },
    },
  });

  if (!profile || profile.deletedAt || profile.lenders.length === 0) {
    throw new AppError("Borrower not found", 404, "NOT_FOUND");
  }

  return mapBorrowerListItem(profile);
}

// BE-048.
export async function updateBorrower(userId: string, borrowerProfileId: string, input: UpdateBorrowerProfileInput): Promise<BorrowerListItem> {
  await getBorrowerForLender(userId, borrowerProfileId);

  const data: { phone?: string; addressLine1?: string; city?: string; state?: string; postalCode?: string } = {};
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
  if (input.city !== undefined) data.city = input.city;
  if (input.state !== undefined) data.state = input.state;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;

  await prisma.borrowerProfile.update({ where: { id: borrowerProfileId }, data });
  await logAuditEvent({ action: "BORROWER_UPDATED", entityType: "BorrowerProfile", entityId: borrowerProfileId, actorUserId: userId });

  return getBorrowerForLender(userId, borrowerProfileId);
}

// BE-049 (M-3): desvincula (`LenderBorrower.removedAt`), nunca borra el
// BorrowerProfile — el deudor puede tener otros lenders. Bloqueado si tiene
// un contrato ACTIVE/DELINQUENT con alguna de las empresas de las que se
// lo está desvinculando.
export async function removeBorrower(userId: string, borrowerProfileId: string): Promise<void> {
  const companyIds = (await requireOwnedLenderCompanies(userId)).map((company) => company.id);

  const links = await prisma.lenderBorrower.findMany({
    where: { borrowerProfileId, lenderCompanyId: { in: companyIds }, status: "ACTIVE" },
  });
  if (links.length === 0) {
    throw new AppError("Borrower not found", 404, "NOT_FOUND");
  }

  const linkedCompanyIds = links.map((link) => link.lenderCompanyId);
  const blockingContracts = await prisma.contract.count({
    where: {
      lenderCompanyId: { in: linkedCompanyIds },
      status: { in: ["ACTIVE", "DELINQUENT"] },
      borrowers: { some: { borrowerProfileId, removedAt: null } },
    },
  });
  if (blockingContracts > 0) {
    throw new AppError("Cannot unlink: has active or delinquent contracts with this company", 409, "BORROWER_HAS_ACTIVE_CONTRACTS");
  }

  await prisma.lenderBorrower.updateMany({
    where: { id: { in: links.map((link) => link.id) } },
    data: { removedAt: new Date(), status: "REMOVED" },
  });

  await logAuditEvent({ action: "BORROWER_UNLINKED_FROM_LENDER", entityType: "BorrowerProfile", entityId: borrowerProfileId, actorUserId: userId });
}
