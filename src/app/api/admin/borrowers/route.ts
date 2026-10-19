import { listAdminBorrowers } from "@/controllers/adminBorrowers.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/admin/borrowers — lista + búsqueda + paginación (AB-02). ADMIN.
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return apiSuccess(await listAdminBorrowers(request, query));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
