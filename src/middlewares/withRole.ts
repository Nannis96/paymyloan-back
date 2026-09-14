import type { UserRole } from "@prisma/client";
import type { Session } from "@/middlewares/withAuth";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";

export interface WithRoleOptions {
  /**
   * Regla dura de §7.4: un ADMIN/LENDER sin 2FA activo no puede hacer
   * ninguna escritura de negocio fuera de `/api/auth/2fa/*` (D-P3-1: el
   * alcance son endpoints de negocio, no autoservicio). Default `true` —
   * seguro por default; los endpoints exentos (los propios `/2fa/*`) lo
   * apagan explícitamente. También se puede apagar globalmente con
   * `REQUIRE_TWO_FACTOR=false` (`D-P4-4`) mientras se prueba el resto de la
   * API sin tener que activar 2FA en cada usuario de prueba.
   */
  requireTwoFactor?: boolean;
  /**
   * D-P4-2 (BE-050): bloquea si `mustChangePassword` sigue en `true` — el
   * usuario todavía no cambió la contraseña generada por el sistema.
   * Default `false` (opt-in): solo lo usan los endpoints donde el ticket lo
   * pide explícitamente (`PATCH /api/borrowers/me`), nunca el propio
   * endpoint de cambio de contraseña (si no, nadie podría cambiarla).
   */
  requirePasswordChanged?: boolean;
}

const TWO_FACTOR_ROLES: UserRole[] = ["ADMIN", "LENDER"];

// BE-036. Reemplaza al `requireRole` provisorio de Fase 2 — agrega el
// chequeo de 2FA obligatorio y (D-P4-2) el de contraseña pendiente de
// cambio, ambos resueltos con la misma consulta en vivo (ninguno de los dos
// viaja en el JWT, D-P2-2).
export async function withRole(session: Session, allowedRoles: UserRole[], options: WithRoleOptions = {}): Promise<void> {
  if (!allowedRoles.includes(session.role)) {
    throw new AppError("You do not have permission for this operation", 403, "FORBIDDEN");
  }

  const needsTwoFactor =
    env.requireTwoFactorForWrites && options.requireTwoFactor !== false && TWO_FACTOR_ROLES.includes(session.role);
  const needsPasswordCheck = options.requirePasswordChanged === true;
  if (!needsTwoFactor && !needsPasswordCheck) return;

  // De paso, en la misma consulta, se revisa que la cuenta siga activa: si
  // se desactivó a mitad de una sesión con un access token todavía vigente
  // (15 min), una escritura de negocio queda igual bloqueada.
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { isTwoFactorEnabled: true, isActive: true, deletedAt: true, mustChangePassword: true },
  });

  if (!user || user.deletedAt || !user.isActive) {
    throw new AppError("The account is not active.", 403, "ACCOUNT_INACTIVE");
  }

  if (needsTwoFactor && !user.isTwoFactorEnabled) {
    throw new AppError("Enable two-factor authentication (2FA) to continue.", 403, "TWO_FACTOR_REQUIRED");
  }

  if (needsPasswordCheck && user.mustChangePassword) {
    throw new AppError("Change your temporary password before continuing.", 403, "PASSWORD_CHANGE_REQUIRED");
  }
}
