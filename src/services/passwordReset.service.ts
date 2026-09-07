import { durationToMs, generateOpaqueToken, hashOpaqueToken } from "@/auth/jwt";
import { hashPassword } from "@/auth/password";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

const RESET_TOKEN_TTL = "1h";

// BE-032. Siempre "resuelve" sin importar si el correo existe (§7.3,
// anti-enumeración) — el caller (route) responde 200 en ambos casos.
export async function forgotPassword(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.deletedAt) {
    return;
  }

  const tokenPlain = generateOpaqueToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashOpaqueToken(tokenPlain),
      expiresAt: new Date(Date.now() + durationToMs(RESET_TOKEN_TTL)),
    },
  });

  const resetUrl = `${env.corsOrigin}/reset-password?token=${tokenPlain}`;
  await sendEmail({
    to: user.email,
    subject: "Restablecé tu contraseña de PayMyLoan",
    template: "password-reset",
    data: { resetUrl },
  });
}

// Revoca todos los refresh tokens del usuario al resetear — fuerza
// re-login en todos lados (§7.3), consistente con lo que hace un cambio de
// contraseña por sospecha de compromiso de cuenta.
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashOpaqueToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
    throw new AppError("Token de restablecimiento inválido o expirado", 400, "INVALID_TOKEN");
  }

  const password = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: resetToken.userId }, data: { password } }),
    prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
    prisma.refreshToken.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await logAuditEvent({
    action: "USER_PASSWORD_CHANGED",
    entityType: "User",
    entityId: resetToken.userId,
    actorUserId: resetToken.userId,
  });
}
