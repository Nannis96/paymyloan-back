import { Prisma, type LenderCompany, type LenderProfile, type User } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { type SafeUser, toSafeUser } from "@/services/users.service";
import type { CreateLenderCompanyInput, ListLendersQuery, UpdateLenderCompanyInput } from "@/validations/lenders.validation";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";

export interface LenderCompanySummary {
  id: string;
  companyName: string;
  ein: string;
  contactPhone: string | null;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  isOpenToDeals: boolean;
  status: LenderCompany["status"];
}

export interface LenderListItem {
  id: string;
  user: SafeUser;
  lenderCompanies: LenderCompanySummary[];
}

export interface LenderDetail extends LenderListItem {
  borrowersCount: number;
  activeContractsCount: number;
}

function mapLenderCompany(company: LenderCompany): LenderCompanySummary {
  const { id, companyName, ein, contactPhone, addressLine1, addressLine2, city, state, postalCode, isOpenToDeals, status } = company;
  return { id, companyName, ein, contactPhone, addressLine1, addressLine2, city, state, postalCode, isOpenToDeals, status };
}

function mapLenderListItem(profile: LenderProfile & { user: User; lenderCompanies: LenderCompany[] }): LenderListItem {
  return {
    id: profile.id,
    user: toSafeUser(profile.user),
    lenderCompanies: profile.lenderCompanies.map(mapLenderCompany),
  };
}

// D-P4-7: acepta tanto LenderProfile.id como el User.id de la persona — el
// único lugar donde un Admin ve el User.id de un Lender es GET /api/users
// (CRUD genérico de Fase 0), que no expone LenderProfile.id en absoluto. Sin
// esto, ese camino natural para encontrar "el id del Lender" nunca funciona
// contra /api/admin/lenders/:id* (confirmado — reportado como bug).
async function requireLenderProfile(id: string): Promise<LenderProfile & { user: User; lenderCompanies: LenderCompany[] }> {
  const profile = await prisma.lenderProfile.findFirst({
    where: { OR: [{ id }, { userId: id }] },
    include: { user: true, lenderCompanies: { where: { deletedAt: null } } },
  });
  if (!profile || profile.deletedAt) {
    throw new AppError("Lender not found", 404, "LENDER_NOT_FOUND");
  }
  return profile;
}

async function requireLenderProfileByUserId(userId: string): Promise<LenderProfile> {
  const profile = await prisma.lenderProfile.findUnique({ where: { userId } });
  if (!profile || profile.deletedAt) {
    throw new AppError("Lender profile not found", 404, "LENDER_NOT_FOUND");
  }
  return profile;
}

// D-P4-5 (rescopeo de BE-040): la persona (User+LenderProfile) ya existe —
// vía auto-registro (D-P2-1) — así que esto solo crea una LenderCompany
// nueva bajo un LenderProfile que ya existe. No genera contraseña ni manda
// correo (no hay cuenta que activar acá). Compartida por las dos rutas de
// alta: un Admin asociando una empresa a un Lender existente (:id explícito)
// y el propio Lender dándose de alta una empresa (ver createOwnLenderCompany
// abajo, que resuelve el LenderProfile desde la sesión).
export async function createLenderCompany(
  lenderProfileId: string,
  input: CreateLenderCompanyInput,
  actorUserId: string,
): Promise<LenderCompanySummary> {
  const profile = await requireLenderProfile(lenderProfileId);

  const existingEin = await prisma.lenderCompany.findUnique({ where: { ein: input.ein } });
  if (existingEin) {
    throw new AppError("A company with that EIN already exists", 409, "EIN_TAKEN");
  }

  const lenderCompany = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: profile.id,
      companyName: input.companyName,
      ein: input.ein,
      contactPhone: input.contactPhone,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      createdByUserId: actorUserId,
    },
  });

  await logAuditEvent({
    action: "LENDER_COMPANY_CREATED",
    entityType: "LenderCompany",
    entityId: lenderCompany.id,
    actorUserId,
    lenderCompanyId: lenderCompany.id,
  });

  return mapLenderCompany(lenderCompany);
}

// Variante autoservicio: el propio Lender crea una empresa para sí mismo —
// resuelve su LenderProfile desde la sesión en vez de recibir un :id.
export async function createOwnLenderCompany(userId: string, input: CreateLenderCompanyInput): Promise<LenderCompanySummary> {
  const profile = await requireLenderProfileByUserId(userId);
  return createLenderCompany(profile.id, input, userId);
}

// D-P4-8: valida que :companyId sea una LenderCompany del :id resuelto — un
// companyId ajeno (de otro Lender) responde 404, no se confía en el path.
async function requireLenderCompany(lenderProfileId: string, companyId: string): Promise<LenderCompany> {
  const company = await prisma.lenderCompany.findFirst({ where: { id: companyId, lenderProfileId } });
  if (!company || company.deletedAt) {
    throw new AppError("Lender company not found", 404, "LENDER_COMPANY_NOT_FOUND");
  }
  return company;
}

// D-P4-8, nuevo: PATCH /api/admin/lenders/:id/companies/:companyId — Admin
// edita cualquier campo de la empresa, incluido status (suspender/reactivar,
// D-P1-8) e isOpenToDeals (M-4). Reemplaza el hueco que dejaba BE-043 (que
// solo tocaba LenderProfile.contactPhone, ya eliminado).
export async function updateLenderCompany(
  lenderId: string,
  companyId: string,
  input: UpdateLenderCompanyInput,
  actorUserId: string,
): Promise<LenderCompanySummary> {
  const profile = await requireLenderProfile(lenderId);
  const company = await requireLenderCompany(profile.id, companyId);

  if (input.ein !== undefined && input.ein !== company.ein) {
    const existingEin = await prisma.lenderCompany.findUnique({ where: { ein: input.ein } });
    if (existingEin) {
      throw new AppError("A company with that EIN already exists", 409, "EIN_TAKEN");
    }
  }

  const data: Prisma.LenderCompanyUpdateInput = {};
  if (input.companyName !== undefined) data.companyName = input.companyName;
  if (input.ein !== undefined) data.ein = input.ein;
  if (input.contactPhone !== undefined) data.contactPhone = input.contactPhone;
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
  if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2;
  if (input.city !== undefined) data.city = input.city;
  if (input.state !== undefined) data.state = input.state;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;
  if (input.isOpenToDeals !== undefined) data.isOpenToDeals = input.isOpenToDeals;
  if (input.status !== undefined) data.status = input.status;

  const updated = await prisma.lenderCompany.update({ where: { id: company.id }, data });

  await logAuditEvent({
    action: "LENDER_COMPANY_UPDATED",
    entityType: "LenderCompany",
    entityId: company.id,
    actorUserId,
    lenderCompanyId: company.id,
  });
  // Transición puntual a SUSPENDED: además del genérico de arriba, un
  // evento propio — más fácil de encontrar en auditoría que revisar el
  // metadata de cada UPDATED para ver si cambió el status.
  if (input.status === "SUSPENDED" && company.status !== "SUSPENDED") {
    await logAuditEvent({
      action: "LENDER_COMPANY_SUSPENDED",
      entityType: "LenderCompany",
      entityId: company.id,
      actorUserId,
      lenderCompanyId: company.id,
    });
  }

  return mapLenderCompany(updated);
}

// D-P4-8, nuevo: DELETE /api/admin/lenders/:id/companies/:companyId —
// soft-delete de una sola empresa (no de todo el Lender, a diferencia de
// deleteLender/BE-044), bloqueado si ESA empresa tiene un Contract
// ACTIVE/DELINQUENT. Puede dejar al Lender con cero empresas — estado ya
// válido (mismo que un recién auto-registrado, D-P2-1).
export async function deleteLenderCompany(lenderId: string, companyId: string, actorUserId: string): Promise<void> {
  const profile = await requireLenderProfile(lenderId);
  const company = await requireLenderCompany(profile.id, companyId);

  const blockingContracts = await prisma.contract.count({
    where: { lenderCompanyId: company.id, status: { in: ["ACTIVE", "DELINQUENT"] } },
  });
  if (blockingContracts > 0) {
    throw new AppError("Cannot delete: has active or delinquent contracts", 409, "LENDER_HAS_ACTIVE_CONTRACTS");
  }

  await prisma.lenderCompany.update({ where: { id: company.id }, data: { deletedAt: new Date() } });

  await logAuditEvent({
    action: "LENDER_COMPANY_DELETED",
    entityType: "LenderCompany",
    entityId: company.id,
    actorUserId,
    lenderCompanyId: company.id,
  });
}

// BE-041.
export async function listLenders(query: ListLendersQuery): Promise<PaginatedResult<LenderListItem>> {
  const where: Prisma.LenderProfileWhereInput = { deletedAt: null };

  if (query.search) {
    where.OR = [
      { user: { name: { contains: query.search, mode: "insensitive" } } },
      { user: { email: { contains: query.search, mode: "insensitive" } } },
      { lenderCompanies: { some: { companyName: { contains: query.search, mode: "insensitive" } } } },
    ];
  }
  if (query.status) {
    where.lenderCompanies = { some: { status: query.status, deletedAt: null } };
  }

  const [total, profiles] = await Promise.all([
    prisma.lenderProfile.count({ where }),
    prisma.lenderProfile.findMany({
      where,
      include: { user: true, lenderCompanies: { where: { deletedAt: null } } },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return buildPaginatedResult(profiles.map(mapLenderListItem), total, query);
}

// BE-042. Incluye el resumen de deudores/contratos activos de **todas** las
// LenderCompany del Lender (D-P4-1) — no depende de una empresa "activa".
export async function getLender(id: string): Promise<LenderDetail> {
  const profile = await requireLenderProfile(id);
  const companyIds = profile.lenderCompanies.map((company) => company.id);

  const [borrowersCount, activeContractsCount] = await Promise.all([
    prisma.lenderBorrower.count({ where: { lenderCompanyId: { in: companyIds }, status: "ACTIVE" } }),
    prisma.contract.count({ where: { lenderCompanyId: { in: companyIds }, status: { in: ["ACTIVE", "DELINQUENT"] } } }),
  ]);

  return { ...mapLenderListItem(profile), borrowersCount, activeContractsCount };
}

// BE-044. Soft-delete de User+LenderProfile+todas sus LenderCompany,
// bloqueado si alguna tiene un Contract ACTIVE/DELINQUENT.
export async function deleteLender(id: string, actorUserId: string): Promise<SafeUser> {
  const profile = await requireLenderProfile(id);
  const companyIds = profile.lenderCompanies.map((company) => company.id);

  const blockingContracts = await prisma.contract.count({
    where: { lenderCompanyId: { in: companyIds }, status: { in: ["ACTIVE", "DELINQUENT"] } },
  });
  if (blockingContracts > 0) {
    throw new AppError("Cannot delete: has active or delinquent contracts", 409, "LENDER_HAS_ACTIVE_CONTRACTS");
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id: profile.userId }, data: { deletedAt: now, isActive: false } }),
    prisma.lenderProfile.update({ where: { id }, data: { deletedAt: now } }),
    prisma.lenderCompany.updateMany({ where: { id: { in: companyIds } }, data: { deletedAt: now } }),
    prisma.refreshToken.updateMany({ where: { userId: profile.userId, revokedAt: null }, data: { revokedAt: now } }),
  ]);

  await logAuditEvent({ action: "LENDER_DELETED", entityType: "User", entityId: profile.userId, actorUserId });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: profile.userId } });
  return toSafeUser(user);
}

// BE-100. GET /api/lenders/me — autoservicio. El PATCH que este ticket
// pedía originalmente (D-P4-8: solo tocaba LenderProfile.contactPhone,
// eliminado por redundante con User.phone) ya no existe — LenderProfile no
// tiene ningún campo propio editable; name/phone de User siguen en
// PATCH /api/auth/me (BE-099).
export async function getOwnLenderProfile(userId: string): Promise<LenderDetail> {
  const profile = await requireLenderProfileByUserId(userId);
  return getLender(profile.id);
}
