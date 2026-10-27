import { confirmPaymentRequest } from "@/controllers/payments.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/transactions/:id/confirm — el Lender confirma una solicitud de
// abono/liquidación del Borrower (la aplica en el acto).
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await confirmPaymentRequest(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
