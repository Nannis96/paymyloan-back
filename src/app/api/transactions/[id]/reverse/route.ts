import { reverseTransaction } from "@/controllers/payments.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/transactions/:id/reverse — ADMIN-only (ACH return / corrección
// manual), BE-071.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await reverseTransaction(request, id, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
