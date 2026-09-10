import { listLenders } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/admin/lenders — lista + búsqueda + paginación (BE-041). ADMIN,
// lectura exenta de 2FA.
//
// D-P4-5: ya no hay POST acá — dar de alta la persona (User+LenderProfile)
// es autoservicio (POST /api/auth/register, D-P2-1); asociarle una
// LenderCompany es POST /api/admin/lenders/:id/companies.
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const result = await listLenders(request, query);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
