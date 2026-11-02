import { adminReject } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/affiliates/:id/reject — ADMIN. Body { reason }.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    return apiSuccess(await adminReject(request, id, await request.json().catch(() => null)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
