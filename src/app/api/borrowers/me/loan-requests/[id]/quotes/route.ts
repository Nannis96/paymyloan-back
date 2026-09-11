import { listReceivedQuotes } from "@/controllers/loanQuotes.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/borrowers/me/loan-requests/:id/quotes — cotizaciones recibidas,
// para comparar (D-S2-21).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await listReceivedQuotes(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
