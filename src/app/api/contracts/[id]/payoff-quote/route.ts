import { getPayoffQuote } from "@/controllers/payments.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/contracts/:id/payoff-quote?asOf= — cuánto cuesta liquidar hoy.
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const result = await getPayoffQuote(request, id, query);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
