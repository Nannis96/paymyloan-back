import { getBorrowerRating } from "@/controllers/reviews.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ borrowerProfileId: string }> };

// GET /api/borrowers/:borrowerProfileId/rating — promedio y distribución;
// `reviews` solo si el que consulta puede ver comentarios (Fase 18, PB-033;
// mismo path que PB-009, que agregará el score calculado).
export async function GET(request: Request, { params }: RouteContext) {
  const { borrowerProfileId } = await params;
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return apiSuccess(await getBorrowerRating(request, borrowerProfileId, query));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
