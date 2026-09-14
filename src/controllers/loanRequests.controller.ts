import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as loanRequestsService from "@/services/loanRequests.service";
import { parseOrThrow } from "@/validations/parse";
import {
  addLoanRequestTargetSchema,
  createLoanRequestSchema,
  listLoanRequestsQuerySchema,
  updateLoanRequestSchema,
} from "@/validations/loanRequests.validation";

// Fase 13: /api/borrowers/me/loan-requests/** — BORROWER, nunca exige 2FA
// (D-P3-1, TWO_FACTOR_ROLES no incluye BORROWER).
async function requireBorrowerSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return session;
}

// /api/marketplace/loan-requests/** — LENDER, lectura.
async function requireLenderSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], { requireTwoFactor: false });
  return session;
}

// PB-011.
export async function createLoanRequest(request: Request, body: unknown) {
  const session = await requireBorrowerSession(request);
  const input = parseOrThrow(createLoanRequestSchema, body);
  return loanRequestsService.createLoanRequest(session.userId, input);
}

export async function listLoanRequests(request: Request, query: unknown) {
  const session = await requireBorrowerSession(request);
  const input = parseOrThrow(listLoanRequestsQuerySchema, query);
  return loanRequestsService.listOwnLoanRequests(session.userId, input);
}

export async function getLoanRequest(request: Request, id: string) {
  const session = await requireBorrowerSession(request);
  return loanRequestsService.getOwnLoanRequest(session.userId, id);
}

export async function updateLoanRequest(request: Request, id: string, body: unknown) {
  const session = await requireBorrowerSession(request);
  const input = parseOrThrow(updateLoanRequestSchema, body);
  return loanRequestsService.updateLoanRequest(session.userId, id, input);
}

export async function publishLoanRequest(request: Request, id: string) {
  const session = await requireBorrowerSession(request);
  return loanRequestsService.publishLoanRequest(session.userId, id);
}

export async function withdrawLoanRequest(request: Request, id: string) {
  const session = await requireBorrowerSession(request);
  return loanRequestsService.withdrawLoanRequest(session.userId, id);
}

// D-S2-22.
export async function addLoanRequestTarget(request: Request, id: string, body: unknown) {
  const session = await requireBorrowerSession(request);
  const input = parseOrThrow(addLoanRequestTargetSchema, body);
  return loanRequestsService.addLoanRequestTarget(session.userId, id, input);
}

export async function removeLoanRequestTarget(request: Request, id: string, lenderCompanyId: string) {
  const session = await requireBorrowerSession(request);
  await loanRequestsService.removeLoanRequestTarget(session.userId, id, lenderCompanyId);
  return { removed: true };
}

// Marketplace (LENDER).
export async function listMarketplaceLoanRequests(request: Request, query: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(listLoanRequestsQuerySchema, query);
  return loanRequestsService.listMarketplaceLoanRequests(session.userId, input);
}

export async function getMarketplaceLoanRequest(request: Request, id: string) {
  const session = await requireLenderSession(request);
  return loanRequestsService.getMarketplaceLoanRequest(session.userId, id);
}
