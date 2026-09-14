import { publishLoanRequest } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/borrowers/me/loan-requests/:id/publish — DRAFT -> PUBLISHED
// (PB-011).
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await publishLoanRequest(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
