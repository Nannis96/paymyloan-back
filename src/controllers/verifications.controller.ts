import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as verificationsService from "@/services/verifications.service";
import { parseOrThrow } from "@/validations/parse";
import { listVerificationsQuerySchema, rejectVerificationSchema, submitVerificationSchema } from "@/validations/verifications.validation";

// AD-003. Prestamista: enviar es una escritura de negocio (2FA obligatorio,
// D-P3-1); leer el estado no. Deudor: nunca exige 2FA. Admin: la cola es
// lectura, aprobar/rechazar son escrituras.

export async function submitLender(request: Request, companyId: string, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"]);
  return verificationsService.submitLenderVerification(session.userId, companyId, parseOrThrow(submitVerificationSchema, body));
}

export async function getLender(request: Request, companyId: string) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], { requireTwoFactor: false });
  return verificationsService.getLenderVerification(session.userId, companyId);
}

export async function submitBorrower(request: Request, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return verificationsService.submitBorrowerVerification(session.userId, parseOrThrow(submitVerificationSchema, body));
}

export async function getBorrower(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return verificationsService.getBorrowerVerification(session.userId);
}

export async function list(request: Request, query: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"], { requireTwoFactor: false });
  return verificationsService.listVerifications(parseOrThrow(listVerificationsQuerySchema, query));
}

export async function approve(request: Request, id: string) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"]);
  return verificationsService.approveVerification(id, session.userId);
}

export async function reject(request: Request, id: string, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"]);
  return verificationsService.rejectVerification(id, session.userId, parseOrThrow(rejectVerificationSchema, body).reason);
}
