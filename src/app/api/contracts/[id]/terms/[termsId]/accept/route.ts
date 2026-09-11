import { acceptContractTerms } from "@/controllers/contracts.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

type RouteContext = { params: Promise<{ id: string; termsId: string }> };

// POST /api/contracts/:id/terms/:termsId/accept — registra
// ContractTermsAcceptance, dispara activación/regeneración de calendario si
// completa el quórum (BE-061).
export async function POST(request: Request, { params }: RouteContext) {
  const { id, termsId } = await params;
  try {
    const result = await acceptContractTerms(request, id, termsId);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
