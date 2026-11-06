import { adminListCommissions } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/admin/affiliates/commissions — ADMIN. Filtros: status, affiliateId, payable=true.
export async function GET(request: Request) {
  try {
    return apiSuccess(await adminListCommissions(request, Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
