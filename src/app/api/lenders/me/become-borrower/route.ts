import { becomeBorrower } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/lenders/me/become-borrower — D-P7-1. Un LENDER adquiere el rol
// BORROWER además del que ya tiene, completando la dirección que ese rol
// exige.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await becomeBorrower(request, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
