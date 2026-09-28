import { listLenderThreads } from "@/controllers/messages.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/lenders/me/messages/threads — lista de Borrowers con al menos un
// mensaje enviado o recibido, con el último mensaje y el contador de no
// leídos (Fase 17, PB-029).
export async function GET(request: Request) {
  try {
    return apiSuccess(await listLenderThreads(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
