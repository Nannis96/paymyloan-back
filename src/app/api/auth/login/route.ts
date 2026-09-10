import { login } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { getRequestMeta } from "@/lib/requestMeta";

// POST /api/auth/login — paso 1 (§7.2). Sin 2FA: emite tokens directo. Con
// 2FA: { requiresTwoFactor: true, pendingToken }, sin emitir sesión.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await login(body, getRequestMeta(request));
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
