import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestAdmin, createTestBorrower, createTestUser, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as subscriptionService from "@/services/subscription.service";

const DAY = 86_400_000;

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
  await expect(promise).rejects.toBeInstanceOf(AppError);
}

describe("subscription.service (Fase 20, Docs/plan/18)", () => {
  afterAll(resetPhase1Tables);

  it("ensureSubscription es idempotente y arranca en trial con acceso", async () => {
    const { user } = await createTestBorrower();
    const first = await subscriptionService.ensureSubscription(user.id);
    const second = await subscriptionService.ensureSubscription(user.id);
    expect(second.id).toBe(first.id);
    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(1);

    const view = await subscriptionService.getMySubscription(user.id);
    expect(view).toMatchObject({ status: "TRIALING", hasAccess: true, daysLeftInTrial: 7, priceCents: 900 });
  });

  it("un Lender puro no tiene suscripción (404) y el gate no aplica a sus rutas", async () => {
    const lender = await createTestUser("LENDER");
    await expectCode(subscriptionService.getMySubscription(lender.id), "SUBSCRIPTION_NOT_FOUND");
  });

  it("trial vencido y sin pagar → EXPIRED y el gate responde 403 SUBSCRIPTION_REQUIRED", async () => {
    const { user } = await createTestBorrower();
    const sub = await subscriptionService.ensureSubscription(user.id);
    await subscriptionService.assertSubscriptionAccess(user.id);

    await prisma.subscription.update({ where: { id: sub.id }, data: { trialEndsAt: new Date(Date.now() - DAY) } });
    expect((await subscriptionService.getMySubscription(user.id)).status).toBe("EXPIRED");
    await expectCode(subscriptionService.assertSubscriptionAccess(user.id), "SUBSCRIPTION_REQUIRED");
    // Pagar nunca está bloqueado por el gate: reabre el acceso.
    await subscriptionService.payMySubscription(user.id);
    await subscriptionService.assertSubscriptionAccess(user.id);
  });

  it("pagar durante el trial no pierde días, marca el primer pago y ACTIVE", async () => {
    const { user } = await createTestBorrower();
    const sub = await subscriptionService.ensureSubscription(user.id);

    const { subscription, payment } = await subscriptionService.payMySubscription(user.id);
    expect(subscription.status).toBe("ACTIVE");
    expect(payment).toMatchObject({ isFirstPayment: true, amountCents: 900, source: "SIMULATED", status: "SUCCEEDED" });
    // El periodo arranca cuando termina el trial (no antes) y dura un mes.
    expect(payment.periodStart.getTime()).toBe(sub.trialEndsAt.getTime());
    expect(subscription.currentPeriodEnd!.getTime()).toBeGreaterThan(sub.trialEndsAt.getTime() + 27 * DAY);

    const second = await subscriptionService.payMySubscription(user.id);
    expect(second.payment.isFirstPayment).toBe(false);
    expect(second.payment.periodStart.getTime()).toBe(payment.periodEnd.getTime());
  });

  it("cancelar conserva el acceso; cancelar dos veces → 409; pagar reactiva", async () => {
    const { user } = await createTestBorrower();
    await subscriptionService.payMySubscription(user.id);
    const cancelled = await subscriptionService.cancelMySubscription(user.id);
    expect(cancelled).toMatchObject({ status: "CANCELLED", hasAccess: true });
    await expectCode(subscriptionService.cancelMySubscription(user.id), "SUBSCRIPTION_ALREADY_CANCELLED");

    const paid = await subscriptionService.payMySubscription(user.id);
    expect(paid.subscription).toMatchObject({ status: "ACTIVE", cancelledAt: null });
  });

  it("admin: grant extiende el acceso sin generar primer pago; cancel inmediato lo corta", async () => {
    const admin = await createTestAdmin();
    const { user } = await createTestBorrower();
    const sub = await subscriptionService.ensureSubscription(user.id);

    const granted = await subscriptionService.adminGrantSubscription(sub.id, admin.id, { days: 30, reason: "Cortesía" });
    expect(granted.payment).toMatchObject({ amountCents: 0, source: "ADMIN_GRANT", isFirstPayment: false, grantedById: admin.id });
    expect(granted.subscription.hasAccess).toBe(true);
    // Un grant no cuenta como pago: el primer pago real sigue siendo "primero".
    expect((await subscriptionService.payMySubscription(user.id)).payment.isFirstPayment).toBe(true);

    const cut = await subscriptionService.adminCancelSubscription(sub.id, admin.id, { immediate: true });
    expect(cut).toMatchObject({ status: "EXPIRED", hasAccess: false });
  });

  it("admin list filtra por estado efectivo y busca por correo", async () => {
    const { user: expired } = await createTestBorrower();
    const expiredSub = await subscriptionService.ensureSubscription(expired.id);
    await prisma.subscription.update({ where: { id: expiredSub.id }, data: { trialEndsAt: new Date(Date.now() - DAY) } });

    const list = await subscriptionService.adminListSubscriptions({ page: 1, pageSize: 100, status: "EXPIRED", search: expired.email });
    expect(list.items.map((i) => i.id)).toEqual([expiredSub.id]);
    expect(list.items[0]).toMatchObject({ status: "EXPIRED", hasAccess: false, lastPaymentAt: null });

    const trialing = await subscriptionService.adminListSubscriptions({ page: 1, pageSize: 100, status: "TRIALING", search: expired.email });
    expect(trialing.items).toHaveLength(0);
  });
});
