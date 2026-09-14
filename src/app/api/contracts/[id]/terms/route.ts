import { listContractTerms, proposeContractTerms } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/contracts/:id/terms — historial de versiones (BE-060).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await listContractTerms(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/contracts/:id/terms — propone nueva versión, solo si la vigente
// no está DRAFT (BE-060).
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await proposeContractTerms(request, id, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
