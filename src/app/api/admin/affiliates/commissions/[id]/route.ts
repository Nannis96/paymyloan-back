import { adminSetPayableAt } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/admin/affiliates/commissions/:id — ADMIN. Body { payableAt }.
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    return apiSuccess(await adminSetPayableAt(request, id, await request.json().catch(() => null)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
