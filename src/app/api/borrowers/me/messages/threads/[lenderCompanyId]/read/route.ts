import { markBorrowerThreadRead } from "@/controllers/messages.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ lenderCompanyId: string }> };

// POST /api/borrowers/me/messages/threads/:lenderCompanyId/read — marca
// como leídos los mensajes recibidos de esa LenderCompany (Fase 17, PB-030).
export async function POST(request: Request, { params }: RouteContext) {
  const { lenderCompanyId } = await params;
  try {
    return apiSuccess(await markBorrowerThreadRead(request, lenderCompanyId));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
