import { withAuth } from "@/middlewares/withAuth";
import { withRole, type WithRoleOptions } from "@/middlewares/withRole";
import * as usersService from "@/services/users.service";
import { parseOrThrow } from "@/validations/parse";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/validations/users.validation";

// D-P2-4: el CRUD genérico de Fase 0 queda restringido a ADMIN. D-P3-1: las
// escrituras (POST/PATCH/DELETE) además exigen 2FA activo (default de
// withRole); la lectura (GET) queda exenta, ver requireTwoFactor:false abajo.
async function requireAdminSession(request: Request, options?: WithRoleOptions) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"], options);
  return session;
}

export async function listUsers(request: Request) {
  await requireAdminSession(request, { requireTwoFactor: false });
  return usersService.listUsers();
}

export async function createUser(request: Request, body: unknown) {
  const session = await requireAdminSession(request);
  const input: CreateUserInput = parseOrThrow(createUserSchema, body);
  return usersService.createUser(input, session.userId);
}

export async function updateUser(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  const input: UpdateUserInput = parseOrThrow(updateUserSchema, body);
  return usersService.updateUser(id, input, session.userId);
}

export async function deleteUser(request: Request, id: string) {
  await requireAdminSession(request);
  return usersService.softDeleteUser(id);
}
