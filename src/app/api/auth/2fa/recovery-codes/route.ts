import { recoveryCodes } from "@/controllers/twoFactor.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/auth/2fa/recovery-codes — regenera el set de 8 códigos,
// invalidando los anteriores; misma exigencia de contraseña + código
// vigente que /disable (BE-034).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("JSON inválido en el body", 400, "INVALID_JSON");
  }

  try {
    const result = await recoveryCodes(request, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
