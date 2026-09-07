import bcrypt from "bcryptjs";
import { env } from "@/config/env";

// BE-024. Formaliza el wrapper de bcrypt que antes vivía inline en
// users.service.ts, reutilizable acá y en el resto de src/auth/.
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.bcryptCost);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Hash de una contraseña que nadie conoce, calculado una sola vez al cargar
// el módulo. login() lo usa cuando el correo no existe, para que un
// bcrypt.compare corra igual que si el usuario existiera — sin esto, el
// tiempo de respuesta delataría qué correos están registrados (BE-027,
// criterio de aceptación de timing attack).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-para-igualar-timing", env.bcryptCost);

export async function verifyDummyPassword(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}

const TEMP_PASSWORD_LENGTH = 8;

// Contraseña temporal generada al activar una cuenta (D-P2-1) — ya sea por
// auto-registro, por creación directa del Admin con isActive:true, o por un
// PATCH que active a alguien después (D-P2-5). Genérica de 8 dígitos
// numéricos a propósito: nadie la escribe de memoria, se comunica una sola
// vez (por correo y/o en la respuesta mientras no haya proveedor de correo
// real) y se puede dictar/copiar sin ambigüedad de mayúsculas o símbolos.
export function generateTemporaryPassword(length = TEMP_PASSWORD_LENGTH): string {
  const randomValues = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(randomValues, (value) => String(value % 10)).join("");
}
