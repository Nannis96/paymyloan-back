import { sendBorrower } from "@/controllers/messages.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/borrowers/me/messages — el Borrower le manda un mensaje a una
// LenderCompany (Fase 17, PB-028). 403 MESSAGING_NOT_ALLOWED si no hay una
// oferta en negociación ni un préstamo entre ambos.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    return apiSuccess(await sendBorrower(request, body), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
