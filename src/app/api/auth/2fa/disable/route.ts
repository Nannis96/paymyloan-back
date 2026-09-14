import { disable } from "@/controllers/twoFactor.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/auth/2fa/disable — exige contraseña + código TOTP vigente, no
// solo la sesión activa (BE-034).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await disable(request, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
