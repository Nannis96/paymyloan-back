import { selectQuote } from "@/controllers/loanQuotes.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; quoteId: string }> };

// POST /api/borrowers/me/loan-requests/:id/quotes/:quoteId/select — elige
// una cotización, crea el Contract (PB-017, D-S2-21).
export async function POST(request: Request, { params }: RouteContext) {
  const { id, quoteId } = await params;
  try {
    const result = await selectQuote(request, id, quoteId);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
