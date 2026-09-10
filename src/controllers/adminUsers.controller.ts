import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as adminUsersService from "@/services/adminUsers.service";

// Escrituras de negocio ADMIN-only — 2FA obligatorio por default (D-P3-1).
export async function activate(request: Request, id: string) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"]);
  return adminUsersService.activateUser(id, session.userId);
}

export async function deactivate(request: Request, id: string) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"]);
  return adminUsersService.deactivateUser(id, session.userId);
}
