import { createContractReview, listContractReviews } from "@/controllers/reviews.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/contracts/:id/reviews — el Lender o un Borrower del contrato
// califica a la contraparte (Fase 18, PB-032). El sentido se infiere del lado
// del contrato, no del body.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    return apiSuccess(await createContractReview(request, id, body), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// GET /api/contracts/:id/reviews — reseñas del contrato + si el usuario
// actual todavía puede calificar (Fase 18, PB-032).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    return apiSuccess(await listContractReviews(request, id));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
