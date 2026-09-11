import { listMarketplaceLoanRequests } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/marketplace/loan-requests — PUBLIC visibles a todos + PRIVATE
// donde el Lender está en LoanRequestLenderTarget (D-S2-22).
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const result = await listMarketplaceLoanRequests(request, query);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
