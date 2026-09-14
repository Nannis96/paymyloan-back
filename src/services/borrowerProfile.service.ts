import { hashPassword, verifyPassword } from "@/auth/password";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { type SafeUser, toSafeUser } from "@/services/users.service";
import type { ChangePasswordInput, UpdateBorrowerProfileInput } from "@/validations/borrowers.validation";

export interface OwnBorrowerProfile {
  user: SafeUser;
  borrowerProfile: {
    id: string;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  lenderCompanies: { id: string; companyName: string }[];
}

async function loadOwnProfile(userId: string): Promise<OwnBorrowerProfile> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  const profile = await prisma.borrowerProfile.findUnique({
    where: { userId },
    include: { lenders: { where: { status: "ACTIVE" }, include: { lenderCompany: { select: { id: true, companyName: true } } } } },
  });
  if (!profile || profile.deletedAt) {
    throw new AppError("Borrower profile not found", 404, "BORROWER_NOT_FOUND");
  }

  const { id, addressLine1, city, state, postalCode } = profile;
  return {
    user: toSafeUser(user),
    borrowerProfile: { id, addressLine1, city, state, postalCode },
    lenderCompanies: profile.lenders.map((link) => link.lenderCompany),
  };
}

// BE-050.
export async function getOwnProfile(userId: string): Promise<OwnBorrowerProfile> {
  return loadOwnProfile(userId);
}

export async function updateOwnProfile(userId: string, input: UpdateBorrowerProfileInput): Promise<OwnBorrowerProfile> {
  const current = await loadOwnProfile(userId);

  // `phone` no vive acá (D-P5-2, redundante con `User.phone`) — se edita por
  // `PATCH /api/auth/me` (BE-099), no por este endpoint.
  const data: { addressLine1?: string; city?: string; state?: string; postalCode?: string } = {};
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
  if (input.city !== undefined) data.city = input.city;
  if (input.state !== undefined) data.state = input.state;
  if (input.postalCode !== undefined) data.postalCode = input.postalCode;

  await prisma.borrowerProfile.update({ where: { id: current.borrowerProfile.id }, data });
  await logAuditEvent({ action: "BORROWER_UPDATED", entityType: "BorrowerProfile", entityId: current.borrowerProfile.id, actorUserId: userId });

  return loadOwnProfile(userId);
}

// Exige la contraseña actual (defensa en profundidad — una sesión robada
// por sí sola no alcanza, mismo criterio que BE-034) y apaga
// `mustChangePassword` (D-P4-2). Revoca todos los refresh tokens, igual que
// `password/reset` (BE-032) — el mismo endpoint sigue disponible aunque
// `mustChangePassword` esté en `true`, si no nadie podría cambiarla nunca.
export async function changeOwnPassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }

  const currentPasswordOk = await verifyPassword(input.currentPassword, user.password);
  if (!currentPasswordOk) {
    throw new AppError("Current password is incorrect", 401, "INVALID_CREDENTIALS");
  }

  const password = await hashPassword(input.newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { password, mustChangePassword: false } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await logAuditEvent({ action: "USER_PASSWORD_CHANGED", entityType: "User", entityId: userId, actorUserId: userId });
}
