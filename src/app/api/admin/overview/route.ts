import { getOverview } from "@/controllers/adminOverview.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/admin/overview — métricas agregadas del panel de Admin (AD-001).
export async function GET(request: Request) {
  try {
    return apiSuccess(await getOverview(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
