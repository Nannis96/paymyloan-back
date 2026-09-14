import { submitContractTerms } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; termsId: string }> };

// POST /api/contracts/:id/terms/:termsId/submit — DRAFT -> PENDING_ACCEPTANCE,
// notifica a deudores (BE-060).
export async function POST(request: Request, { params }: RouteContext) {
  const { id, termsId } = await params;
  try {
    const result = await submitContractTerms(request, id, termsId);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
