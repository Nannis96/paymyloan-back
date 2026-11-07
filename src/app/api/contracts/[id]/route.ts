import { deleteContract, getContract, updateContract } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
import { readJsonOrMultipart } from "@/lib/requestBody";

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

  try {
    // JSON, o multipart con el JSON en `data` (opcional) + `files` (PB-002).
    const { body, files } = await readJsonOrMultipart(request, { dataOptional: true });
    const result = await updateContract(request, id, body, files);
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
