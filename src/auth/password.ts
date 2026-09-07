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

const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

// Contraseña temporal generada al activar una cuenta auto-registrada
// (D-P2-1): nadie la escribe a mano, así que no necesita ser memorizable —
// solo aleatoria y con entropía suficiente. Se envía una única vez por
// correo (adminUsers.service.ts) y nunca se vuelve a mostrar.
export function generateTemporaryPassword(length = 16): string {
  const randomValues = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(randomValues, (value) => TEMP_PASSWORD_ALPHABET[value % TEMP_PASSWORD_ALPHABET.length]).join("");
}
