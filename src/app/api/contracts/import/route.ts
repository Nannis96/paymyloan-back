import { importLegacyContract } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// POST /api/contracts/import — importa un contrato que ya venía cobrándose:
// nace ACTIVE con las cuotas pasadas como pagadas (Admin o Lender).
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await importLegacyContract(request, body);
    return apiSuccess(result, 201);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
