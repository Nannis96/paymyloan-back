import { z } from "zod";
import { getRequestMeta } from "@/lib/requestMeta";
import { checkRateLimit } from "@/middlewares/rateLimit";
import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as affiliatesService from "@/services/affiliates.service";
import { parseOrThrow } from "@/validations/parse";
import { paginationQuerySchema } from "@/validations/pagination";
import {
  adminListAffiliatesQuerySchema,
  adminListCommissionsQuerySchema,
  affiliateTermsSchema,
  approveAffiliateSchema,
  manualCommissionSchema,
  markPaidSchema,
  myCommissionsQuerySchema,
  reasonSchema,
  referralCodeSchema,
  setPayableAtSchema,
  voidCommissionSchema,
} from "@/validations/affiliates.validation";

// Fase 21 (Docs/plan/19-afiliados.md §19.5). Usuario: cualquier sesión
// autenticada, sin rol ni 2FA (no es una escritura de negocio sobre
// terceros). Admin: 2FA obligatorio por default (D-P3-1).
async function requireAdminSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"]);
  return session;
}

const idSchema = z.string().uuid("Invalid id");
const pageQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true });

// Público, sin sesión. Limitado por IP para que no sirva para adivinar códigos.
export async function validateCode(request: Request, query: { code?: string }) {
  checkRateLimit(`affiliate-validate:${getRequestMeta(request).ipAddress ?? "unknown"}`, { max: 30, windowMs: 900_000 });
  const parsed = referralCodeSchema.safeParse(query.code);
  return { valid: parsed.success ? await affiliatesService.isReferralCodeValid(parsed.data) : false };
}

export async function apply(request: Request) {
  const session = await withAuth(request);
  return affiliatesService.applyAffiliate(session.userId);
}

export async function deactivate(request: Request) {
  const session = await withAuth(request);
  return affiliatesService.deactivateAffiliate(session.userId);
}

export async function getMine(request: Request) {
  const session = await withAuth(request);
  return affiliatesService.getMyAffiliate(session.userId);
}

export async function listMyReferrals(request: Request, query: unknown) {
  const session = await withAuth(request);
  return affiliatesService.listMyReferrals(session.userId, parseOrThrow(pageQuerySchema, query));
}

export async function listMyCommissions(request: Request, query: unknown) {
  const session = await withAuth(request);
  return affiliatesService.listMyCommissions(session.userId, parseOrThrow(myCommissionsQuerySchema, query));
}

export async function adminList(request: Request, query: unknown) {
  await requireAdminSession(request);
  return affiliatesService.adminListAffiliates(parseOrThrow(adminListAffiliatesQuerySchema, query));
}

export async function adminGet(request: Request, id: string) {
  await requireAdminSession(request);
  return affiliatesService.adminGetAffiliate(parseOrThrow(idSchema, id));
}

export async function adminApprove(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return affiliatesService.adminApproveAffiliate(parseOrThrow(idSchema, id), session.userId, parseOrThrow(approveAffiliateSchema, body ?? {}));
}

export async function adminReject(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return affiliatesService.adminRejectAffiliate(parseOrThrow(idSchema, id), session.userId, parseOrThrow(reasonSchema, body).reason);
}

export async function adminSuspend(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return affiliatesService.adminSuspendAffiliate(parseOrThrow(idSchema, id), session.userId, parseOrThrow(reasonSchema, body).reason);
}

export async function adminSetTerms(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return affiliatesService.adminSetAffiliateTerms(parseOrThrow(idSchema, id), session.userId, parseOrThrow(affiliateTermsSchema, body));
}

export async function adminCreateCommission(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return affiliatesService.adminCreateManualCommission(parseOrThrow(idSchema, id), session.userId, parseOrThrow(manualCommissionSchema, body));
}

export async function adminListCommissions(request: Request, query: unknown) {
  await requireAdminSession(request);
  return affiliatesService.adminListCommissions(parseOrThrow(adminListCommissionsQuerySchema, query));
}

export async function adminSetPayableAt(request: Request, id: string, body: unknown) {
  await requireAdminSession(request);
  return affiliatesService.adminSetCommissionPayableAt(parseOrThrow(idSchema, id), parseOrThrow(setPayableAtSchema, body).payableAt);
}

export async function adminMarkPaid(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return affiliatesService.adminMarkCommissionPaid(parseOrThrow(idSchema, id), session.userId, parseOrThrow(markPaidSchema, body ?? {}));
}

export async function adminVoid(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return affiliatesService.adminVoidCommission(parseOrThrow(idSchema, id), session.userId, parseOrThrow(voidCommissionSchema, body).note);
}
