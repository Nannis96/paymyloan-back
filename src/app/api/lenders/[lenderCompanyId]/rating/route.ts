import { getLenderRating } from "@/controllers/reviews.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ lenderCompanyId: string }> };

// GET /api/lenders/:lenderCompanyId/rating — promedio, distribución y
// reseñas paginadas de una LenderCompany (Fase 18, PB-033).
export async function GET(request: Request, { params }: RouteContext) {
  const { lenderCompanyId } = await params;
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return apiSuccess(await getLenderRating(request, lenderCompanyId, query));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
