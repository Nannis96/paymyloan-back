// Logger JSON estructurado (BE-004): reemplaza console.log suelto por una
// línea parseable por herramientas de log agregado, con nivel y requestId
// correlacionado. Nunca guarda estado entre llamadas — cada llamada recibe
// sus propios campos, así que dos requests concurrentes nunca mezclan su
// requestId (no hay una variable compartida que uno pise al otro).

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  requestId?: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  const entry = { level, message, timestamp: new Date().toISOString(), ...fields };
  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

// Toda ruta bajo /api/ recibe x-request-id inyectado por src/middleware.ts;
// esto es solo la lectura de ese header con un fallback para llamadas
// directas (tests) que no pasan por el middleware.
export function getRequestId(request: Request): string {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}
