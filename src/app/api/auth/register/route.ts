import { register } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/auth/register — PB-013/D-P2-1: alta propia de LENDER o
// BORROWER (D-P1-10), sin contraseña. Responde 202 siempre con el mismo
// mensaje genérico, exista o no ya el correo (anti-enumeración).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("JSON inválido en el body", 400, "INVALID_JSON");
  }

  try {
    const result = await register(body);
    return apiSuccess(result, 202);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
