import { deleteLenderCompany, updateLenderCompany } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; companyId: string }> };

// PATCH /api/admin/lenders/:id/companies/:companyId — Admin edita cualquier
// campo de una LenderCompany puntual, incluidos status (suspender/
// reactivar) e isOpenToDeals (D-P4-8, nuevo).
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id, companyId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await updateLenderCompany(request, id, companyId, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// DELETE /api/admin/lenders/:id/companies/:companyId — soft delete de una
// sola empresa (no de todo el Lender), bloqueado con contratos
// ACTIVE/DELINQUENT (D-P4-8, nuevo).
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id, companyId } = await params;

  try {
    const result = await deleteLenderCompany(request, id, companyId);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
