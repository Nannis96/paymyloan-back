import { resetPassword } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/auth/password/reset — revoca todos los refresh tokens del
// usuario (BE-032, §7.3).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("JSON inválido en el body", 400, "INVALID_JSON");
  }

  try {
    const result = await resetPassword(body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
