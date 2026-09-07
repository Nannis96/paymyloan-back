import { forgotPassword } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";
import { getRequestMeta } from "@/lib/requestMeta";

// POST /api/auth/password/forgot — siempre 200, exista o no el correo
// (BE-032, anti-enumeración, §7.3).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("JSON inválido en el body", 400, "INVALID_JSON");
  }

  try {
    const result = await forgotPassword(body, getRequestMeta(request));
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
