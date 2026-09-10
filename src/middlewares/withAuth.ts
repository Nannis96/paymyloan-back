import type { UserRole } from "@prisma/client";
import { verifyAccessToken } from "@/auth/jwt";
import { AppError } from "@/errors/AppError";

// BE-035. Verifica el access token (firma+expiración) y devuelve la sesión
// — reemplaza al helper provisorio de Fase 2 (`src/auth/session.ts`).
export interface Session {
  userId: string;
  role: UserRole;
}

export async function withAuth(request: Request): Promise<Session> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!token) {
    throw new AppError("Missing access token", 401, "UNAUTHENTICATED");
  }

  const payload = await verifyAccessToken(token);
  return { userId: payload.sub, role: payload.role };
}
