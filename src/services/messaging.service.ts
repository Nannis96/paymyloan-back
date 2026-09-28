import type { Message } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { buildPaginatedResult, type PaginatedResult, type PaginationQuery } from "@/validations/pagination";
import type { LenderThreadQuery, SendMessageAsBorrowerInput, SendMessageAsLenderInput } from "@/validations/messages.validation";

// Fase 17 (PB-027..030). Chat directo Lender <-> Borrower, habilitado solo
// si hay una oferta en negociación o un préstamo entre ambos — ver
// Docs/plan/fases/fase-17-messaging.md. Sin Conversation propia: el "hilo"
// es todo Message de un mismo (lenderCompanyId, borrowerProfileId).

// D-P6-1/D-P4-1: mismo patrón de resolución multi-empresa que
// loanQuotes.service.ts#resolveTargetLenderCompanyId — duplicado acá a
// propósito (convención del repo).
async function requireOwnedLenderCompanies(userId: string): Promise<{ id: string }[]> {
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

async function requireOwnBorrowerProfile(userId: string): Promise<{ id: string }> {
  const profile = await prisma.borrowerProfile.findFirst({ where: { userId, deletedAt: null }, select: { id: true } });
  if (!profile) {
    throw new AppError("Borrower profile not found", 404, "BORROWER_NOT_FOUND");
  }
  return profile;
}

// D3/D2 de fase-17-messaging.md: "oferta en negociación" = LoanQuote todavía
// SUBMITTED (ni aceptada, ni rechazada, ni retirada, ni vencida); "préstamo
// entre ellos" = un Contract que ya salió de DRAFT (el Deudor lo conoce) —
// una vez cierto, se queda cierto para siempre (D2: PAID_OFF/CANCELLED
// siguen habilitando, no se vuelve a evaluar en cada envío contra el estado
// actual del contrato). Único lugar que hay que tocar si la regla cambia.
async function canMessage(lenderCompanyId: string, borrowerProfileId: string): Promise<boolean> {
  const [activeQuote, realLoan] = await Promise.all([
    prisma.loanQuote.findFirst({
      where: { lenderCompanyId, status: "SUBMITTED", loanRequest: { borrowerProfileId } },
      select: { id: true },
    }),
    prisma.contract.findFirst({
      where: { lenderCompanyId, status: { not: "DRAFT" }, deletedAt: null, borrowers: { some: { borrowerProfileId } } },
      select: { id: true },
    }),
  ]);
  return activeQuote !== null || realLoan !== null;
}

export async function sendFromLender(userId: string, input: SendMessageAsLenderInput): Promise<Message> {
  const lenderCompanyId = await resolveTargetLenderCompanyId(userId, input.lenderCompanyId);
  if (!(await canMessage(lenderCompanyId, input.borrowerProfileId))) {
    throw new AppError("You can only message a borrower you have an active quote or loan with", 403, "MESSAGING_NOT_ALLOWED");
  }
  return prisma.message.create({
    data: { lenderCompanyId, borrowerProfileId: input.borrowerProfileId, senderUserId: userId, senderRole: "LENDER", body: input.body },
  });
}

export async function sendFromBorrower(userId: string, input: SendMessageAsBorrowerInput): Promise<Message> {
  const borrowerProfile = await requireOwnBorrowerProfile(userId);
  if (!(await canMessage(input.lenderCompanyId, borrowerProfile.id))) {
    throw new AppError("You can only message a lender you have an active quote or loan with", 403, "MESSAGING_NOT_ALLOWED");
  }
  return prisma.message.create({
    data: { lenderCompanyId: input.lenderCompanyId, borrowerProfileId: borrowerProfile.id, senderUserId: userId, senderRole: "BORROWER", body: input.body },
  });
}

interface LenderThreadSummary {
  borrowerProfile: { id: string; user: { name: string; email: string } } | null;
  lastMessage: Message;
  unreadCount: number;
}

interface BorrowerThreadSummary {
  lenderCompany: { id: string; companyName: string } | null;
  lastMessage: Message;
  unreadCount: number;
}

// ponytail: una consulta por hilo (last message + unread count + datos de la
// contraparte) en vez de una sola agregada — al volumen de un MVP (decenas
// de contrapartes, no miles) no se nota; pasar a una consulta con DISTINCT
// ON/window functions si la lista de hilos se pagina.
export async function listThreadsForLender(userId: string): Promise<LenderThreadSummary[]> {
  const companies = await requireOwnedLenderCompanies(userId);
  const companyIds = companies.map((company) => company.id);
  if (companyIds.length === 0) return [];

  const pairs = await prisma.message.groupBy({ by: ["lenderCompanyId", "borrowerProfileId"], where: { lenderCompanyId: { in: companyIds } } });

  const threads = await Promise.all(
    pairs.map(async ({ lenderCompanyId, borrowerProfileId }) => {
      const where = { lenderCompanyId, borrowerProfileId };
      const [lastMessage, unreadCount, borrowerProfile] = await Promise.all([
        prisma.message.findFirstOrThrow({ where, orderBy: { createdAt: "desc" } }),
        prisma.message.count({ where: { ...where, senderRole: "BORROWER", readAt: null } }),
        prisma.borrowerProfile.findUnique({ where: { id: borrowerProfileId }, select: { id: true, user: { select: { name: true, email: true } } } }),
      ]);
      return { borrowerProfile, lastMessage, unreadCount };
    }),
  );

  return threads.sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime());
}

export async function listThreadsForBorrower(userId: string): Promise<BorrowerThreadSummary[]> {
  const borrowerProfile = await requireOwnBorrowerProfile(userId);
  const pairs = await prisma.message.groupBy({ by: ["lenderCompanyId"], where: { borrowerProfileId: borrowerProfile.id } });

  const threads = await Promise.all(
    pairs.map(async ({ lenderCompanyId }) => {
      const where = { lenderCompanyId, borrowerProfileId: borrowerProfile.id };
      const [lastMessage, unreadCount, lenderCompany] = await Promise.all([
        prisma.message.findFirstOrThrow({ where, orderBy: { createdAt: "desc" } }),
        prisma.message.count({ where: { ...where, senderRole: "LENDER", readAt: null } }),
        prisma.lenderCompany.findUnique({ where: { id: lenderCompanyId }, select: { id: true, companyName: true } }),
      ]);
      return { lenderCompany, lastMessage, unreadCount };
    }),
  );

  return threads.sort((a, b) => b.lastMessage.createdAt.getTime() - a.lastMessage.createdAt.getTime());
}

// D11/D4 de fase-17-messaging.md: 404 si nunca hubo mensajes con esa
// contraparte — no depende de `canMessage` (el historial se puede seguir
// leyendo aunque la elegibilidad para escribir ya no se cumpla).
async function listThreadMessages(lenderCompanyId: string, borrowerProfileId: string, query: PaginationQuery): Promise<PaginatedResult<Message>> {
  const where = { lenderCompanyId, borrowerProfileId };
  const total = await prisma.message.count({ where });
  if (total === 0) {
    throw new AppError("No conversation found with this counterpart", 404, "THREAD_NOT_FOUND");
  }
  const items = await prisma.message.findMany({
    where,
    orderBy: { createdAt: "asc" },
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });
  return buildPaginatedResult(items, total, query);
}

export async function getThreadForLender(userId: string, borrowerProfileId: string, query: LenderThreadQuery): Promise<PaginatedResult<Message>> {
  const lenderCompanyId = await resolveTargetLenderCompanyId(userId, query.lenderCompanyId);
  return listThreadMessages(lenderCompanyId, borrowerProfileId, query);
}

export async function getThreadForBorrower(userId: string, lenderCompanyId: string, query: PaginationQuery): Promise<PaginatedResult<Message>> {
  const borrowerProfile = await requireOwnBorrowerProfile(userId);
  return listThreadMessages(lenderCompanyId, borrowerProfile.id, query);
}

export async function markThreadReadForLender(userId: string, borrowerProfileId: string, requestedCompanyId: string | undefined): Promise<void> {
  const lenderCompanyId = await resolveTargetLenderCompanyId(userId, requestedCompanyId);
  await prisma.message.updateMany({ where: { lenderCompanyId, borrowerProfileId, senderRole: "BORROWER", readAt: null }, data: { readAt: new Date() } });
}

export async function markThreadReadForBorrower(userId: string, lenderCompanyId: string): Promise<void> {
  const borrowerProfile = await requireOwnBorrowerProfile(userId);
  await prisma.message.updateMany({
    where: { lenderCompanyId, borrowerProfileId: borrowerProfile.id, senderRole: "LENDER", readAt: null },
    data: { readAt: new Date() },
  });
}
