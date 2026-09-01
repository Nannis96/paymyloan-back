import type { ZodType } from "zod";
import { AppError } from "@/errors/AppError";
import * as usersService from "@/services/users.service";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/validations/users.validation";

function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Datos inválidos";
    throw new AppError(message, 400, "VALIDATION_ERROR");
  }
  return result.data;
}

export async function listUsers() {
  return usersService.listUsers();
}

export async function createUser(body: unknown) {
  const input: CreateUserInput = parseOrThrow(createUserSchema, body);
  return usersService.createUser(input);
}

export async function updateUser(id: string, body: unknown) {
  const input: UpdateUserInput = parseOrThrow(updateUserSchema, body);
  return usersService.updateUser(id, input);
}

export async function deleteUser(id: string) {
  return usersService.softDeleteUser(id);
}
