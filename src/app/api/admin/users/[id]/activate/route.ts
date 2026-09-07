import { activate } from "@/controllers/adminUsers.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/users/:id/activate — BE-097 (D-P2-1, riesgo #20). Solo
// ADMIN. Primera activación genera y envía contraseña temporal; una
// reactivación posterior solo reabre el acceso.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    const result = await activate(request, id);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
