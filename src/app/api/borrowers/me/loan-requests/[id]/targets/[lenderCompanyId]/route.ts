import { removeLoanRequestTarget } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; lenderCompanyId: string }> };

// DELETE /api/borrowers/me/loan-requests/:id/targets/:lenderCompanyId
// (D-S2-22).
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id, lenderCompanyId } = await params;
  try {
    const result = await removeLoanRequestTarget(request, id, lenderCompanyId);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
