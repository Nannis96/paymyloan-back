import { Prisma, type Subscription, type SubscriptionPayment } from "@prisma/client";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { accrueCommissionForSubscription } from "@/services/affiliates.service";
import type {
  AdminCancelSubscriptionInput,
  AdminListSubscriptionsQuery,
  GrantSubscriptionInput,
} from "@/validations/subscription.validation";
import { buildPaginatedResult, type PaginatedResult, type PaginationQuery } from "@/validations/pagination";

// Fase 20 (Docs/plan/18-suscripciones.md). Solo los usuarios con
// BorrowerProfile tienen suscripción; `EXPIRED` no se persiste, se deriva de
// las fechas (D-SU-2). Toda la aritmética de periodos vive acá (§18.1).

export type EffectiveSubscriptionStatus = "TRIALING" | "ACTIVE" | "CANCELLED" | "EXPIRED";

const DAY_MS = 86_400_000;

type DateFields = Pick<Subscription, "trialEndsAt" | "currentPeriodEnd">;

export function hasAccess(sub: DateFields, now = new Date()): boolean {
  return sub.trialEndsAt > now || (sub.currentPeriodEnd !== null && sub.currentPeriodEnd > now);
}

export function effectiveStatus(sub: DateFields & Pick<Subscription, "status">, now = new Date()): EffectiveSubscriptionStatus {
  return hasAccess(sub, now) ? sub.status : "EXPIRED";
}

// Pagar o regalar no pierde días: el periodo nuevo arranca donde termina el
// vigente (o el trial), nunca antes de `now`.
export function periodBase(sub: DateFields, now = new Date()): Date {
  const end = sub.currentPeriodEnd ?? sub.trialEndsAt;
  return end > now ? end : now;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export interface SubscriptionView {
  id: string;
  status: EffectiveSubscriptionStatus;
  hasAccess: boolean;
  daysLeftInTrial: number;
  trialEndsAt: Date;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  priceCents: number;
  currency: string;
  billingMode: "simulated" | "stripe";
}

function toView(sub: Subscription, now = new Date()): SubscriptionView {
  return {
    id: sub.id,
    status: effectiveStatus(sub, now),
    hasAccess: hasAccess(sub, now),
    daysLeftInTrial: Math.max(0, Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY_MS)),
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelledAt: sub.cancelledAt,
    priceCents: sub.priceCents,
    currency: env.subscriptionCurrency,
    billingMode: env.billingMode,
  };
}

// §18.4. Idempotente: el `upsert` por `userId` nunca crea una segunda. Un
// usuario sin BorrowerProfile (p. ej. un Lender puro) no tiene suscripción.
export async function ensureSubscription(userId: string): Promise<Subscription> {
  const existing = await prisma.subscription.findUnique({ where: { userId } });
  if (existing) return existing;

  const profile = await prisma.borrowerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) {
    throw new AppError("Subscription not found", 404, "SUBSCRIPTION_NOT_FOUND");
  }

  const created = await prisma.subscription.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      priceCents: env.subscriptionPriceCents,
      trialEndsAt: addDays(new Date(), env.subscriptionTrialDays),
    },
  });
  await logAuditEvent({ action: "SUBSCRIPTION_STARTED", entityType: "Subscription", entityId: created.id, actorUserId: userId });
  return created;
}

// Lo llaman los puntos donde nace un BorrowerProfile/se activa la cuenta:
// no debe romper el flujo si el usuario no es Borrower.
export async function ensureSubscriptionIfBorrower(userId: string): Promise<void> {
  const profile = await prisma.borrowerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (profile) await ensureSubscription(userId);
}

// Gate §18.5: solo para acciones que inician un préstamo nuevo del Borrower.
export async function assertSubscriptionAccess(userId: string): Promise<void> {
  const sub = await ensureSubscription(userId);
  if (!hasAccess(sub)) {
    throw new AppError("An active subscription is required to start a new loan", 403, "SUBSCRIPTION_REQUIRED");
  }
}

export async function getMySubscription(userId: string): Promise<SubscriptionView> {
  return toView(await ensureSubscription(userId));
}

export async function payMySubscription(userId: string): Promise<{ subscription: SubscriptionView; payment: SubscriptionPayment }> {
  if (env.billingMode !== "simulated") {
    throw new AppError("Billing is not in simulated mode", 409, "BILLING_NOT_SIMULATED");
  }
  if (env.isProduction && !env.allowSimulatedBilling) {
    throw new AppError("Simulated billing is disabled in production", 403, "SIMULATED_BILLING_DISABLED");
  }
  const sub = await ensureSubscription(userId);
  const now = new Date();
  const periodStart = periodBase(sub, now);

  const { payment, updated, isFirstPayment } = await prisma.$transaction(async (tx) => {
    const priorPaid = await tx.subscriptionPayment.count({
      where: { subscriptionId: sub.id, status: "SUCCEEDED", amountCents: { gt: 0 } },
    });
    const isFirst = priorPaid === 0;
    const payment = await tx.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        amountCents: env.subscriptionPriceCents,
        currency: env.subscriptionCurrency,
        status: "SUCCEEDED",
        source: "SIMULATED",
        isFirstPayment: isFirst,
        periodStart,
        periodEnd: addMonths(periodStart, 1),
        paidAt: now,
      },
    });
    const updated = await tx.subscription.update({
      where: { id: sub.id },
      data: { status: "ACTIVE", cancelledAt: null, currentPeriodStart: payment.periodStart, currentPeriodEnd: payment.periodEnd },
    });
    return { payment, updated, isFirstPayment: isFirst };
  });

  await logAuditEvent({
    action: "SUBSCRIPTION_PAID",
    entityType: "Subscription",
    entityId: sub.id,
    actorUserId: userId,
    metadata: { amountCents: payment.amountCents, source: payment.source, isFirstPayment },
  });
  if (isFirstPayment) await onFirstSubscriptionPayment({ userId, subscriptionId: sub.id, subscriptionPaymentId: payment.id, amountCents: payment.amountCents });

  return { subscription: toView(updated, now), payment };
}

export async function cancelMySubscription(userId: string): Promise<SubscriptionView> {
  const sub = await ensureSubscription(userId);
  if (sub.status === "CANCELLED") {
    throw new AppError("Subscription is already cancelled", 409, "SUBSCRIPTION_ALREADY_CANCELLED");
  }
  const updated = await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await logAuditEvent({ action: "SUBSCRIPTION_CANCELLED", entityType: "Subscription", entityId: sub.id, actorUserId: userId });
  return toView(updated);
}

export async function listMyPayments(userId: string, query: Pick<PaginationQuery, "page" | "pageSize">): Promise<PaginatedResult<SubscriptionPayment>> {
  const sub = await ensureSubscription(userId);
  const where = { subscriptionId: sub.id };
  const [items, total] = await Promise.all([
    prisma.subscriptionPayment.findMany({ where, orderBy: { paidAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.subscriptionPayment.count({ where }),
  ]);
  return buildPaginatedResult(items, total, query);
}

// §18.6 → Docs/plan/19 §19.4. Se llama después de confirmar el pago y
// accrueCommissionForSubscription nunca lanza, así que no puede revertirlo.
export interface FirstSubscriptionPaymentEvent {
  userId: string;
  subscriptionId: string;
  subscriptionPaymentId: string;
  amountCents: number;
}
export async function onFirstSubscriptionPayment(event: FirstSubscriptionPaymentEvent): Promise<void> {
  await accrueCommissionForSubscription(event);
}

// ---------------------------------------------------------------- Admin ---

async function requireSubscription(id: string): Promise<Subscription> {
  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) throw new AppError("Subscription not found", 404, "SUBSCRIPTION_NOT_FOUND");
  return sub;
}

function adminStatusWhere(status: NonNullable<AdminListSubscriptionsQuery["status"]>, now: Date): Prisma.SubscriptionWhereInput {
  const access: Prisma.SubscriptionWhereInput = { OR: [{ trialEndsAt: { gt: now } }, { currentPeriodEnd: { gt: now } }] };
  // EXPIRED sin `NOT (... OR ...)`: con currentPeriodEnd nulo el NOT daría NULL en SQL y excluiría la fila.
  return status === "EXPIRED" ? { trialEndsAt: { lte: now }, OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { lte: now } }] } : { status, ...access };
}

export async function adminListSubscriptions(query: AdminListSubscriptionsQuery) {
  const now = new Date();
  const and: Prisma.SubscriptionWhereInput[] = [];
  if (query.status) and.push(adminStatusWhere(query.status, now));
  if (query.search) {
    and.push({ user: { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { email: { contains: query.search, mode: "insensitive" } }] } });
  }
  const where: Prisma.SubscriptionWhereInput = { AND: and };

  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { user: { select: { id: true, name: true, email: true } }, payments: { where: { status: "SUCCEEDED", amountCents: { gt: 0 } }, orderBy: { paidAt: "desc" }, take: 1, select: { paidAt: true } } },
    }),
    prisma.subscription.count({ where }),
  ]);

  const items = rows.map(({ user, payments, ...sub }) => ({
    id: sub.id,
    user,
    status: effectiveStatus(sub, now),
    hasAccess: hasAccess(sub, now),
    trialEndsAt: sub.trialEndsAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    lastPaymentAt: payments[0]?.paidAt ?? null,
    priceCents: sub.priceCents,
  }));
  return buildPaginatedResult(items, total, query);
}

export async function adminGetSubscription(id: string) {
  const sub = await prisma.subscription.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true } }, payments: { orderBy: { paidAt: "desc" } } },
  });
  if (!sub) throw new AppError("Subscription not found", 404, "SUBSCRIPTION_NOT_FOUND");
  const { user, payments, ...rest } = sub;
  return { ...toView(rest), user, payments };
}

export async function adminGrantSubscription(id: string, adminId: string, input: GrantSubscriptionInput) {
  const sub = await requireSubscription(id);
  const now = new Date();
  const periodStart = periodBase(sub, now);
  const periodEnd = addDays(periodStart, input.days);

  const [payment, updated] = await prisma.$transaction([
    prisma.subscriptionPayment.create({
      data: {
        subscriptionId: id,
        amountCents: 0,
        currency: env.subscriptionCurrency,
        status: "SUCCEEDED",
        source: "ADMIN_GRANT",
        isFirstPayment: false,
        periodStart,
        periodEnd,
        grantedById: adminId,
        reason: input.reason,
        paidAt: now,
      },
    }),
    prisma.subscription.update({ where: { id }, data: { status: "ACTIVE", cancelledAt: null, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd } }),
  ]);

  await logAuditEvent({
    action: "SUBSCRIPTION_GRANTED",
    entityType: "Subscription",
    entityId: id,
    actorUserId: adminId,
    metadata: { days: input.days, reason: input.reason },
  });
  return { subscription: toView(updated, now), payment };
}

export async function adminCancelSubscription(id: string, adminId: string, input: AdminCancelSubscriptionInput) {
  const sub = await requireSubscription(id);
  if (sub.status === "CANCELLED" && !input.immediate) {
    throw new AppError("Subscription is already cancelled", 409, "SUBSCRIPTION_ALREADY_CANCELLED");
  }
  const now = new Date();
  const updated = await prisma.subscription.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: sub.cancelledAt ?? now, ...(input.immediate ? { trialEndsAt: now, currentPeriodEnd: now } : {}) },
  });
  await logAuditEvent({
    action: "SUBSCRIPTION_CANCELLED",
    entityType: "Subscription",
    entityId: id,
    actorUserId: adminId,
    metadata: { immediate: input.immediate },
  });
  return toView(updated, now);
}
