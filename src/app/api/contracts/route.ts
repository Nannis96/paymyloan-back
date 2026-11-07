import { createContract, listContracts } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
import { readJsonOrMultipart } from "@/lib/requestBody";

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
// JSON, o multipart/form-data con el JSON en `data` + archivos en `files`
// (cifrados, todo o nada — PB-002).
export async function POST(request: Request) {
  try {
    const { body, files } = await readJsonOrMultipart(request);
    const result = await createContract(request, body, files);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
