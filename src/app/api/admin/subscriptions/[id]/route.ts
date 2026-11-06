import { adminGet } from "@/controllers/subscription.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/admin/subscriptions/:id — ADMIN. Detalle + pagos.
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    return apiSuccess(await adminGet(request, id));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
