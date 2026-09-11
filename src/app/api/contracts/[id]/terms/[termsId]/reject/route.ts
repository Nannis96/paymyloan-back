import { rejectContractTerms } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; termsId: string }> };

// POST /api/contracts/:id/terms/:termsId/reject — con comment (BE-061).
export async function POST(request: Request, { params }: RouteContext) {
  const { id, termsId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await rejectContractTerms(request, id, termsId, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
