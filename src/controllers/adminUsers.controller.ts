import { requireRole, requireSession } from "@/auth/session";
import * as adminUsersService from "@/services/adminUsers.service";

export async function activate(request: Request, id: string) {
  const session = await requireSession(request);
  requireRole(session, "ADMIN");
  return adminUsersService.activateUser(id, session.userId);
}

export async function deactivate(request: Request, id: string) {
  const session = await requireSession(request);
  requireRole(session, "ADMIN");
  return adminUsersService.deactivateUser(id, session.userId);
}
