import { AppError } from "@/errors/AppError";

// Body de las altas/ediciones que aceptan archivos (POST/PATCH de
// /api/contracts y /api/borrowers/me/loan-requests): JSON como siempre, o
// multipart/form-data con el mismo JSON en el campo `data` y los archivos
// en `files` (repetible).
// `dataOptional` (PATCH): en multipart se puede mandar solo `files`, sin `data`.
export async function readJsonOrMultipart(
  request: Request,
  { dataOptional = false }: { dataOptional?: boolean } = {},
): Promise<{ body: unknown; files: File[] }> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    try {
      return { body: await request.json(), files: [] };
    } catch {
      throw new AppError("Invalid JSON in request body", 400, "INVALID_JSON");
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError("Request body must be multipart/form-data", 400, "INVALID_FORM_DATA");
  }
  const data = form.get("data");
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (data === null && dataOptional) return { body: undefined, files };
  if (typeof data !== "string") {
    throw new AppError("Field 'data' (JSON) is required in multipart requests", 400, "INVALID_FORM_DATA");
  }
  let body: unknown;
  try {
    body = JSON.parse(data);
  } catch {
    throw new AppError("Field 'data' must be valid JSON", 400, "INVALID_JSON");
  }
  return { body, files };
}
