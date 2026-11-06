import { listMyPayments } from "@/controllers/subscription.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
// GET /api/subscription/me/payments — historial paginado.
export async function GET(request: Request) {
  try {
    return apiSuccess(await listMyPayments(request, Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
