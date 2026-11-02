import { listMyCommissions } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/affiliates/me/commissions — sus comisiones. Filtro: status.
export async function GET(request: Request) {
  try {
    return apiSuccess(await listMyCommissions(request, Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
