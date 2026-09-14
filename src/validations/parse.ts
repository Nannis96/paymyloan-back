import type { ZodType } from "zod";
import { AppError } from "@/errors/AppError";

// Compartido por todos los controllers (extraído de users.controller.ts):
// convierte un fallo de Zod en un AppError 400 uniforme en vez de que cada
// controller repita el mismo try/catch.
export function parseOrThrow<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues[0]?.message ?? "Invalid data";
    throw new AppError(message, 400, "VALIDATION_ERROR");
  }
  return result.data;
}
