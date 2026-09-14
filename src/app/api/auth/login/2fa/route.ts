import { loginTwoFactor } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { getRequestMeta } from "@/lib/requestMeta";

// POST /api/auth/login/2fa — paso 2 (§7.2): TOTP o recovery code de un solo
// uso contra el pendingToken de /login. BE-028: bucket de rate limit propio.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await loginTwoFactor(body, getRequestMeta(request));
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
