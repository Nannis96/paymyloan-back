import { PHASE_PRODUCTION_BUILD } from "next/constants";

// Punto único de lectura de variables de entorno. El resto del código
// importa `env`, nunca `process.env` directamente, para que agregar una
// variable nueva sea un cambio en un solo lugar y con tipos.
//
// Fail-fast (BE-002): en NODE_ENV=production, si falta alguna de las
// variables realmente obligatorias, el proceso lanza al importar este
// módulo — antes de que Prisma o cualquier otra pieza fallen más adelante
// con un error menos claro. En desarrollo/test se usan placeholders
// inseguros para no bloquear el flujo local (nunca llegan a producción,
// justamente porque ahí sí se exige el valor real).

export const REQUIRED_IN_PRODUCTION = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "DATABASE_URL"] as const;

export function assertRequiredInProduction(source: NodeJS.ProcessEnv): void {
  if (source.NODE_ENV !== "production") return;
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !source[name]);
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno obligatorias en producción: ${missing.join(", ")}`);
  }
}

// `next build` fuerza NODE_ENV=production para bundlear en modo optimizado
// (fase PHASE_PRODUCTION_BUILD), sin que el contenedor "builder" del
// Dockerfile tenga (ni deba tener) los secretos reales todavía — esos
// llegan recién al arrancar el contenedor "runner" en runtime, vía
// docker-compose. Sin este chequeo de fase, cualquier `pnpm run build`
// fallaría por secretos que legítimamente no existen todavía en esa etapa.
if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
  try {
    assertRequiredInProduction(process.env);
  } catch (error) {
    // El runtime de Next (Turbopack) atrapa un throw en la evaluación de
    // este módulo y sigue respondiendo requests degradado en vez de
    // terminar el proceso — verificado con el contenedor "runner": queda
    // "Up" y sirviendo 500s en bucle, no falla visiblemente. process.exit
    // fuerza el corte real que pide BE-002 (fail-fast, no zombie).
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

// Placeholder evidente, nunca usado en producción (assertRequiredInProduction
// ya lanzó arriba si faltara ahí): evita que falte JWT_ACCESS_SECRET en dev
// rompa cada request en vez de solo advertir en el arranque.
function readSecret(name: string, devFallback: string): string {
  return process.env[name] ?? (isProduction ? "" : devFallback);
}

export const env = {
  nodeEnv,
  isProduction,
  isDevelopment: nodeEnv === "development",
  isTest: nodeEnv === "test",

  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? "",

  // Auth (Fase 2)
  jwtAccessSecret: readSecret("JWT_ACCESS_SECRET", "dev-insecure-access-secret"),
  jwtRefreshSecret: readSecret("JWT_REFRESH_SECRET", "dev-insecure-refresh-secret"),
  jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  bcryptCost: Number(process.env.BCRYPT_COST ?? 12),

  // CORS (BE-003)
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",

  // 2FA (Fase 2)
  totpIssuer: process.env.TOTP_ISSUER ?? "PayMyLoan",
  // D-P4-4: interruptor temporal para probar el resto de la API sin tener
  // que activar 2FA en cada usuario de prueba. Seguro por default —
  // exigido (`true`) salvo que se ponga explícitamente en "false". Nunca se
  // toca en producción; se saca del todo cuando se retome la Fase 6+ con
  // 2FA obligatorio de verdad en el flujo de pruebas.
  requireTwoFactorForWrites: process.env.REQUIRE_TWO_FACTOR !== "false",

  // Correo transaccional (BE-006) — proveedor concreto pendiente de
  // confirmar (sección 15 del plan), Resend como placeholder.
  emailProvider: process.env.EMAIL_PROVIDER ?? "resend",
  emailApiKey: process.env.EMAIL_API_KEY ?? "",
  emailFrom: process.env.EMAIL_FROM ?? "servicing@paymyloan.ai",

  // Stripe (Fase 7) — bloqueado por decisión Connect vs cuenta única.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? "",

  // S3 (Fase 11 — Documentos)
  s3Bucket: process.env.S3_BUCKET ?? "",
  s3Region: process.env.S3_REGION ?? "",
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",

  // Rate limiting (BE-005)
  rateLimitLoginMax: Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 5),
  rateLimitLoginWindowMs: Number(process.env.RATE_LIMIT_LOGIN_WINDOW_MS ?? 900_000),
} as const;
