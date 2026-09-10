import { getOwnLender } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/lenders/me — perfil propio del Prestamista (BE-100, gap del mapa
// de endpoints §6.3 sin ticket asignado hasta ahora).
//
// D-P4-8: ya no hay PATCH acá — era solo LenderProfile.contactPhone,
// eliminado por redundante con User.phone. name/phone de User siguen en
// PATCH /api/auth/me (BE-099); los datos de una empresa se editan por
// PATCH /api/admin/lenders/:id/companies/:companyId (autoservicio del Lender
// para sus propias empresas no está pedido todavía).
export async function GET(request: Request) {
  try {
    const result = await getOwnLender(request);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
