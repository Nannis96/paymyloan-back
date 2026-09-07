import { createUser, listUsers } from "@/controllers/users.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// GET /api/users — lista todos los usuarios no eliminados (activos e
// inactivos). Solo ADMIN (D-P2-4).
export async function GET(request: Request) {
  try {
    const users = await listUsers(request);
    return apiSuccess(users);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/users — alta de usuario por un Admin (identidad + contraseña +
// rol, opcionalmente teléfono e isActive). Solo ADMIN (D-P2-4). No confundir
// con el auto-registro (POST /api/auth/register), que no pide contraseña.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("JSON inválido en el body", 400, "INVALID_JSON");
  }

  try {
    const user = await createUser(request, body);
    return apiSuccess(user, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
