import { deleteContract, getContract, updateContract } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/contracts/:id (BE-053).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await getContract(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// PATCH /api/contracts/:id (BE-054).
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const result = await updateContract(request, id, body);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// DELETE /api/contracts/:id — solo DRAFT sin transacciones (BE-055).
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const result = await deleteContract(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
