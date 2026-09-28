import { markLenderThreadRead } from "@/controllers/messages.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ borrowerProfileId: string }> };

// POST /api/lenders/me/messages/threads/:borrowerProfileId/read — marca
// como leídos los mensajes recibidos de ese Borrower (Fase 17, PB-030).
// `?lenderCompanyId=` obligatorio si el Lender tiene más de una empresa.
export async function POST(request: Request, { params }: RouteContext) {
  const { borrowerProfileId } = await params;
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return apiSuccess(await markLenderThreadRead(request, borrowerProfileId, query));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
