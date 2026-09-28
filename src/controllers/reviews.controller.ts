import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as reviewsService from "@/services/reviews.service";
import { paginationQuerySchema } from "@/validations/pagination";
import { parseOrThrow } from "@/validations/parse";
import { createReviewSchema } from "@/validations/reviews.validation";

// Fase 18 (PB-031..034). Calificar no mueve plata ni cambia el estado de un
// contrato (mismo criterio que mensajería, D-P3-1): ningún endpoint exige 2FA.

export async function createContractReview(request: Request, contractId: string, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER"], { requireTwoFactor: false });
  return reviewsService.createReview(session, contractId, parseOrThrow(createReviewSchema, body));
}

// Lectura: además de las partes, el Admin puede ver (mismo criterio que
// contratos/pagos, Fase 7).
export async function listContractReviews(request: Request, contractId: string) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER", "ADMIN"], { requireTwoFactor: false });
  return reviewsService.listContractReviews(session, contractId);
}

export async function getLenderRating(request: Request, lenderCompanyId: string, query: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER", "ADMIN"], { requireTwoFactor: false });
  return reviewsService.getLenderRating(lenderCompanyId, parseOrThrow(paginationQuerySchema, query));
}

export async function getBorrowerRating(request: Request, borrowerProfileId: string, query: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER", "ADMIN"], { requireTwoFactor: false });
  return reviewsService.getBorrowerRating(session, borrowerProfileId, parseOrThrow(paginationQuerySchema, query));
}

export async function listPendingReviews(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER", "BORROWER"], { requireTwoFactor: false });
  return reviewsService.listPendingReviews(session.userId);
}
