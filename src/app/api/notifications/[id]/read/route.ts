import { markRead } from "@/controllers/notifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/notifications/:id/read — marca una propia; 404 si no es suya (Fase 19, PB-036).
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    return apiSuccess(await markRead(request, id));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
