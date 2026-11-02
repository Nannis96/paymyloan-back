import { apply } from "@/controllers/affiliates.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// POST /api/affiliates/me/apply — pide ser afiliado (PENDING o APPROVED según AFFILIATE_APPROVAL_MODE).
export async function POST(request: Request) {
  try {
    return apiSuccess(await apply(request), 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
