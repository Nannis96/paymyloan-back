import { getMine } from "@/controllers/subscription.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
// GET /api/subscription/me — estado efectivo de la suscripción (Fase 20, §18.7).
export async function GET(request: Request) {
  try {
    return apiSuccess(await getMine(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
