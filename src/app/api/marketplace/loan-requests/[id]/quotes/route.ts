import { submitQuote, withdrawQuote } from "@/controllers/loanQuotes.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/marketplace/loan-requests/:id/quotes — crea o reemplaza la
// cotización propia; no crea el Contract (PB-026, D-S2-21).
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await submitQuote(request, id, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// DELETE /api/marketplace/loan-requests/:id/quotes — retira la cotización
// propia (PB-026).
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await withdrawQuote(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
