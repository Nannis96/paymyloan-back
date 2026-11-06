import { randomInt } from "node:crypto";
import { Prisma, type AffiliateCommission, type AffiliateCommissionType, type AffiliateProfile } from "@prisma/client";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { notify } from "@/lib/notify";
import type { FirstSubscriptionPaymentEvent } from "@/services/subscription.service";
import type {
  AdminListAffiliatesQuery,
  AdminListCommissionsQuery,
  ApproveAffiliateInput,
  AffiliateTermsInput,
  ManualCommissionInput,
  MarkPaidInput,
  MyCommissionsQuery,
} from "@/validations/affiliates.validation";
import { buildPaginatedResult, type PaginationQuery } from "@/validations/pagination";

// Fase 21 (Docs/plan/19-afiliados.md). Afiliado no es un rol: cualquier User
// puede tener un AffiliateProfile; `isAffiliate` es status === APPROVED.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin I, O, 0, 1
const CODE_LENGTH = 8;

function generateCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export interface ResolvedTerms {
  commissionType: AffiliateCommissionType;
  commissionValue: number;
  payoutDelayDays: number | null;
}

// Tarifa propia o, si no tiene, los defaults de env (regla 9).
export function resolveTerms(profile: Pick<AffiliateProfile, "commissionType" | "commissionValue" | "payoutDelayDays">): ResolvedTerms {
  const hasOwn = profile.commissionType !== null && profile.commissionValue !== null;
  return {
    commissionType: hasOwn ? profile.commissionType! : env.affiliateDefaultCommissionType,
    commissionValue: hasOwn ? Number(profile.commissionValue) : env.affiliateDefaultCommissionValue,
    payoutDelayDays: profile.payoutDelayDays ?? env.affiliateDefaultPayoutDelayDays,
  };
}

// Regla 8: PERCENT sobre el pago, FIXED en dólares → centavos.
export function computeCommissionCents(type: AffiliateCommissionType, value: number, baseAmountCents: number): number {
  return type === "PERCENT" ? Math.round((baseAmountCents * value) / 100) : Math.round(value * 100);
}

export function computePayableAt(payoutDelayDays: number | null, now = new Date()): Date {
  return payoutDelayDays ? new Date(now.getTime() + payoutDelayDays * 86_400_000) : now;
}

function termsData(terms: { commissionType?: AffiliateCommissionType; commissionValue?: number; payoutDelayDays?: number | null }) {
  return {
    ...(terms.commissionType !== undefined ? { commissionType: terms.commissionType, commissionValue: terms.commissionValue } : {}),
    ...(terms.payoutDelayDays !== undefined ? { payoutDelayDays: terms.payoutDelayDays } : {}),
  };
}

function buildLink(code: string | null): string | null {
  return code ? `${env.corsOrigin}/register?ref=${code}` : null;
}

async function requireProfileById(id: string): Promise<AffiliateProfile> {
  const profile = await prisma.affiliateProfile.findUnique({ where: { id } });
  if (!profile) throw new AppError("Affiliate not found", 404, "AFFILIATE_NOT_FOUND");
  return profile;
}

// Pone APPROVED; genera el código la primera vez (reintenta si choca) y lo conserva siempre.
async function approveProfile(profile: AffiliateProfile, approverId: string, terms: ApproveAffiliateInput = {}): Promise<AffiliateProfile> {
  const data: Prisma.AffiliateProfileUpdateInput = {
    status: "APPROVED",
    statusReason: null,
    approvedBy: { connect: { id: approverId } },
    approvedAt: profile.approvedAt ?? new Date(),
    ...termsData(terms),
  };
  if (profile.code) return prisma.affiliateProfile.update({ where: { id: profile.id }, data });

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.affiliateProfile.update({ where: { id: profile.id }, data: { ...data, code: generateCode() } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
  }
  throw new AppError("Could not generate an affiliate code", 500, "INTERNAL_ERROR");
}

// ------------------------------------------------------------- usuario ---

export async function applyAffiliate(userId: string) {
  const existing = await prisma.affiliateProfile.findUnique({ where: { userId } });
  const selfApproval = env.affiliateApprovalMode === "self";

  if (existing?.status === "APPROVED" || existing?.status === "PENDING") {
    throw new AppError("You already are, or have requested to be, an affiliate", 409, "AFFILIATE_ALREADY_ACTIVE");
  }
  if (existing?.status === "SUSPENDED") {
    throw new AppError("Your affiliate account is suspended", 409, "AFFILIATE_SUSPENDED");
  }

  let profile = existing ?? (await prisma.affiliateProfile.create({ data: { userId } }));
  // INACTIVE ya fue aprobado antes: vuelve sin pedir permiso (regla 5).
  if (selfApproval || existing?.status === "INACTIVE") {
    profile = await approveProfile(profile, existing?.approvedById ?? userId);
    await logAuditEvent({ action: "AFFILIATE_APPROVED", entityType: "AffiliateProfile", entityId: profile.id, actorUserId: userId, metadata: { self: true } });
  } else {
    profile = await prisma.affiliateProfile.update({ where: { id: profile.id }, data: { status: "PENDING", statusReason: null } });
    await logAuditEvent({ action: "AFFILIATE_REQUESTED", entityType: "AffiliateProfile", entityId: profile.id, actorUserId: userId });
  }
  return toProfileView(profile);
}

export async function deactivateAffiliate(userId: string) {
  const profile = await prisma.affiliateProfile.findUnique({ where: { userId } });
  if (!profile || profile.status !== "APPROVED") {
    throw new AppError("You are not an active affiliate", 409, "AFFILIATE_NOT_ACTIVE");
  }
  const updated = await prisma.affiliateProfile.update({ where: { id: profile.id }, data: { status: "INACTIVE" } });
  await logAuditEvent({ action: "AFFILIATE_DEACTIVATED", entityType: "AffiliateProfile", entityId: profile.id, actorUserId: userId });
  return toProfileView(updated);
}

function toProfileView(profile: AffiliateProfile) {
  const terms = resolveTerms(profile);
  return {
    id: profile.id,
    isAffiliate: profile.status === "APPROVED",
    status: profile.status,
    code: profile.code,
    link: buildLink(profile.code),
    ...terms,
    statusReason: profile.statusReason,
  };
}

async function commissionTotals(affiliateId: string) {
  const grouped = await prisma.affiliateCommission.groupBy({ by: ["status"], where: { affiliateId }, _sum: { amountCents: true } });
  const sum = (status: string) => grouped.find((g) => g.status === status)?._sum.amountCents ?? 0;
  return { pendingCents: sum("PENDING"), paidCents: sum("PAID") };
}

export async function getMyAffiliate(userId: string) {
  const profile = await prisma.affiliateProfile.findUnique({ where: { userId } });
  if (!profile) return { isAffiliate: false, status: null };

  const [referralsCount, subscribedCount, totals] = await Promise.all([
    prisma.user.count({ where: { referredByAffiliateId: profile.id } }),
    prisma.subscriptionPayment.count({ where: { isFirstPayment: true, subscription: { user: { referredByAffiliateId: profile.id } } } }),
    commissionTotals(profile.id),
  ]);
  return { ...toProfileView(profile), referralsCount, subscribedCount, ...totals };
}

export async function listMyReferrals(userId: string, query: Pick<PaginationQuery, "page" | "pageSize">) {
  const profile = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return buildPaginatedResult([], 0, query);
  return listReferralsOf(profile.id, query);
}

async function listReferralsOf(affiliateId: string, query: Pick<PaginationQuery, "page" | "pageSize">) {
  const where = { referredByAffiliateId: affiliateId };
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { name: true, createdAt: true, subscription: { select: { payments: { where: { isFirstPayment: true }, select: { id: true }, take: 1 } } } },
    }),
    prisma.user.count({ where }),
  ]);
  // Sin correo ni teléfono del referido (§19.5).
  return buildPaginatedResult(
    users.map((u) => ({ name: u.name, joinedAt: u.createdAt, subscribed: (u.subscription?.payments.length ?? 0) > 0 })),
    total,
    query,
  );
}

export async function listMyCommissions(userId: string, query: MyCommissionsQuery) {
  const profile = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return buildPaginatedResult([], 0, query);
  return pageCommissions({ affiliateId: profile.id, ...(query.status ? { status: query.status } : {}) }, query);
}

async function pageCommissions(where: Prisma.AffiliateCommissionWhereInput, query: Pick<PaginationQuery, "page" | "pageSize">) {
  const [items, total] = await Promise.all([
    prisma.affiliateCommission.findMany({ where, orderBy: { createdAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.affiliateCommission.count({ where }),
  ]);
  return buildPaginatedResult(items.map(toCommissionView), total, query);
}

function toCommissionView(c: AffiliateCommission) {
  return { ...c, commissionValue: c.commissionValue === null ? null : Number(c.commissionValue) };
}

// -------------------------------------------------------------- referido ---

// Regla 7: un código inexistente o de un afiliado no aprobado se ignora.
export async function resolveReferralCode(code: string | undefined): Promise<string | null> {
  if (!code) return null;
  const profile = await prisma.affiliateProfile.findUnique({ where: { code: code.trim().toUpperCase() }, select: { id: true, status: true } });
  return profile?.status === "APPROVED" ? profile.id : null;
}

// Público (§19.5): solo dice si un código se puede usar; no devuelve datos del afiliado.
export async function isReferralCodeValid(code: string): Promise<boolean> {
  return (await resolveReferralCode(code)) !== null;
}

export async function getAffiliateStatusForUser(userId: string) {
  const profile = await prisma.affiliateProfile.findUnique({ where: { userId }, select: { status: true } });
  return { isAffiliate: profile?.status === "APPROVED", affiliateStatus: profile?.status ?? null };
}

// --------------------------------------------------------------- comisión ---

// §19.4. Nunca lanza: un fallo se registra y no revierte el pago.
export async function accrueCommissionForSubscription(event: FirstSubscriptionPaymentEvent): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: event.userId }, select: { referredByAffiliateId: true } });
    if (!user?.referredByAffiliateId) return;
    const profile = await prisma.affiliateProfile.findUnique({ where: { id: user.referredByAffiliateId } });
    if (!profile || profile.status !== "APPROVED") return;

    const terms = resolveTerms(profile);
    const amountCents = computeCommissionCents(terms.commissionType, terms.commissionValue, event.amountCents);
    if (amountCents <= 0) return;

    let commission: AffiliateCommission;
    try {
      commission = await prisma.affiliateCommission.create({
        data: {
          affiliateId: profile.id,
          referredUserId: event.userId,
          subscriptionPaymentId: event.subscriptionPaymentId,
          source: "SUBSCRIPTION",
          baseAmountCents: event.amountCents,
          commissionType: terms.commissionType,
          commissionValue: terms.commissionValue,
          amountCents,
          currency: env.subscriptionCurrency,
          payableAt: computePayableAt(terms.payoutDelayDays),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return; // ya generada
      throw error;
    }

    await logAuditEvent({
      action: "AFFILIATE_COMMISSION_EARNED",
      entityType: "AffiliateCommission",
      entityId: commission.id,
      systemActorLabel: "subscription-payment",
      metadata: { affiliateId: profile.id, referredUserId: event.userId, amountCents },
    });
    await notify({
      userId: profile.userId,
      type: "AFFILIATE_COMMISSION_EARNED",
      title: "You earned a commission",
      body: `A user you referred subscribed. Commission: ${(amountCents / 100).toFixed(2)} ${env.subscriptionCurrency.toUpperCase()}.`,
    });
  } catch (error) {
    logger.error("accrueCommissionForSubscription failed", { userId: event.userId, error: error instanceof Error ? error.message : String(error) });
  }
}

// ------------------------------------------------------------------ Admin ---

export async function adminListAffiliates(query: AdminListAffiliatesQuery) {
  const and: Prisma.AffiliateProfileWhereInput[] = [];
  if (query.status) and.push({ status: query.status });
  if (query.search) {
    and.push({
      OR: [
        { code: { contains: query.search.toUpperCase() } },
        { user: { name: { contains: query.search, mode: "insensitive" } } },
        { user: { email: { contains: query.search, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.AffiliateProfileWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.affiliateProfile.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { user: { select: { id: true, name: true, email: true } }, _count: { select: { referrals: true } } },
    }),
    prisma.affiliateProfile.count({ where }),
  ]);

  const items = await Promise.all(
    rows.map(async ({ user, _count, ...profile }) => ({
      ...toProfileView(profile),
      user,
      referralsCount: _count.referrals,
      ...(await commissionTotals(profile.id)),
      createdAt: profile.createdAt,
    })),
  );
  return buildPaginatedResult(items, total, query);
}

export async function adminGetAffiliate(id: string) {
  const profile = await prisma.affiliateProfile.findUnique({ where: { id }, include: { user: { select: { id: true, name: true, email: true } } } });
  if (!profile) throw new AppError("Affiliate not found", 404, "AFFILIATE_NOT_FOUND");
  const { user, ...rest } = profile;
  const [referrals, commissions, totals] = await Promise.all([
    prisma.user.findMany({ where: { referredByAffiliateId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, name: true, email: true, createdAt: true } }),
    prisma.affiliateCommission.findMany({ where: { affiliateId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    commissionTotals(id),
  ]);
  return { ...toProfileView(rest), user, ...totals, referrals, commissions: commissions.map(toCommissionView) };
}

function assertTransition(profile: AffiliateProfile, allowed: AffiliateProfile["status"][], action: string) {
  if (!allowed.includes(profile.status)) {
    throw new AppError(`Cannot ${action} an affiliate in status ${profile.status}`, 409, "AFFILIATE_INVALID_STATE");
  }
}

export async function adminApproveAffiliate(id: string, adminId: string, input: ApproveAffiliateInput) {
  const profile = await requireProfileById(id);
  assertTransition(profile, ["PENDING", "REJECTED", "SUSPENDED"], "approve");
  const updated = await approveProfile(profile, adminId, input);
  await logAuditEvent({ action: "AFFILIATE_APPROVED", entityType: "AffiliateProfile", entityId: id, actorUserId: adminId });
  await notify({ userId: profile.userId, type: "AFFILIATE_APPROVED", title: "You are now an affiliate", body: `Share your link to earn commissions: ${buildLink(updated.code)}` });
  return toProfileView(updated);
}

export async function adminRejectAffiliate(id: string, adminId: string, reason: string) {
  const profile = await requireProfileById(id);
  assertTransition(profile, ["PENDING"], "reject");
  const updated = await prisma.affiliateProfile.update({ where: { id }, data: { status: "REJECTED", statusReason: reason } });
  await logAuditEvent({ action: "AFFILIATE_REJECTED", entityType: "AffiliateProfile", entityId: id, actorUserId: adminId, metadata: { reason } });
  await notify({ userId: profile.userId, type: "AFFILIATE_REJECTED", title: "Affiliate request rejected", body: reason });
  return toProfileView(updated);
}

export async function adminSuspendAffiliate(id: string, adminId: string, reason: string) {
  const profile = await requireProfileById(id);
  assertTransition(profile, ["APPROVED"], "suspend");
  const updated = await prisma.affiliateProfile.update({ where: { id }, data: { status: "SUSPENDED", statusReason: reason } });
  await logAuditEvent({ action: "AFFILIATE_SUSPENDED", entityType: "AffiliateProfile", entityId: id, actorUserId: adminId, metadata: { reason } });
  await notify({ userId: profile.userId, type: "AFFILIATE_SUSPENDED", title: "Affiliate account suspended", body: reason });
  return toProfileView(updated);
}

// Solo afecta comisiones futuras: las existentes guardan su monto ya calculado.
export async function adminSetAffiliateTerms(id: string, adminId: string, input: AffiliateTermsInput) {
  await requireProfileById(id);
  const updated = await prisma.affiliateProfile.update({ where: { id }, data: termsData(input) });
  await logAuditEvent({ action: "AFFILIATE_TERMS_UPDATED", entityType: "AffiliateProfile", entityId: id, actorUserId: adminId, metadata: { ...input } });
  return toProfileView(updated);
}

export async function adminCreateManualCommission(id: string, adminId: string, input: ManualCommissionInput) {
  const profile = await requireProfileById(id);
  if (!profile.code) {
    throw new AppError("This affiliate was never approved", 409, "AFFILIATE_INVALID_STATE");
  }
  const commission = await prisma.affiliateCommission.create({
    data: {
      affiliateId: id,
      referredUserId: input.referredUserId,
      source: "MANUAL",
      amountCents: input.amountCents,
      currency: env.subscriptionCurrency,
      payableAt: input.payableAt ?? computePayableAt(resolveTerms(profile).payoutDelayDays),
      note: input.note,
    },
  });
  await logAuditEvent({ action: "AFFILIATE_COMMISSION_EARNED", entityType: "AffiliateCommission", entityId: commission.id, actorUserId: adminId, metadata: { manual: true, amountCents: input.amountCents } });
  return toCommissionView(commission);
}

export async function adminListCommissions(query: AdminListCommissionsQuery) {
  const where: Prisma.AffiliateCommissionWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.affiliateId ? { affiliateId: query.affiliateId } : {}),
    ...(query.payable ? { status: "PENDING", payableAt: { lte: new Date() } } : {}),
  };
  return pageCommissions(where, query);
}

async function requirePendingCommission(id: string): Promise<AffiliateCommission> {
  const commission = await prisma.affiliateCommission.findUnique({ where: { id } });
  if (!commission) throw new AppError("Commission not found", 404, "AFFILIATE_NOT_FOUND");
  if (commission.status !== "PENDING") {
    throw new AppError("Commission is not pending", 409, "AFFILIATE_COMMISSION_NOT_PENDING");
  }
  return commission;
}

export async function adminSetCommissionPayableAt(id: string, payableAt: Date) {
  await requirePendingCommission(id);
  return toCommissionView(await prisma.affiliateCommission.update({ where: { id }, data: { payableAt } }));
}

export async function adminMarkCommissionPaid(id: string, adminId: string, input: MarkPaidInput) {
  const commission = await requirePendingCommission(id);
  const now = new Date();
  if (commission.payableAt > now && !input.force) {
    throw new AppError("Commission is not payable yet", 409, "AFFILIATE_COMMISSION_NOT_PAYABLE_YET");
  }
  // updateMany con status PENDING: dos pagos simultáneos no pagan dos veces.
  const result = await prisma.affiliateCommission.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "PAID", paidAt: now, paidById: adminId, paymentReference: input.paymentReference },
  });
  if (result.count === 0) throw new AppError("Commission is not pending", 409, "AFFILIATE_COMMISSION_NOT_PENDING");

  const paid = await prisma.affiliateCommission.findUniqueOrThrow({ where: { id }, include: { affiliate: { select: { userId: true } } } });
  await logAuditEvent({ action: "AFFILIATE_COMMISSION_PAID", entityType: "AffiliateCommission", entityId: id, actorUserId: adminId, metadata: { amountCents: paid.amountCents, forced: input.force, paymentReference: input.paymentReference ?? null } });
  await notify({
    userId: paid.affiliate.userId,
    type: "AFFILIATE_COMMISSION_PAID",
    title: "Commission paid",
    body: `Your commission of ${(paid.amountCents / 100).toFixed(2)} ${paid.currency.toUpperCase()} was paid.`,
  });
  const { affiliate, ...rest } = paid;
  void affiliate;
  return toCommissionView(rest);
}

export async function adminVoidCommission(id: string, adminId: string, note: string) {
  await requirePendingCommission(id);
  const result = await prisma.affiliateCommission.updateMany({ where: { id, status: "PENDING" }, data: { status: "VOID", voidedAt: new Date(), voidedById: adminId, note } });
  if (result.count === 0) throw new AppError("Commission is not pending", 409, "AFFILIATE_COMMISSION_NOT_PENDING");
  await logAuditEvent({ action: "AFFILIATE_COMMISSION_VOIDED", entityType: "AffiliateCommission", entityId: id, actorUserId: adminId, metadata: { note } });
  return toCommissionView(await prisma.affiliateCommission.findUniqueOrThrow({ where: { id } }));
}
