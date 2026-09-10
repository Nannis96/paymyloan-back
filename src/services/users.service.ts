import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { generateOpaqueToken } from "@/auth/jwt";
import { hashPassword } from "@/auth/password";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { activateUserAccount, deactivateUserAccount } from "@/services/userActivation.service";
import type { CreateUserInput, UpdateMeInput, UpdateUserInput } from "@/validations/users.validation";

const BCRYPT_COST = 12;

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: User["role"];
  isActive: boolean;
  isTwoFactorEnabled: boolean;
  /** D-P4-2: true mientras siga siendo una contraseña generada por el sistema. */
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// Nunca se devuelve `password` ni `twoFactorSecret` fuera de este service.
// Exportada para que auth.service.ts/adminUsers.service.ts (Fase 2) reusen
// el mismo mapeo en vez de duplicarlo.
export function toSafeUser(user: User): SafeUser {
  const { id, name, email, phone, role, isActive, isTwoFactorEnabled, mustChangePassword, createdAt, updatedAt, deletedAt } = user;
  return { id, name, email, phone, role, isActive, isTwoFactorEnabled, mustChangePassword, createdAt, updatedAt, deletedAt };
}

// D-P2-4 (CRUD de Fase 0 restringido a ADMIN): lista siempre a todos los
// usuarios no eliminados, activos o no — es lo que el Admin necesita ver
// para poder activarlos/desactivarlos.
export async function listUsers(): Promise<SafeUser[]> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return users.map(toSafeUser);
}

export interface CreateUserResult extends SafeUser {
  /** Presente solo si la cuenta terminó activa (ver más abajo). */
  temporaryPassword?: string;
  emailSent?: boolean;
}

// D-P2-5: la creación nunca pide contraseña — nace con un valor aleatorio
// inutilizable (mismo patrón que el auto-registro, D-P2-1). Si el resultado
// es una cuenta activa (isActive:true explícito, o sin el campo — default
// `true`, igual que antes), se reusa activateUserAccount() para generar y
// entregar la contraseña real: misma lógica que ya usan
// `PATCH /api/users/:id` y `/api/admin/users/:id/activate`, no se duplica.
export async function createUser(input: CreateUserInput, actorUserId: string): Promise<CreateUserResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError("A user with that email already exists", 409, "EMAIL_TAKEN");
  }

  const placeholderPassword = await hashPassword(generateOpaqueToken());
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      phone: input.phone,
      password: placeholderPassword,
      role: input.role,
      isActive: false,
    },
  });

  if (input.isActive === false) {
    return toSafeUser(user);
  }

  const result = await activateUserAccount(user.id, actorUserId);
  return { ...toSafeUser(result.user), temporaryPassword: result.temporaryPassword, emailSent: result.emailSent };
}

async function findActiveUserOrThrow(id: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.deletedAt) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }
  return user;
}

export interface UpdateUserResult extends SafeUser {
  /** Presente solo si este PATCH disparó una primera activación (D-P2-4). */
  temporaryPassword?: string;
  emailSent?: boolean;
}

// D-P2-4: el Admin puede activar/desactivar directamente acá (además de los
// endpoints dedicados `/api/admin/users/:id/activate|deactivate`) mandando
// `isActive` en el body. La lógica de qué pasa al activar/desactivar
// (generar+enviar contraseña temporal en la primera activación, revocar
// sesiones al desactivar) vive una sola vez en userActivation.service.ts —
// se reusa, no se duplica.
export async function updateUser(id: string, input: UpdateUserInput, actorUserId: string): Promise<UpdateUserResult> {
  const current = await findActiveUserOrThrow(id);

  if (input.email) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing && existing.id !== id) {
      throw new AppError("A user with that email already exists", 409, "EMAIL_TAKEN");
    }
  }

  let temporaryPassword: string | undefined;
  let emailSent: boolean | undefined;

  if (input.isActive !== undefined && input.isActive !== current.isActive) {
    if (input.isActive) {
      const result = await activateUserAccount(id, actorUserId);
      temporaryPassword = result.temporaryPassword;
      emailSent = result.emailSent;
    } else {
      await deactivateUserAccount(id, actorUserId);
    }
  }

  const data: { name?: string; email?: string; phone?: string; password?: string; mustChangePassword?: boolean } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) data.email = input.email;
  if (input.phone !== undefined) data.phone = input.phone;
  // Si esta misma llamada acaba de generar una contraseña temporal (primera
  // activación), un `password` explícito en el body se ignora — no la pisa
  // en silencio. Fuera de ese caso (sin transición, o reactivación sin
  // contraseña nueva), `password` se aplica normalmente — y, al ser una
  // contraseña que el Admin fijó a mano (no generada), ya no hace falta que
  // el usuario la cambie.
  if (input.password !== undefined && temporaryPassword === undefined) {
    data.password = await bcrypt.hash(input.password, BCRYPT_COST);
    data.mustChangePassword = false;
  }

  const user =
    Object.keys(data).length > 0
      ? await prisma.user.update({ where: { id }, data })
      : await prisma.user.findUniqueOrThrow({ where: { id } });

  return { ...toSafeUser(user), temporaryPassword, emailSent };
}

// Autoservicio (`PATCH /api/auth/me`): un usuario edita su propio nombre y
// teléfono. Nunca email/password/role/isActive desde acá.
export async function updateOwnProfile(id: string, input: UpdateMeInput): Promise<SafeUser> {
  await findActiveUserOrThrow(id);

  const data: { name?: string; phone?: string } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone;

  const user = await prisma.user.update({ where: { id }, data });
  return toSafeUser(user);
}

export async function softDeleteUser(id: string): Promise<SafeUser> {
  await findActiveUserOrThrow(id);
  const user = await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
  return toSafeUser(user);
}
