import { adminCancel } from "@/controllers/subscription.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/subscriptions/:id/cancel — ADMIN. Body { immediate? }.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    return apiSuccess(await adminCancel(request, id, await request.json().catch(() => null)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
