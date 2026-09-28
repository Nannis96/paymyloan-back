import { listBorrowerThreads } from "@/controllers/messages.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/borrowers/me/messages/threads — lista de LenderCompany con al
// menos un mensaje enviado o recibido, con el último mensaje y el contador
// de no leídos (Fase 17, PB-029).
export async function GET(request: Request) {
  try {
    return apiSuccess(await listBorrowerThreads(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
