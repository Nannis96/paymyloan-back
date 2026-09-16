import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as paymentsService from "@/services/payments.service";
import { parseOrThrow } from "@/validations/parse";
import { createManualPaymentSchema, listTransactionsQuerySchema, reverseTransactionSchema } from "@/validations/payments.validation";

// Fase 7. Escrituras de negocio (registrar/reversar un pago) exigen 2FA por
// default (D-P3-1, igual que contracts.controller.ts); lecturas nunca.
async function requireLenderSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"]);
  return session;
}

async function requireAdminSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"]);
  return session;
}

async function requireContractReadSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER", "ADMIN"], { requireTwoFactor: false });
  return session;
}

// BE-067.
export async function recordManualPayment(request: Request, contractId: string, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(createManualPaymentSchema, body);
  return paymentsService.recordManualPayment(session.userId, contractId, input);
}

// BE-069.
export async function listTransactions(request: Request, contractId: string, query: unknown) {
  const session = await requireContractReadSession(request);
  const input = parseOrThrow(listTransactionsQuerySchema, query);
  return paymentsService.listTransactions(session, contractId, input);
}

export async function getTransaction(request: Request, transactionId: string) {
  const session = await requireContractReadSession(request);
  return paymentsService.getTransaction(session, transactionId);
}

// BE-071.
export async function reverseTransaction(request: Request, transactionId: string, body: unknown) {
  const session = await requireAdminSession(request);
  const input = parseOrThrow(reverseTransactionSchema, body);
  return paymentsService.reverseTransaction(session.userId, transactionId, input);
}
