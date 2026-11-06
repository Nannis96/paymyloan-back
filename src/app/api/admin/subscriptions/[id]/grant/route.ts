import { adminGrant } from "@/controllers/subscription.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/subscriptions/:id/grant — ADMIN. Body { days, reason }.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    return apiSuccess(await adminGrant(request, id, await request.json().catch(() => null)), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
