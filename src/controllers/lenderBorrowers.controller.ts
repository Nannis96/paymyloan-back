import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as lenderBorrowersService from "@/services/lenderBorrowers.service";
import { parseOrThrow } from "@/validations/parse";
import { createBorrowerSchema, listBorrowersQuerySchema, updateBorrowerProfileSchema } from "@/validations/borrowers.validation";

// BE-045..049: /api/lenders/me/borrowers — LENDER, escrituras exigen 2FA
// (D-P3-1).
async function requireLenderSession(request: Request, options?: { requireTwoFactor?: boolean }) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], options);
  return session;
}

export async function listBorrowers(request: Request, query: unknown) {
  const session = await requireLenderSession(request, { requireTwoFactor: false });
  const input = parseOrThrow(listBorrowersQuerySchema, query);
  return lenderBorrowersService.listBorrowers(session.userId, input);
}

export async function createBorrower(request: Request, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(createBorrowerSchema, body);
  return lenderBorrowersService.createBorrower(session.userId, input);
}

export async function getBorrower(request: Request, id: string) {
  const session = await requireLenderSession(request, { requireTwoFactor: false });
  return lenderBorrowersService.getBorrowerForLender(session.userId, id);
}

export async function updateBorrower(request: Request, id: string, body: unknown) {
  const session = await requireLenderSession(request);
  const input = parseOrThrow(updateBorrowerProfileSchema, body);
  return lenderBorrowersService.updateBorrower(session.userId, id, input);
}

export async function removeBorrower(request: Request, id: string) {
  const session = await requireLenderSession(request);
  await lenderBorrowersService.removeBorrower(session.userId, id);
  return { removed: true };
}
