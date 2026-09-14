import { verify } from "@/controllers/twoFactor.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/auth/2fa/verify — activa 2FA y devuelve 8 recovery codes en
// claro, una única vez (BE-033).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await verify(request, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
