import { createOwnLenderCompany } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/lenders/me/companies — el propio Lender se crea una empresa
// (BE-101, nuevo, D-P4-5). Mismo servicio que la ruta de Admin, resolviendo
// el LenderProfile desde la sesión en vez de un :id.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await createOwnLenderCompany(request, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
