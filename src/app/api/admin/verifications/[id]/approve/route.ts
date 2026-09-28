import { approve } from "@/controllers/verifications.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// POST /api/admin/verifications/:id/approve (AD-003). Solo una solicitud
// PENDING — 404 si no existe, 409 si ya se revisó.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return apiSuccess(await approve(request, id));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
