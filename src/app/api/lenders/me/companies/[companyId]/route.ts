import { deleteOwnLenderCompany, updateOwnLenderCompany } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ companyId: string }> };

// PATCH /api/lenders/me/companies/:companyId — D-P4-9, nuevo. El propio
// Lender edita una empresa suya (mismos campos que la creación, sin
// `status` — suspender/reactivar sigue siendo exclusivo del Admin, ver
// PATCH /api/admin/lenders/:id/companies/:companyId).
export async function PATCH(request: Request, { params }: RouteContext) {
  const { companyId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await updateOwnLenderCompany(request, companyId, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// DELETE /api/lenders/me/companies/:companyId — D-P4-9, nuevo. Mismas
// reglas que la variante Admin: soft-delete de esa sola empresa, bloqueado
// si tiene un Contract ACTIVE/DELINQUENT.
export async function DELETE(request: Request, { params }: RouteContext) {
  const { companyId } = await params;

  try {
    const result = await deleteOwnLenderCompany(request, companyId);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
