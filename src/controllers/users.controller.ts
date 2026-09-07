import { requireRole, requireSession } from "@/auth/session";
import * as usersService from "@/services/users.service";
import { parseOrThrow } from "@/validations/parse";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/validations/users.validation";

// D-P2-4: el CRUD genérico de Fase 0 queda restringido a ADMIN — hasta acá
// llegaba sin ninguna verificación de sesión (aviso explícito en
// Docs/API_REFERENCE.md, ya corregido). Reusa el mismo helper provisorio de
// sesión que el resto de Fase 2 (`src/auth/session.ts`); Fase 3 lo
// reemplaza por `withAuth`/`withRole`.
async function requireAdminSession(request: Request) {
  const session = await requireSession(request);
  requireRole(session, "ADMIN");
  return session;
}

export async function listUsers(request: Request) {
  await requireAdminSession(request);
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
