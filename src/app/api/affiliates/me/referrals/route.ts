import { listMyReferrals } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/affiliates/me/referrals — sus referidos (sin correo ni teléfono).
export async function GET(request: Request) {
  try {
    return apiSuccess(await listMyReferrals(request, Object.fromEntries(new URL(request.url).searchParams)));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
