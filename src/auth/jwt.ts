import { randomBytes, createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import type { UserRole } from "@prisma/client";
import { env } from "@/config/env";
import { AppError } from "@/errors/AppError";

// BE-025. Payload mínimo `{ sub, role }` — **sin** `lenderId` (a diferencia
// del §7.1 original): desde D-P1-3 el tenant es LenderCompany y un
// LenderProfile puede tener N, así que un único lenderId por sesión ya no
// alcanza. Ese rediseño es Fase 3 (riesgo #18, withTenantScope); GET
// /api/auth/me expone la lista de empresas en su lugar. Ver D-P2-2.
const textEncoder = new TextEncoder();
const accessSigningKey = textEncoder.encode(env.jwtAccessSecret);

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(env.jwtAccessTtl)
    .sign(accessSigningKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, accessSigningKey);
    if (typeof payload.sub !== "string" || typeof payload.role !== "string" || "purpose" in payload) {
      throw new Error("Forma de payload inesperada");
    }
    return { sub: payload.sub, role: payload.role as UserRole };
  } catch {
    throw new AppError("Token de acceso inválido o expirado", 401, "INVALID_TOKEN");
  }
}

// Token de vida corta (2 min) emitido tras el paso 1 del login cuando el
// usuario tiene 2FA activo (BE-027/028) — el claim `purpose` es lo único
// que lo distingue de un access token normal, y verifyAccessToken lo
// rechaza explícitamente por tenerlo, para que nunca sirva como sesión.
export async function signPendingToken(userId: string): Promise<string> {
  return new SignJWT({ purpose: "2fa-pending" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(accessSigningKey);
}

export async function verifyPendingToken(token: string): Promise<{ sub: string }> {
  try {
    const { payload } = await jwtVerify(token, accessSigningKey);
    if (payload.purpose !== "2fa-pending" || typeof payload.sub !== "string") {
      throw new Error("Forma de payload inesperada");
    }
    return { sub: payload.sub };
  } catch {
    throw new AppError("Token temporal inválido o expirado", 401, "INVALID_TOKEN");
  }
}

// Tokens opacos (refresh, reset de contraseña, recovery codes): el valor
// aleatorio es lo único que se entrega al cliente/correo — nunca se guarda
// tal cual, solo su hash SHA-256. A diferencia de bcrypt, SHA-256 es
// determinista, así que sirve para buscar por índice en las columnas
// `@unique` (tokenHash/codeHash); estos valores ya tienen 256 bits de
// entropía propios, así que un hash rápido no los debilita.
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Convierte especificaciones tipo "15m"/"30d"/"1h" (mismo formato que
// JWT_ACCESS_TTL/JWT_REFRESH_TTL) a milisegundos, para calcular
// `expiresAt` de las filas de RefreshToken/PasswordResetToken.
const DURATION_UNITS_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function durationToMs(spec: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(spec);
  if (!match) {
    throw new Error(`Formato de duración inválido: ${spec}`);
  }
  const [, amount, unit] = match;
  return Number(amount) * DURATION_UNITS_MS[unit];
}
