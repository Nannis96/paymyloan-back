import { sendLenderAlert } from "@/controllers/lenders.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/admin/lenders/:id/alerts — el Admin envía una notificación
// in-app (`ADMIN_ALERT`) al Lender. AB-10.
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    return apiSuccess(await sendLenderAlert(request, id, body), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
