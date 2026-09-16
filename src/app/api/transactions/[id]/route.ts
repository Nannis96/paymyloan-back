import { getTransaction } from "@/controllers/payments.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/transactions/:id (BE-069).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await getTransaction(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
