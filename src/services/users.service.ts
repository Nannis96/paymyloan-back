import bcrypt from "bcryptjs";
import type { User } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import type { CreateUserInput, UpdateUserInput } from "@/validations/users.validation";

const BCRYPT_COST = 12;

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: User["role"];
  isActive: boolean;
  isTwoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// Nunca se devuelve `password` ni `twoFactorSecret` fuera de este service.
// Exportada para que auth.service.ts/adminUsers.service.ts (Fase 2) reusen
// el mismo mapeo en vez de duplicarlo.
export function toSafeUser(user: User): SafeUser {
  const { id, name, email, role, isActive, isTwoFactorEnabled, createdAt, updatedAt, deletedAt } = user;
  return { id, name, email, role, isActive, isTwoFactorEnabled, createdAt, updatedAt, deletedAt };
}

export async function listUsers(): Promise<SafeUser[]> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return users.map(toSafeUser);
}

export async function createUser(input: CreateUserInput): Promise<SafeUser> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError("Ya existe un usuario con ese correo", 409, "EMAIL_TAKEN");
  }

  const password = await bcrypt.hash(input.password, BCRYPT_COST);
  const user = await prisma.user.create({
    data: { name: input.name, email: input.email, password, role: input.role },
  });

  return toSafeUser(user);
}

async function findActiveUserOrThrow(id: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.deletedAt) {
    throw new AppError("Usuario no encontrado", 404, "USER_NOT_FOUND");
  }
  return user;
}

export async function updateUser(id: string, input: UpdateUserInput): Promise<SafeUser> {
  await findActiveUserOrThrow(id);

  if (input.email) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing && existing.id !== id) {
      throw new AppError("Ya existe un usuario con ese correo", 409, "EMAIL_TAKEN");
    }
  }

  const data: { name?: string; email?: string; password?: string } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) data.email = input.email;
  if (input.password !== undefined) data.password = await bcrypt.hash(input.password, BCRYPT_COST);

  const user = await prisma.user.update({ where: { id }, data });
  return toSafeUser(user);
}

export async function softDeleteUser(id: string): Promise<SafeUser> {
  await findActiveUserOrThrow(id);
  const user = await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
  return toSafeUser(user);
}
