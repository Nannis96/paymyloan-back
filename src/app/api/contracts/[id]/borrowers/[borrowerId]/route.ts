import { removeContractBorrower } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; borrowerId: string }> };

// DELETE /api/contracts/:id/borrowers/:borrowerId — retira (soft, BE-057).
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id, borrowerId } = await params;
  try {
    const result = await removeContractBorrower(request, id, borrowerId);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
