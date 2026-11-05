import { listDocuments, uploadDocuments } from "@/controllers/documents.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/contracts/:id/documents — metadatos (PB-002).
export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    return apiSuccess(await listDocuments(request, "contract", id));
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/contracts/:id/documents — multipart/form-data, campo `files` repetible.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let files: File[];
  try {
    files = (await request.formData()).getAll("files").filter((value): value is File => value instanceof File);
  } catch {
    return apiError("Request body must be multipart/form-data", 400, "INVALID_FORM_DATA");
  }

  try {
    return apiSuccess(await uploadDocuments(request, "contract", id, files), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
