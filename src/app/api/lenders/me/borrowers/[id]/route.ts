import { getBorrower, removeBorrower, updateBorrower } from "@/controllers/lenderBorrowers.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/lenders/me/borrowers/:id (BE-047).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const result = await getBorrower(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// PATCH /api/lenders/me/borrowers/:id (BE-048).
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await updateBorrower(request, id, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// DELETE /api/lenders/me/borrowers/:id — desvincula, no borra el perfil
// (M-3, BE-049).
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const result = await removeBorrower(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
