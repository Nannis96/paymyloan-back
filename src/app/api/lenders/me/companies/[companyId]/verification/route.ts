import { getLender, submitLender } from "@/controllers/verifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ companyId: string }> };

// GET /api/lenders/me/companies/:companyId/verification — la solicitud más
// reciente de esa empresa, o null si nunca se envió una (AD-003).
export async function GET(request: Request, { params }: RouteContext) {
  const { companyId } = await params;
  try {
    return apiSuccess(await getLender(request, companyId));
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/lenders/me/companies/:companyId/verification — envía la entidad a
// revisión del Admin (AD-003). 409 si ya hay una pendiente o ya está aprobada.
export async function POST(request: Request, { params }: RouteContext) {
  const { companyId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    return apiSuccess(await submitLender(request, companyId, body), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
