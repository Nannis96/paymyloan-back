import { getHealthStatus } from "@/controllers/health.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/health — sonda de infraestructura (Docker HEALTHCHECK, balanceador,
// monitoreo). No es un endpoint de negocio.
export async function GET() {
  try {
    const status = getHealthStatus();
    return apiSuccess(status);
  } catch (error) {
    return handleRouteError(error);
  }
}
