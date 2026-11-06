import { payMine } from "@/controllers/subscription.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
// POST /api/subscription/me/pay — cobro simulado (BILLING_MODE=simulated).
export async function POST(request: Request) {
  try {
    return apiSuccess(await payMine(request), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
