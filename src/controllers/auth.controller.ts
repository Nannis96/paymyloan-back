import { requireSession } from "@/auth/session";
import { env } from "@/config/env";
import type { RequestMeta } from "@/lib/requestMeta";
import { checkRateLimit } from "@/middlewares/rateLimit";
import * as authService from "@/services/auth.service";
import * as passwordResetService from "@/services/passwordReset.service";
import { parseOrThrow } from "@/validations/parse";
import {
  loginSchema,
  loginTwoFactorSchema,
  logoutSchema,
  passwordForgotSchema,
  passwordResetSchema,
  refreshSchema,
  registerSchema,
} from "@/validations/auth.validation";

// BE-028: cada endpoint sensible tiene su propio bucket — un código de 2FA
// incorrecto no debe consumir el cupo de `login`, y viceversa.
const loginRateLimit = { max: env.rateLimitLoginMax, windowMs: env.rateLimitLoginWindowMs };

export async function register(body: unknown) {
  const input = parseOrThrow(registerSchema, body);
  return authService.register(input);
}

export async function login(body: unknown, meta: RequestMeta) {
  checkRateLimit(`login:${meta.ipAddress ?? "unknown"}`, loginRateLimit);
  const input = parseOrThrow(loginSchema, body);
  return authService.login({ ...input, ...meta });
}

export async function loginTwoFactor(body: unknown, meta: RequestMeta) {
  checkRateLimit(`login2fa:${meta.ipAddress ?? "unknown"}`, loginRateLimit);
  const input = parseOrThrow(loginTwoFactorSchema, body);
  return authService.loginTwoFactor({ ...input, ...meta });
}

export async function refresh(body: unknown, meta: RequestMeta) {
  const input = parseOrThrow(refreshSchema, body);
  return authService.refresh({ ...input, ...meta });
}

export async function logout(request: Request, body: unknown) {
  await requireSession(request);
  const input = parseOrThrow(logoutSchema, body);
  await authService.logout(input.refreshToken);
  return { loggedOut: true };
}

export async function logoutAll(request: Request) {
  const session = await requireSession(request);
  await authService.logoutAll(session.userId);
  return { loggedOut: true };
}

export async function me(request: Request) {
  const session = await requireSession(request);
  return authService.getMe(session.userId);
}

export async function forgotPassword(body: unknown, meta: RequestMeta) {
  checkRateLimit(`password-forgot:${meta.ipAddress ?? "unknown"}`, loginRateLimit);
  const input = parseOrThrow(passwordForgotSchema, body);
  await passwordResetService.forgotPassword(input.email);
  return { message: "Si el correo existe, vas a recibir instrucciones para restablecer tu contraseña." };
}

export async function resetPassword(body: unknown) {
  const input = parseOrThrow(passwordResetSchema, body);
  await passwordResetService.resetPassword(input.token, input.newPassword);
  return { message: "Contraseña actualizada." };
}
