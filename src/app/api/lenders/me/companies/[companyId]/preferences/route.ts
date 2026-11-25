import { getOwnLendingPreferences, setOwnLendingPreferences } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ companyId: string }> };

// GET /api/lenders/me/companies/:companyId/preferences — `data` es null si aún no se configuraron.
export async function GET(request: Request, { params }: RouteContext) {
  const { companyId } = await params;
  try {
    return apiSuccess(await getOwnLendingPreferences(request, companyId));
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// PUT /api/lenders/me/companies/:companyId/preferences — reemplaza las preferencias completas.
export async function PUT(request: Request, { params }: RouteContext) {
  const { companyId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }
  try {
    return apiSuccess(await setOwnLendingPreferences(request, companyId, body));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
