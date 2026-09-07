import { me } from "@/controllers/auth.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

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
