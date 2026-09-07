import type { UserRole } from "@prisma/client";
import { verifyAccessToken } from "@/auth/jwt";
import { AppError } from "@/errors/AppError";

// Helper provisorio: los endpoints de esta fase que exigen sesión (`/me`,
// `/logout`, `/2fa/*`, `/admin/users/:id/activate`) necesitan verificar el
// access token, pero los middlewares reales (`withAuth`/`withRole`) son
// BE-035/BE-036, de Fase 3. Esta función es lo mínimo que hace falta hoy;
// Fase 3 la envuelve/reemplaza. A propósito **no** aplica la regla de 2FA
// obligatorio de §7.4 — eso es explícitamente BE-036.
export interface Session {
  userId: string;
  role: UserRole;
}

export async function requireSession(request: Request): Promise<Session> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    throw new AppError("Falta el token de acceso", 401, "UNAUTHENTICATED");
  }

  const payload = await verifyAccessToken(token);
  return { userId: payload.sub, role: payload.role };
}

export function requireRole(session: Session, ...roles: UserRole[]): void {
  if (!roles.includes(session.role)) {
    throw new AppError("No tiene permiso para esta operación", 403, "FORBIDDEN");
  }
}
