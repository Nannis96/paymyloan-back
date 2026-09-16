import { becomeLender } from "@/controllers/borrowerProfile.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/borrowers/me/become-lender — D-P7-1. Un BORROWER adquiere el rol
// LENDER además del que ya tiene, creando su LenderProfile y su primera
// LenderCompany en el mismo llamado.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await becomeLender(request, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
