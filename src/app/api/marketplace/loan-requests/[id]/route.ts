import { getMarketplaceLoanRequest } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/marketplace/loan-requests/:id.
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await getMarketplaceLoanRequest(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
