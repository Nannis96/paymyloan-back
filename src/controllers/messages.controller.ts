import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as messagingService from "@/services/messaging.service";
import { lenderThreadQuerySchema, markThreadReadQuerySchema, sendMessageAsBorrowerSchema, sendMessageAsLenderSchema } from "@/validations/messages.validation";
import { parseOrThrow } from "@/validations/parse";
import { paginationQuerySchema } from "@/validations/pagination";

// Fase 17 (PB-027..030). Mandar un mensaje no es una escritura de negocio en
// el sentido de D-P3-1 (no mueve plata ni cambia el estado de un contrato) —
// ningún endpoint de acá exige 2FA.

export async function sendLender(request: Request, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], { requireTwoFactor: false });
  return messagingService.sendFromLender(session.userId, parseOrThrow(sendMessageAsLenderSchema, body));
}

export async function sendBorrower(request: Request, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return messagingService.sendFromBorrower(session.userId, parseOrThrow(sendMessageAsBorrowerSchema, body));
}

export async function listLenderThreads(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], { requireTwoFactor: false });
  return messagingService.listThreadsForLender(session.userId);
}

export async function listBorrowerThreads(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return messagingService.listThreadsForBorrower(session.userId);
}

export async function getLenderThread(request: Request, borrowerProfileId: string, query: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], { requireTwoFactor: false });
  return messagingService.getThreadForLender(session.userId, borrowerProfileId, parseOrThrow(lenderThreadQuerySchema, query));
}

export async function getBorrowerThread(request: Request, lenderCompanyId: string, query: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return messagingService.getThreadForBorrower(session.userId, lenderCompanyId, parseOrThrow(paginationQuerySchema, query));
}

export async function markLenderThreadRead(request: Request, borrowerProfileId: string, query: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], { requireTwoFactor: false });
  const { lenderCompanyId } = parseOrThrow(markThreadReadQuerySchema, query);
  await messagingService.markThreadReadForLender(session.userId, borrowerProfileId, lenderCompanyId);
  return { success: true };
}

export async function markBorrowerThreadRead(request: Request, lenderCompanyId: string) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  await messagingService.markThreadReadForBorrower(session.userId, lenderCompanyId);
  return { success: true };
}
