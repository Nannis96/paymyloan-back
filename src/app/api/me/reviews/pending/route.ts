import { listPendingReviews } from "@/controllers/reviews.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/me/reviews/pending — contratos donde el usuario todavía no
// calificó a la contraparte (Fase 18, PB-034).
export async function GET(request: Request) {
  try {
    return apiSuccess(await listPendingReviews(request));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
