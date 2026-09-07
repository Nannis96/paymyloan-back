import { generateSecret as generateOtpSecret, generateURI, generateSync, verifySync } from "otplib";
import { env } from "@/config/env";

// BE-026. Wrapper de otplib (2FA obligatorio para ADMIN/LENDER, §7.4).
export function generateSecret(): string {
  return generateOtpSecret({ length: 20 });
}

const PERIOD_SECONDS = 30;

// Ventana ±1 step (30s) — tolerancia estándar de TOTP para relojes
// desincronizados entre servidor y app autenticadora. otplib mide
// `epochTolerance` en segundos (no en steps), así que un step completo es
// `epochTolerance: PERIOD_SECONDS` — verificado empíricamente contra la
// librería real, no está documentado con ese detalle.
//
// otplib valida el formato del token (6 dígitos) *antes* de comparar, y
// lanza en vez de devolver `valid: false` si no matchea — pasa siempre que
// loginTwoFactor() prueba acá un recovery code (formato distinto) antes de
// caer al camino de recovery codes. Se captura y se trata como "no es un
// código TOTP válido", nunca como error de sistema.
export function verifyCode(secret: string, code: string): boolean {
  try {
    return verifySync({ secret, token: code, strategy: "totp", period: PERIOD_SECONDS, epochTolerance: PERIOD_SECONDS }).valid;
  } catch {
    return false;
  }
}

export function buildOtpAuthUrl(email: string, secret: string): string {
  return generateURI({ strategy: "totp", issuer: env.totpIssuer, label: email, secret });
}

// Solo para tests: genera el código válido para un secreto dado, opcionalmente
// desplazado `epochOffsetSeconds` respecto de "ahora" (para probar drift).
export function generateCodeForTesting(secret: string, epochOffsetSeconds = 0): string {
  const epoch = Math.floor(Date.now() / 1000) + epochOffsetSeconds;
  return generateSync({ secret, strategy: "totp", epoch });
}
