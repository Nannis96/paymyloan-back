import { deleteDocument } from "@/controllers/documents.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/documents/:id — solo quien lo subió (PB-002). Borra S3 + fila.
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    await deleteDocument(request, id);
    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleRouteError(error, request);
  }
}
