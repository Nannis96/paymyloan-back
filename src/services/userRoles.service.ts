import type { UserRole } from "@prisma/client";
import { prisma } from "@/db/prisma";

// D-P7-1 (ver Docs/plan/00-contradicciones-y-decisiones.md). LENDER y
// BORROWER dejan de ser excluyentes: un usuario puede tener los dos roles al
// mismo tiempo, uno de arranque y el otro adquirido después al completar su
// perfil (ver borrowers/me/become-lender y lenders/me/become-borrower).
// ADMIN/BOOKKEEPER/INSURANCE_COMPANY siguen siendo roles de staff, fijos y
// exclusivos — no se combinan ni se auto-adquieren.
const COMBINABLE_ROLES: readonly UserRole[] = ["LENDER", "BORROWER"];

// Fuente de verdad de los roles activos: no hay columna `roles` en `users` —
// se derivan en vivo de qué perfiles existen. `user.role` (el rol de
// registro) siempre queda incluido como piso, incluso si por alguna razón su
// perfil original no existiera más.
export async function getActiveRoles(userId: string): Promise<UserRole[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      lenderProfile: { select: { deletedAt: true } },
      borrowerProfile: { select: { deletedAt: true } },
    },
  });
  if (!user) return [];

  if (!COMBINABLE_ROLES.includes(user.role)) {
    return [user.role];
  }

  const roles = new Set<UserRole>([user.role]);
  if (user.lenderProfile && !user.lenderProfile.deletedAt) roles.add("LENDER");
  if (user.borrowerProfile && !user.borrowerProfile.deletedAt) roles.add("BORROWER");
  return [...roles];
}
