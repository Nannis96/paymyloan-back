import { createUser, listUsers } from "@/controllers/users.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// GET /api/users — lista los usuarios activos (excluye eliminados lógicamente).
export async function GET() {
  try {
    const users = await listUsers();
    return apiSuccess(users);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/users — alta de usuario (identidad + contraseña + 2FA, sin rol
// de negocio; ver alcance §3/§7). El rol se asigna después, por préstamo.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("JSON inválido en el body", 400, "INVALID_JSON");
  }

  try {
    const user = await createUser(body);
    return apiSuccess(user, 201);
  } catch (error) {
    return handleRouteError(error);
  }
}
