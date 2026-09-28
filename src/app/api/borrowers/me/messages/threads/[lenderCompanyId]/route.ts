import { getBorrowerThread } from "@/controllers/messages.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ lenderCompanyId: string }> };

// GET /api/borrowers/me/messages/threads/:lenderCompanyId — historial
// paginado con esa LenderCompany (Fase 17, PB-029). 404 si nunca hubo
// mensajes con esa contraparte — el historial se puede seguir leyendo aunque
// la elegibilidad para escribir ya no se cumpla.
export async function GET(request: Request, { params }: RouteContext) {
  const { lenderCompanyId } = await params;
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return apiSuccess(await getBorrowerThread(request, lenderCompanyId, query));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
