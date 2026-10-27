import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as paymentsService from "@/services/payments.service";
import { parseOrThrow } from "@/validations/parse";
import {
  createManualPaymentSchema,
  createPayoffSchema,
  createPrepaymentSchema,
  listTransactionsQuerySchema,
  payoffQuoteQuerySchema,
  rejectPaymentRequestSchema,
  reverseTransactionSchema,
} from "@/validations/payments.validation";

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

// Abono/liquidación: el Lender la ejecuta, el Borrower la solicita.
async function requirePrepaymentSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER"]);
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

export async function getPayoffQuote(request: Request, contractId: string, query: unknown) {
  const session = await requireContractReadSession(request);
  return paymentsService.getPayoffQuote(session, contractId, parseOrThrow(payoffQuoteQuerySchema, query));
}

export async function requestPrepayment(request: Request, contractId: string, body: unknown) {
  const session = await requirePrepaymentSession(request);
  return paymentsService.requestPrepayment(session, contractId, parseOrThrow(createPrepaymentSchema, body));
}

export async function requestPayoff(request: Request, contractId: string, body: unknown) {
  const session = await requirePrepaymentSession(request);
  return paymentsService.requestPayoff(session, contractId, parseOrThrow(createPayoffSchema, body));
}

export async function confirmPaymentRequest(request: Request, transactionId: string) {
  const session = await requireLenderSession(request);
  return paymentsService.confirmPaymentRequest(session, transactionId);
}

export async function rejectPaymentRequest(request: Request, transactionId: string, body: unknown) {
  const session = await requireLenderSession(request);
  return paymentsService.rejectPaymentRequest(session, transactionId, parseOrThrow(rejectPaymentRequestSchema, body));
}
