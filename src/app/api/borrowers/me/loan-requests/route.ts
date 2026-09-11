import { createLoanRequest, listLoanRequests } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// GET /api/borrowers/me/loan-requests — propios, cualquier status (PB-011).
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const result = await listLoanRequests(request, query);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/borrowers/me/loan-requests — crea LoanRequest(DRAFT) + Property
// embebida (D-P6-2/D-S2-25, PB-011).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await createLoanRequest(request, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
