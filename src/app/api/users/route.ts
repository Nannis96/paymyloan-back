import { createUser, listUsers } from "@/controllers/users.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// GET /api/users — lista todos los usuarios no eliminados (activos e
// inactivos). Solo ADMIN (D-P2-4). Con ?page/pageSize/search/role/isActive
// responde paginado (AB-01); sin params, el array completo.
export async function GET(request: Request) {
  try {
    const users = await listUsers(request, Object.fromEntries(new URL(request.url).searchParams));
    return apiSuccess(users);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/users — alta de usuario por un Admin (identidad + rol,
// opcionalmente teléfono e isActive; sin contraseña, D-P2-5). Solo ADMIN
// (D-P2-4). No confundir con el auto-registro (POST /api/auth/register),
// que sí pide contraseña propia (D-P2-6).
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    const user = await createUser(request, body);
    return apiSuccess(user, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
