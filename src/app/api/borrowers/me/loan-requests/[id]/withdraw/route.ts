import { withdrawLoanRequest } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/borrowers/me/loan-requests/:id/withdraw — PUBLISHED -> WITHDRAWN
// (PB-011).
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await withdrawLoanRequest(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
