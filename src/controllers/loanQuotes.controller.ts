import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as loanQuotesService from "@/services/loanQuotes.service";
import { parseOrThrow } from "@/validations/parse";
import { submitLoanQuoteSchema } from "@/validations/loanQuotes.validation";

// PB-026: /api/marketplace/loan-requests/:id/quotes — LENDER, escritura
// exige 2FA (D-P3-1).
async function requireLenderSession(request: Request, options?: { requireTwoFactor?: boolean }) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], options);
  return session;
}

// PB-017: /api/borrowers/me/loan-requests/:id/quotes* — BORROWER, nunca
// exige 2FA.
async function requireBorrowerSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return session;
}

export async function submitQuote(request: Request, loanRequestId: string, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(submitLoanQuoteSchema, body);
  return loanQuotesService.submitQuote(session.userId, loanRequestId, input);
}

export async function withdrawQuote(request: Request, loanRequestId: string) {
  const session = await requireLenderSession(request);
  await loanQuotesService.withdrawQuote(session.userId, loanRequestId);
  return { withdrawn: true };
}

export async function listReceivedQuotes(request: Request, loanRequestId: string) {
  const session = await requireBorrowerSession(request);
  return loanQuotesService.listReceivedQuotes(session.userId, loanRequestId);
}

export async function selectQuote(request: Request, loanRequestId: string, quoteId: string) {
  const session = await requireBorrowerSession(request);
  return loanQuotesService.selectQuote(session.userId, loanRequestId, quoteId);
}
