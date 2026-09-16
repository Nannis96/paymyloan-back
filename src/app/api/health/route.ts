import { env } from "@/config/env";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/health — sonda de infraestructura (Docker HEALTHCHECK, balanceador,
// monitoreo). No es un endpoint de negocio.
export async function GET(request: Request) {
  try {
    return apiSuccess({
      status: "ok" as const,
      environment: env.nodeEnv,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
