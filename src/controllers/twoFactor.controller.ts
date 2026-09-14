import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as twoFactorService from "@/services/twoFactor.service";
import { parseOrThrow } from "@/validations/parse";
import { twoFactorStepUpSchema, twoFactorVerifySchema } from "@/validations/auth.validation";

// §6.1: 2FA es autoservicio de ADMIN/LENDER (los roles con 2FA obligatorio,
// §7.4) — un BORROWER no tiene endpoint propio para activarlo en esta fase.
// requireTwoFactor:false porque estos SON las rutas /api/auth/2fa/* — la
// regla dura de §7.4 las exime explícitamente (acá es donde se activa el
// 2FA que la regla exige en el resto de endpoints de negocio, D-P3-1).
async function requireAdminOrLenderSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN", "LENDER"], { requireTwoFactor: false });
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
