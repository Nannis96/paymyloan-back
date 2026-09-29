import { unreadCount } from "@/controllers/notifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/notifications/unread-count — badge de la campana (Fase 19, PB-036).
export async function GET(request: Request) {
  try {
    return apiSuccess(await unreadCount(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
