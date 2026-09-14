import { deactivate } from "@/controllers/adminUsers.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/users/:id/deactivate — BE-097. Solo ADMIN. Revoca además
// todos los refresh tokens vigentes del usuario.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const result = await deactivate(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
