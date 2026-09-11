import { deleteFee } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; termsId: string; feeId: string }> };

// DELETE /api/contracts/:id/terms/:termsId/fees/:feeId — solo mientras DRAFT
// (PB-020).
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id, termsId, feeId } = await params;
  try {
    const result = await deleteFee(request, id, termsId, feeId);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
