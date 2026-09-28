import { getBorrower, submitBorrower } from "@/controllers/verifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// GET /api/borrowers/me/verification — la solicitud más reciente del Deudor,
// o null si nunca envió una (AD-003).
export async function GET(request: Request) {
  try {
    return apiSuccess(await getBorrower(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/borrowers/me/verification — envía la entidad del Deudor a
// revisión del Admin (AD-003). 409 si ya hay una pendiente o ya está aprobada.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    return apiSuccess(await submitBorrower(request, body), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
