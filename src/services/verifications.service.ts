import type { Prisma, VerificationRequest } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";
import type { ListVerificationsQuery, SubmitVerificationInput } from "@/validations/verifications.validation";

// AD-003 (Fase 16). Verificación de entidad ("Business") de LenderCompany y
// BorrowerProfile. "Verificado" = tiene una solicitud APPROVED; no hay
// columna en la empresa/perfil que se pueda desincronizar. No bloquea
// ninguna operación existente (D-A10).

type Subject = { lenderCompanyId: string } | { borrowerProfileId: string };

const subjectKind = (subject: { lenderCompanyId: string | null }) => (subject.lenderCompanyId ? "LENDER" : "BORROWER");

const adminInclude = {
  lenderCompany: { select: { id: true, companyName: true } },
  borrowerProfile: { select: { id: true, user: { select: { name: true, email: true } } } },
  submittedByUser: { select: { id: true, name: true, email: true } },
} satisfies Prisma.VerificationRequestInclude;

async function ownLenderCompany(userId: string, companyId: string): Promise<Subject> {
  const company = await prisma.lenderCompany.findFirst({
    where: { id: companyId, deletedAt: null, lenderProfile: { userId, deletedAt: null } },
    select: { id: true },
  });
  if (!company) throw new AppError("Lender company not found", 404, "LENDER_COMPANY_NOT_FOUND");
  return { lenderCompanyId: company.id };
}

async function ownBorrower(userId: string): Promise<Subject> {
  const profile = await prisma.borrowerProfile.findFirst({ where: { userId, deletedAt: null }, select: { id: true } });
  if (!profile) throw new AppError("Borrower profile not found", 404, "BORROWER_NOT_FOUND");
  return { borrowerProfileId: profile.id };
}

// ponytail: check-then-insert. Prisma no expresa un índice único parcial
// (uno PENDING por sujeto) sin generar drift en `migrate dev`, así que dos
// envíos exactamente simultáneos podrían dejar dos PENDING; aprobar una no
// rompe nada. Agregar el índice parcial a mano si llega a pasar.
async function submit(subject: Subject, userId: string, input: SubmitVerificationInput): Promise<VerificationRequest> {
  const open = await prisma.verificationRequest.findFirst({ where: { ...subject, status: { in: ["PENDING", "APPROVED"] } }, select: { status: true } });
  if (open?.status === "APPROVED") throw new AppError("This entity is already verified", 409, "VERIFICATION_ALREADY_APPROVED");
  if (open) throw new AppError("A verification request is already pending review", 409, "VERIFICATION_PENDING");

  const request = await prisma.verificationRequest.create({ data: { ...subject, ...input, submittedByUserId: userId } });
  await logAuditEvent({
    action: "VERIFICATION_SUBMITTED",
    entityType: "VerificationRequest",
    entityId: request.id,
    actorUserId: userId,
    lenderCompanyId: request.lenderCompanyId ?? undefined,
    metadata: { subject: subjectKind(request) },
  });
  return request;
}

// La más reciente, o null si nunca se envió una — es lo que el front usa
// para mostrar el estado (sin verificar / pendiente / verificado / rechazado).
function latest(subject: Subject): Promise<VerificationRequest | null> {
  return prisma.verificationRequest.findFirst({ where: subject, orderBy: { createdAt: "desc" } });
}

export async function submitLenderVerification(userId: string, companyId: string, input: SubmitVerificationInput) {
  return submit(await ownLenderCompany(userId, companyId), userId, input);
}

export async function getLenderVerification(userId: string, companyId: string) {
  return latest(await ownLenderCompany(userId, companyId));
}

export async function submitBorrowerVerification(userId: string, input: SubmitVerificationInput) {
  return submit(await ownBorrower(userId), userId, input);
}

export async function getBorrowerVerification(userId: string) {
  return latest(await ownBorrower(userId));
}

// Cola del Admin. Filtrando PENDING va la más vieja primero (es una cola);
// el resto, la más reciente primero, como cualquier otro listado.
export async function listVerifications(query: ListVerificationsQuery): Promise<PaginatedResult<Prisma.VerificationRequestGetPayload<{ include: typeof adminInclude }>>> {
  const where: Prisma.VerificationRequestWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.subject === "LENDER") where.lenderCompanyId = { not: null };
  if (query.subject === "BORROWER") where.borrowerProfileId = { not: null };
  if (query.search) where.entityName = { contains: query.search, mode: "insensitive" };

  const [total, items] = await Promise.all([
    prisma.verificationRequest.count({ where }),
    prisma.verificationRequest.findMany({
      where,
      include: adminInclude,
      orderBy: { createdAt: query.status === "PENDING" ? "asc" : "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return buildPaginatedResult(items, total, query);
}

// `updateMany` con `status: PENDING` en el WHERE: si dos admins revisan la
// misma solicitud a la vez, solo uno gana — el otro ve 409.
async function review(id: string, adminId: string, decision: { status: "APPROVED" } | { status: "REJECTED"; rejectionReason: string }) {
  const { count } = await prisma.verificationRequest.updateMany({
    where: { id, status: "PENDING" },
    data: { ...decision, reviewedByUserId: adminId, reviewedAt: new Date() },
  });
  if (count === 0) {
    const exists = await prisma.verificationRequest.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new AppError("Verification request not found", 404, "VERIFICATION_NOT_FOUND");
    throw new AppError("This verification request was already reviewed", 409, "VERIFICATION_NOT_PENDING");
  }

  const request = await prisma.verificationRequest.findUniqueOrThrow({ where: { id }, include: adminInclude });
  await logAuditEvent({
    action: decision.status === "APPROVED" ? "VERIFICATION_APPROVED" : "VERIFICATION_REJECTED",
    entityType: "VerificationRequest",
    entityId: id,
    actorUserId: adminId,
    lenderCompanyId: request.lenderCompanyId ?? undefined,
    metadata: { subject: subjectKind(request), ...("rejectionReason" in decision ? { rejectionReason: decision.rejectionReason } : {}) },
  });
  return request;
}

export function approveVerification(id: string, adminId: string) {
  return review(id, adminId, { status: "APPROVED" });
}

export function rejectVerification(id: string, adminId: string, reason: string) {
  return review(id, adminId, { status: "REJECTED", rejectionReason: reason });
}
