import { addFee, listFees } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; termsId: string }> };

// GET /api/contracts/:id/terms/:termsId/fees — Closing Fee Summary Table
// (PB-020).
export async function GET(request: Request, { params }: RouteContext) {
  const { id, termsId } = await params;
  try {
    const result = await listFees(request, id, termsId);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/contracts/:id/terms/:termsId/fees — agrega un ContractFeeItem,
// solo mientras DRAFT (PB-020).
export async function POST(request: Request, { params }: RouteContext) {
  const { id, termsId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await addFee(request, id, termsId, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
