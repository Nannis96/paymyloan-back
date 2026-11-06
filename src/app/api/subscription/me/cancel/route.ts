import { cancelMine } from "@/controllers/subscription.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
// POST /api/subscription/me/cancel — el acceso sigue hasta fin del periodo.
export async function POST(request: Request) {
  try {
    return apiSuccess(await cancelMine(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
