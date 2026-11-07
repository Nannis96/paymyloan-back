import { createLoanRequest, listLoanRequests } from "@/controllers/loanRequests.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
import { readJsonOrMultipart } from "@/lib/requestBody";

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
// JSON, o multipart/form-data con el JSON en `data` + archivos en `files`
// (cifrados, todo o nada — PB-002).
export async function POST(request: Request) {
  try {
    const { body, files } = await readJsonOrMultipart(request);
    const result = await createLoanRequest(request, body, files);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
