import { setup } from "@/controllers/twoFactor.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// POST /api/auth/2fa/setup — ADMIN/LENDER autenticados. Genera el secreto
// TOTP sin activar 2FA todavía (BE-033, §7.4).
export async function POST(request: Request) {
  try {
    const result = await setup(request);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
