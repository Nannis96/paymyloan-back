import type { User } from "@prisma/client";
import { generateOpaqueToken, hashOpaqueToken } from "@/auth/jwt";
import { verifyPassword } from "@/auth/password";
import { buildOtpAuthUrl, generateSecret, verifyCode } from "@/auth/totp";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";

const RECOVERY_CODE_COUNT = 8;

function generateRecoveryCodePlaintexts(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => generateOpaqueToken().slice(0, 10));
}

async function requireUser(userId: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  return user;
}

export interface TwoFactorSetupResult {
  secret: string;
  otpAuthUrl: string;
}

// BE-033. Guarda el secreto sin activar 2FA todavía —isTwoFactorEnabled
// solo pasa a true en verify(), una vez confirmado que el usuario pudo
// generar un código válido con su app autenticadora.
export async function setup(userId: string): Promise<TwoFactorSetupResult> {
  const user = await requireUser(userId);
  if (user.isTwoFactorEnabled) {
    throw new AppError("El 2FA ya está activo", 409, "TWO_FACTOR_ALREADY_ENABLED");
  }

  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });

  return { secret, otpAuthUrl: buildOtpAuthUrl(user.email, secret) };
}

// Devuelve los 8 recovery codes en claro — única vez que existen fuera de
// su hash; el caller (controller) es responsable de no loguearlos.
export async function verify(userId: string, code: string): Promise<string[]> {
  const user = await requireUser(userId);
  if (user.isTwoFactorEnabled) {
    throw new AppError("El 2FA ya está activo", 409, "TWO_FACTOR_ALREADY_ENABLED");
  }
  if (!user.twoFactorSecret) {
    throw new AppError("Primero hay que llamar a /api/auth/2fa/setup", 409, "TWO_FACTOR_SETUP_REQUIRED");
  }
  if (!verifyCode(user.twoFactorSecret, code)) {
    throw new AppError("Código de verificación inválido", 401, "INVALID_2FA_CODE");
  }

  const recoveryCodes = generateRecoveryCodePlaintexts();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isTwoFactorEnabled: true } });
    await tx.twoFactorRecoveryCode.createMany({
      data: recoveryCodes.map((plain) => ({ userId, codeHash: hashOpaqueToken(plain) })),
    });
  });

  await logAuditEvent({ action: "USER_2FA_ENABLED", entityType: "User", entityId: userId, actorUserId: userId });

  return recoveryCodes;
}

// BE-034: disable/recovery-codes exigen contraseña + código TOTP vigente,
// no solo la sesión activa — una sesión robada por sí sola no alcanza para
// desactivar 2FA ni regenerar recovery codes.
async function requireStepUp(userId: string, password: string, code: string): Promise<void> {
  const user = await requireUser(userId);
  if (!user.isTwoFactorEnabled || !user.twoFactorSecret) {
    throw new AppError("El 2FA no está activo", 409, "TWO_FACTOR_NOT_ENABLED");
  }

  const passwordOk = await verifyPassword(password, user.password);
  const codeOk = verifyCode(user.twoFactorSecret, code);
  if (!passwordOk || !codeOk) {
    throw new AppError("Contraseña o código inválidos", 401, "INVALID_CREDENTIALS");
  }
}

export async function disable(userId: string, password: string, code: string): Promise<void> {
  await requireStepUp(userId, password, code);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isTwoFactorEnabled: false, twoFactorSecret: null } });
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
  });

  await logAuditEvent({ action: "USER_2FA_DISABLED", entityType: "User", entityId: userId, actorUserId: userId });
}

export async function regenerateRecoveryCodes(userId: string, password: string, code: string): Promise<string[]> {
  await requireStepUp(userId, password, code);

  const recoveryCodes = generateRecoveryCodePlaintexts();
  await prisma.$transaction(async (tx) => {
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
    await tx.twoFactorRecoveryCode.createMany({
      data: recoveryCodes.map((plain) => ({ userId, codeHash: hashOpaqueToken(plain) })),
    });
  });

  return recoveryCodes;
}
