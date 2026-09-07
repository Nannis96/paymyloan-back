import * as usersService from "@/services/users.service";
import { parseOrThrow } from "@/validations/parse";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/validations/users.validation";

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
