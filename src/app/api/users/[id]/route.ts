import { deleteUser, updateUser } from "@/controllers/users.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/users/:id — edición parcial (nombre, correo y/o contraseña).
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("JSON inválido en el body", 400, "INVALID_JSON");
  }

  try {
    const user = await updateUser(id, body);
    return apiSuccess(user);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// DELETE /api/users/:id — eliminado lógico: apaga el usuario (deletedAt).
// Nunca borra la fila, porque puede quedar referenciada desde préstamos,
// documentos o la bitácora de auditoría.
export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const user = await deleteUser(id);
    return apiSuccess(user);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
