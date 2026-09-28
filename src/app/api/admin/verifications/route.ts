import { list } from "@/controllers/verifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/admin/verifications — cola de verificaciones, con filtros
// `status`/`subject`/`search` y paginación (AD-003). ADMIN, lectura exenta de 2FA.
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return apiSuccess(await list(request, query));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
