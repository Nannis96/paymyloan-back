import type { User } from "@prisma/client";
import { generateTemporaryPassword, hashPassword } from "@/auth/password";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

// Lógica compartida de activar/desactivar una cuenta (BE-097, D-P2-1) — la
// usan tanto `adminUsers.service.ts` (los endpoints dedicados
// `/api/admin/users/:id/activate|deactivate`) como `users.service.ts`
// (cuando el Admin cambia `isActive` desde el PATCH genérico
// `/api/users/:id`, D-P2-4). Vive en su propio módulo, separado de
// `users.service.ts`, para que ninguno de los dos importe al otro —
// `adminUsers.service.ts` sí importa `toSafeUser` de `users.service.ts`, así
// que esta lógica no puede vivir ahí sin crear un ciclo.
export interface ActivationResult {
  user: User;
  emailSent: boolean;
  /** Presente solo en la primera activación — nunca se puede volver a consultar después. */
  temporaryPassword?: string;
}

async function requireExistingUser(id: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.deletedAt) {
    throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  return user;
}

// Si el usuario nunca inició sesión (`lastLoginAt` nulo — típicamente recién
// auto-registrado), genera una contraseña temporal, la guarda hasheada y la
// envía por correo. Si ya había iniciado sesión antes (reactivación), solo
// reabre el acceso sin tocar la contraseña — así este mismo camino sirve de
// reintento si el correo de la primera activación falló (desactivar y
// volver a activar cuenta otra vez como "primera activación").
export async function activateUserAccount(id: string, actorUserId: string): Promise<ActivationResult> {
  const user = await requireExistingUser(id);

  const isFirstActivation = user.lastLoginAt === null;
  let emailSent = false;
  let temporaryPassword: string | undefined;

  if (isFirstActivation) {
    temporaryPassword = generateTemporaryPassword();
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
      // La activación ya se aplicó — solo falló el envío. El caller ve
      // emailSent=false y de todos modos tiene temporaryPassword a mano
      // (mientras no haya un proveedor de correo real, D-P2-4).
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
  return { user: updated, emailSent, temporaryPassword };
}

export async function deactivateUserAccount(id: string, actorUserId: string): Promise<User> {
  await requireExistingUser(id);

  const updated = await prisma.user.update({ where: { id }, data: { isActive: false } });

  // Desactivar revoca las sesiones vigentes — nunca deja una cuenta
  // "apagada" con un refresh token todavía utilizable.
  await prisma.refreshToken.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await logAuditEvent({ action: "USER_DEACTIVATED", entityType: "User", entityId: id, actorUserId });

  return updated;
}
