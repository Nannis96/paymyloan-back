import { adminList } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/admin/affiliates — ADMIN. Filtros: status, search, page, pageSize.
export async function GET(request: Request) {
  try {
    return apiSuccess(await adminList(request, Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
