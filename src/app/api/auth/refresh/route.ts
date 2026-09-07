import { refresh } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { getRequestMeta } from "@/lib/requestMeta";

// POST /api/auth/refresh — rota siempre (BE-029). Reusar un refresh token
// ya rotado revoca toda la cadena del usuario (señal de robo, §7.2).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("JSON inválido en el body", 400, "INVALID_JSON");
  }

  try {
    const result = await refresh(body, getRequestMeta(request));
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
