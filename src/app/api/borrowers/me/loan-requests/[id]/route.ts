import { getLoanRequest, updateLoanRequest } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/borrowers/me/loan-requests/:id (PB-011).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await getLoanRequest(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// PATCH /api/borrowers/me/loan-requests/:id — solo mientras DRAFT (PB-011).
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await updateLoanRequest(request, id, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
