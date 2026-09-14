import { AppError } from "@/errors/AppError";

interface Bucket {
  count: number;
  resetAt: number;
}

// Contador en memoria por proceso (BE-005). Suficiente para una sola
// instancia del backend; si en producción llega a correr más de una réplica
// hace falta un store compartido (Redis) — fuera de este backlog, queda
// como nota de escalamiento.
const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  max: number;
  windowMs: number;
}

// Lanza AppError 429 si `key` (típicamente IP+email o IP+ruta) superó `max`
// intentos dentro de `windowMs`. Cada llamada cuenta como un intento.
export function checkRateLimit(key: string, options: RateLimitOptions): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }

  bucket.count += 1;
  if (bucket.count > options.max) {
    throw new AppError("Too many attempts, please try again later", 429, "RATE_LIMITED");
  }
}

// Solo para tests: evita que el estado de un test contamine el siguiente.
export function resetRateLimitStore(): void {
  buckets.clear();
}
