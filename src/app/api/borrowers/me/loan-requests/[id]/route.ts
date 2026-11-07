import { getLoanRequest, updateLoanRequest } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
import { readJsonOrMultipart } from "@/lib/requestBody";

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

  try {
    // JSON, o multipart con el JSON en `data` (opcional) + `files` (PB-002).
    const { body, files } = await readJsonOrMultipart(request, { dataOptional: true });
    const result = await updateLoanRequest(request, id, body, files);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
