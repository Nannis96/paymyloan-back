import { validateCode } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/affiliates/validate?code=ABC123XY — público. Responde { valid } sin
// revelar datos del afiliado; un código mal formado también da valid:false.
export async function GET(request: Request) {
  try {
    return apiSuccess(await validateCode(request, Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
