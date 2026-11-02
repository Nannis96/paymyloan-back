import { deactivate, getMine } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/affiliates/me — estado, código, link, tarifa y totales (Fase 21).
export async function GET(request: Request) {
  try {
    return apiSuccess(await getMine(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// DELETE /api/affiliates/me — el propio usuario deja de ser afiliado (INACTIVE).
export async function DELETE(request: Request) {
  try {
    return apiSuccess(await deactivate(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
