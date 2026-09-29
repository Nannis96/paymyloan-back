import { markAllRead } from "@/controllers/notifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// POST /api/notifications/read-all — marca todas las propias (Fase 19, PB-036).
export async function POST(request: Request) {
  try {
    return apiSuccess(await markAllRead(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
