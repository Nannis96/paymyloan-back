import { listTransactions } from "@/controllers/payments.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/contracts/:id/transactions — historial de pagos del contrato,
// paginado (BE-069).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const result = await listTransactions(request, id, query);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
