import { adminCreateCommission } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/affiliates/:id/commissions — ADMIN. Comisión manual { amountCents, referredUserId?, note, payableAt? }.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  try {
    return apiSuccess(await adminCreateCommission(request, id, await request.json().catch(() => null)), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
