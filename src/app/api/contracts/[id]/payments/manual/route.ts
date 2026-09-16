import { recordManualPayment } from "@/controllers/payments.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/contracts/:id/payments/manual — reconciliación manual (wire/
// cheque), sin depender de Stripe (BE-067).
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await recordManualPayment(request, id, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
