import { logoutAll } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// POST /api/auth/logout-all — revoca todos los refresh tokens del usuario
// autenticado (BE-030).
export async function POST(request: Request) {
  try {
    const result = await logoutAll(request);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
