import { adminGet } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/admin/affiliates/:id — ADMIN. Detalle + referidos + últimas comisiones.
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    return apiSuccess(await adminGet(request, id));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
