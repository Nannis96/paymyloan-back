import { me, updateMe } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// GET /api/auth/me — perfil propio + LenderProfile/BorrowerProfile según
// el rol, incluyendo la lista de LenderCompany asociadas (BE-031, D-P2-2:
// el JWT ya no trae un lenderId resuelto, ver 07-autenticacion... §7.1).
export async function GET(request: Request) {
  try {
    const result = await me(request);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// PATCH /api/auth/me — el usuario autenticado edita su propia información
// personal (nombre, teléfono). Nunca email/password/role/isActive (D-P2-4).
export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await updateMe(request, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
