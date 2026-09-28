import { reject } from "@/controllers/verifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiError, apiSuccess } from "@/lib/apiResponse";

// POST /api/admin/verifications/:id/reject (AD-003). Body `{ reason }`
// obligatorio. Solo una solicitud PENDING — 404 si no existe, 409 si ya se revisó.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
  }

  try {
    return apiSuccess(await reject(request, id, body));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
