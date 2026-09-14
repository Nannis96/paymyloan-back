import { AppError } from "@/errors/AppError";
import { apiError } from "@/lib/apiResponse";
import { getRequestId, logger } from "@/lib/logger";

// Wrapper que cada route handler llama desde su catch. Centraliza el mapeo
// error -> respuesta HTTP: un AppError conocido respeta su statusCode/code,
// cualquier otra excepción se trata como 500 y se loguea con requestId para
// que sea rastreable de punta a punta (BE-004). `request` es opcional para
// no romper llamadas existentes, pero se debe pasar siempre que se tenga.
export function handleRouteError(error: unknown, request?: Request) {
  const requestId = request ? getRequestId(request) : undefined;

  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      logger.error(error.message, { requestId, code: error.code });
    }
    return apiError(error.message, error.statusCode, error.code);
  }

  logger.error(error instanceof Error ? error.message : String(error), {
    requestId,
    stack: error instanceof Error ? error.stack : undefined,
  });
  return apiError("Internal server error", 500, "INTERNAL_ERROR");
}
