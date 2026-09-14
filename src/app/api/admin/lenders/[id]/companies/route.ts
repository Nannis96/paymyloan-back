import { createLenderCompany } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/lenders/:id/companies — un Admin asocia una LenderCompany
// nueva a un Lender que ya existe (:id = LenderProfile.id). D-P4-5,
// rescopeo de BE-040: ya no crea la persona, solo la empresa.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await createLenderCompany(request, id, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
