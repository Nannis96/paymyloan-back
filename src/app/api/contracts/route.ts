import { createContract, listContracts } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// GET /api/contracts — lista + filtros + paginación, por rol (BE-052).
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const result = await listContracts(request, query);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/contracts — crea Property + Contract(DRAFT) + ContractTerms(v1,
// DRAFT) en una transacción (BE-051, D-P6-2).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await createContract(request, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
