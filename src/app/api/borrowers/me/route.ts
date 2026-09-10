import { getOwnProfile, updateOwnProfile } from "@/controllers/borrowerProfile.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// GET /api/borrowers/me — perfil propio del Deudor (BE-050).
export async function GET(request: Request) {
  try {
    const result = await getOwnProfile(request);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// PATCH /api/borrowers/me — campos de contacto propios, nunca lenderId
// (BE-050). Bloqueado con 403 PASSWORD_CHANGE_REQUIRED si todavía usa la
// contraseña generada (D-P4-2).
export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await updateOwnProfile(request, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
