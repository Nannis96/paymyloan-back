import { getBalance } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/contracts/:id/balance — saldo vivo + interés devengado no
// facturado (BE-062).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await getBalance(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
