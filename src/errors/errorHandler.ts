import { AppError } from "@/errors/AppError";
import { apiError } from "@/lib/apiResponse";

// Wrapper que cada route handler llama desde su catch. Centraliza el mapeo
// error -> respuesta HTTP: un AppError conocido respeta su statusCode/code,
// cualquier otra excepción se trata como 500 y se loguea para diagnóstico.
export function handleRouteError(error: unknown) {
  if (error instanceof AppError) {
    return apiError(error.message, error.statusCode, error.code);
  }

  console.error(error);
  return apiError("Internal server error", 500, "INTERNAL_ERROR");
}
