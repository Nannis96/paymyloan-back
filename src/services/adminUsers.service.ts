import { generateTemporaryPassword, hashPassword } from "@/auth/password";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { type SafeUser, toSafeUser } from "@/services/users.service";

export interface ActivateResult {
  user: SafeUser;
  emailSent: boolean;
}

// BE-097 (nuevo, adelantado desde Fase 4 por D-P2-1 — riesgo #20 resuelto).
// Un usuario auto-registrado (PB-013) nace `isActive=false` y sin
// contraseña utilizable: activarlo por primera vez genera una temporal y la
// envía por correo. Reactivar a alguien que ya había entrado antes solo
// reabre el acceso, sin tocar su contraseña — así este mismo endpoint sirve
// de reintento si el correo inicial falló (desactivar y volver a activar
// regenera y reenvía).
export async function activateUser(id: string, actorUserId: string): Promise<ActivateResult> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.deletedAt) {
    throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
  }

  const isFirstActivation = user.lastLoginAt === null;
  let emailSent = false;

  if (isFirstActivation) {
    const temporaryPassword = generateTemporaryPassword();
    const password = await hashPassword(temporaryPassword);
    await prisma.user.update({ where: { id }, data: { isActive: true, password } });

    try {
      await sendEmail({
        to: user.email,
        subject: "Tu cuenta de PayMyLoan ya está activa",
        template: "account-activated",
        data: { name: user.name, temporaryPassword },
      });
      emailSent = true;
    } catch {
      // La activación ya se aplicó — solo falló el envío. El Admin ve
      // emailSent=false y puede reintentar (desactivar + activar de nuevo).
      emailSent = false;
    }
  } else {
    await prisma.user.update({ where: { id }, data: { isActive: true } });
  }

  await logAuditEvent({
    action: "USER_ACTIVATED",
    entityType: "User",
    entityId: id,
    actorUserId,
    metadata: { firstActivation: isFirstActivation, emailSent },
  });

  const updated = await prisma.user.findUniqueOrThrow({ where: { id } });
  return { user: toSafeUser(updated), emailSent };
}

export async function deactivateUser(id: string, actorUserId: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.deletedAt) {
    throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
  }

  const updated = await prisma.user.update({ where: { id }, data: { isActive: false } });

  // Desactivar revoca las sesiones vigentes — nunca deja una cuenta
  // "apagada" con un refresh token todavía utilizable.
  await prisma.refreshToken.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await logAuditEvent({ action: "USER_DEACTIVATED", entityType: "User", entityId: id, actorUserId });

  return toSafeUser(updated);
}
