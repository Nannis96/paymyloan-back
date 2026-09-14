import { changeOwnPassword } from "@/controllers/borrowerProfile.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/borrowers/me/password — cambia la contraseña temporal en el
// primer login (BE-050). Exige la contraseña actual; siempre accesible,
// incluso con mustChangePassword:true (D-P4-2) — es el único camino para
// apagarlo.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await changeOwnPassword(request, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
