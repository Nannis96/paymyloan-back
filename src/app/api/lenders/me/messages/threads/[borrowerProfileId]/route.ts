import { getLenderThread } from "@/controllers/messages.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ borrowerProfileId: string }> };

// GET /api/lenders/me/messages/threads/:borrowerProfileId — historial
// paginado con ese Borrower (Fase 17, PB-029). `?lenderCompanyId=`
// obligatorio si el Lender tiene más de una empresa. 404 si nunca hubo
// mensajes con esa contraparte — el historial se puede seguir leyendo aunque
// la elegibilidad para escribir ya no se cumpla.
export async function GET(request: Request, { params }: RouteContext) {
  const { borrowerProfileId } = await params;
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return apiSuccess(await getLenderThread(request, borrowerProfileId, query));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
