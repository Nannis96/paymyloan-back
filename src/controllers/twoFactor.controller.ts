import { requireRole, requireSession } from "@/auth/session";
import * as twoFactorService from "@/services/twoFactor.service";
import { parseOrThrow } from "@/validations/parse";
import { twoFactorStepUpSchema, twoFactorVerifySchema } from "@/validations/auth.validation";

// §6.1: 2FA es autoservicio de ADMIN/LENDER (los roles con 2FA obligatorio,
// §7.4) — un BORROWER no tiene endpoint propio para activarlo en esta fase.
async function requireAdminOrLenderSession(request: Request) {
  const session = await requireSession(request);
  requireRole(session, "ADMIN", "LENDER");
  return session;
}

export async function setup(request: Request) {
  const session = await requireAdminOrLenderSession(request);
  return twoFactorService.setup(session.userId);
}

export async function verify(request: Request, body: unknown) {
  const session = await requireAdminOrLenderSession(request);
  const input = parseOrThrow(twoFactorVerifySchema, body);
  const recoveryCodes = await twoFactorService.verify(session.userId, input.code);
  return { recoveryCodes };
}

export async function disable(request: Request, body: unknown) {
  const session = await requireAdminOrLenderSession(request);
  const input = parseOrThrow(twoFactorStepUpSchema, body);
  await twoFactorService.disable(session.userId, input.password, input.code);
  return { disabled: true };
}

export async function recoveryCodes(request: Request, body: unknown) {
  const session = await requireAdminOrLenderSession(request);
  const input = parseOrThrow(twoFactorStepUpSchema, body);
  const codes = await twoFactorService.regenerateRecoveryCodes(session.userId, input.password, input.code);
  return { recoveryCodes: codes };
}
