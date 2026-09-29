import { list } from "@/controllers/notifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/notifications — propias, más nuevas primero (Fase 19, PB-036).
// Filtros: ?isRead=true|false, ?type=, ?page=, ?pageSize=.
export async function GET(request: Request) {
  try {
    return apiSuccess(await list(request, Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
