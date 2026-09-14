import { deleteLender, getLender } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/admin/lenders/:id — detalle + conteo de deudores/contratos
// activos de todas sus LenderCompany (BE-042).
//
// D-P4-8: ya no hay PATCH acá — era solo LenderProfile.contactPhone,
// eliminado por redundante con User.phone. Editar los datos de una empresa
// puntual es PATCH /api/admin/lenders/:id/companies/:companyId.
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const result = await getLender(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// DELETE /api/admin/lenders/:id — soft delete, bloqueado con contratos
// ACTIVE/DELINQUENT (BE-044).
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const result = await deleteLender(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
