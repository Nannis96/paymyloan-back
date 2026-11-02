import { afterAll, afterEach, describe, expect, it } from "vitest";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { createTestAdmin, createTestBorrower, createTestUser, resetPhase1Tables } from "@/db/testFixtures";
import { validateCode } from "@/controllers/affiliates.controller";
import * as affiliates from "@/services/affiliates.service";
import * as authService from "@/services/auth.service";
import * as subscriptionService from "@/services/subscription.service";

const mutableEnv = env as unknown as { affiliateApprovalMode: string };
let seq = 0;

async function registerBorrower(referralCode?: string) {
  seq += 1;
  const email = `ref-${Date.now()}-${seq}@test.local`;
  await authService.register({ name: "Referido", email, phone: `55512${String(Date.now() + seq).slice(-5)}`, password: "Passw0rd!x", role: "BORROWER", referralCode });
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

async function approvedAffiliate(admin: { id: string }, terms: { commissionType: "PERCENT" | "FIXED"; commissionValue: number; payoutDelayDays?: number }) {
  const user = await createTestUser("LENDER");
  const profile = await affiliates.applyAffiliate(user.id);
  const approved = await affiliates.adminApproveAffiliate(profile.id, admin.id, terms);
  return { user, id: approved.id, code: approved.code! };
}

describe("affiliates.service (Fase 21, Docs/plan/19)", () => {
  afterEach(() => {
    mutableEnv.affiliateApprovalMode = "admin";
  });
  afterAll(resetPhase1Tables);

  it("modo admin: apply → PENDING; aprobar da código y link; estados inválidos → 409", async () => {
    const admin = await createTestAdmin();
    const user = await createTestUser("BORROWER");

    const pending = await affiliates.applyAffiliate(user.id);
    expect(pending).toMatchObject({ status: "PENDING", isAffiliate: false, code: null });
    await expect(affiliates.applyAffiliate(user.id)).rejects.toMatchObject({ code: "AFFILIATE_ALREADY_ACTIVE" });

    const approved = await affiliates.adminApproveAffiliate(pending.id, admin.id, { commissionType: "PERCENT", commissionValue: 10 });
    expect(approved).toMatchObject({ status: "APPROVED", isAffiliate: true, commissionType: "PERCENT", commissionValue: 10 });
    expect(approved.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(approved.link).toBe(`${env.corsOrigin}/register?ref=${approved.code}`);

    await expect(affiliates.adminRejectAffiliate(pending.id, admin.id, "x")).rejects.toMatchObject({ code: "AFFILIATE_INVALID_STATE" });
    await expect(affiliates.adminApproveAffiliate(pending.id, admin.id, {})).rejects.toMatchObject({ code: "AFFILIATE_INVALID_STATE" });
    expect((await authService.getMe(user.id))).toMatchObject({ isAffiliate: true, affiliateStatus: "APPROVED" });
  });

  it("rechazo permite volver a pedir; suspendido no puede pedir y reaprobar conserva el código", async () => {
    const admin = await createTestAdmin();
    const user = await createTestUser("LENDER");
    const first = await affiliates.applyAffiliate(user.id);
    await affiliates.adminRejectAffiliate(first.id, admin.id, "Incompleto");
    expect((await affiliates.applyAffiliate(user.id)).status).toBe("PENDING");

    const approved = await affiliates.adminApproveAffiliate(first.id, admin.id, {});
    await affiliates.adminSuspendAffiliate(first.id, admin.id, "Abuso");
    await expect(affiliates.applyAffiliate(user.id)).rejects.toMatchObject({ code: "AFFILIATE_SUSPENDED" });
    const again = await affiliates.adminApproveAffiliate(first.id, admin.id, {});
    expect(again.code).toBe(approved.code);
  });

  it("modo self: apply aprueba al instante; DELETE apaga; volver a pedir reactiva con el mismo código", async () => {
    mutableEnv.affiliateApprovalMode = "self";
    const user = await createTestUser("BORROWER");
    const on = await affiliates.applyAffiliate(user.id);
    expect(on).toMatchObject({ status: "APPROVED", isAffiliate: true });

    expect((await affiliates.deactivateAffiliate(user.id)).status).toBe("INACTIVE");
    await expect(affiliates.deactivateAffiliate(user.id)).rejects.toMatchObject({ code: "AFFILIATE_NOT_ACTIVE" });

    mutableEnv.affiliateApprovalMode = "admin"; // INACTIVE ya fue aprobado: no pide permiso de nuevo
    const back = await affiliates.applyAffiliate(user.id);
    expect(back).toMatchObject({ status: "APPROVED", code: on.code });
  });

  it("register guarda el referido con un código aprobado e ignora uno inválido o no aprobado", async () => {
    const admin = await createTestAdmin();
    const aff = await approvedAffiliate(admin, { commissionType: "PERCENT", commissionValue: 10 });
    const pendingUser = await createTestUser("BORROWER");
    await affiliates.applyAffiliate(pendingUser.id);

    expect((await registerBorrower(aff.code)).referredByAffiliateId).toBe(aff.id);
    expect((await registerBorrower("ZZZZZZZZ")).referredByAffiliateId).toBeNull();
    expect((await registerBorrower()).referredByAffiliateId).toBeNull();
  });

  it("isReferralCodeValid: solo true para un código de afiliado aprobado", async () => {
    const admin = await createTestAdmin();
    const aff = await approvedAffiliate(admin, { commissionType: "PERCENT", commissionValue: 10 });
    expect(await affiliates.isReferralCodeValid(aff.code)).toBe(true);
    expect(await affiliates.isReferralCodeValid(aff.code.toLowerCase())).toBe(true);
    expect(await affiliates.isReferralCodeValid("ZZZZZZZZ")).toBe(false);

    await affiliates.adminSuspendAffiliate(aff.id, admin.id, "Abuso");
    expect(await affiliates.isReferralCodeValid(aff.code)).toBe(false);
  });

  it("GET /validate: { valid } sin sesión; un código mal formado da valid:false y no 400", async () => {
    const admin = await createTestAdmin();
    const aff = await approvedAffiliate(admin, { commissionType: "PERCENT", commissionValue: 10 });
    const req = new Request("http://localhost/api/affiliates/validate", { headers: { "x-forwarded-for": `10.9.${seq}.1` } });
    expect(await validateCode(req, { code: aff.code })).toEqual({ valid: true });
    expect(await validateCode(req, { code: "no" })).toEqual({ valid: false });
    expect(await validateCode(req, {})).toEqual({ valid: false });
  });

  it("primer pago → una comisión; pagos y grants posteriores no generan otra; la tarifa nueva no toca las viejas", async () => {
    const admin = await createTestAdmin();
    const aff = await approvedAffiliate(admin, { commissionType: "PERCENT", commissionValue: 10 });
    const referred = await registerBorrower(aff.code);

    const sub = await subscriptionService.ensureSubscription(referred.id);
    await subscriptionService.adminGrantSubscription(sub.id, admin.id, { days: 10, reason: "x" });
    expect(await prisma.affiliateCommission.count({ where: { affiliateId: aff.id } })).toBe(0);

    await subscriptionService.payMySubscription(referred.id);
    await subscriptionService.payMySubscription(referred.id);
    const commissions = await prisma.affiliateCommission.findMany({ where: { affiliateId: aff.id } });
    expect(commissions).toHaveLength(1);
    expect(commissions[0]).toMatchObject({ amountCents: 90, baseAmountCents: 900, status: "PENDING", source: "SUBSCRIPTION", referredUserId: referred.id });

    await affiliates.adminSetAffiliateTerms(aff.id, admin.id, { commissionType: "FIXED", commissionValue: 50 });
    expect((await prisma.affiliateCommission.findUniqueOrThrow({ where: { id: commissions[0].id } })).amountCents).toBe(90);

    const mine = await affiliates.getMyAffiliate(aff.user.id);
    expect(mine).toMatchObject({ referralsCount: 1, subscribedCount: 1, pendingCents: 90, paidCents: 0 });
    expect((await affiliates.listMyReferrals(aff.user.id, { page: 1, pageSize: 20 })).items[0]).toMatchObject({ subscribed: true });
  });

  it("sin tarifa (default 0) o con el afiliado suspendido no se genera comisión", async () => {
    const admin = await createTestAdmin();
    const noTerms = await approvedAffiliate(admin, { commissionType: "PERCENT", commissionValue: 0 });
    await subscriptionService.payMySubscription((await registerBorrower(noTerms.code)).id);
    expect(await prisma.affiliateCommission.count({ where: { affiliateId: noTerms.id } })).toBe(0);

    const suspended = await approvedAffiliate(admin, { commissionType: "PERCENT", commissionValue: 10 });
    const referred = await registerBorrower(suspended.code);
    await affiliates.adminSuspendAffiliate(suspended.id, admin.id, "Abuso");
    await subscriptionService.payMySubscription(referred.id);
    expect(await prisma.affiliateCommission.count({ where: { affiliateId: suspended.id } })).toBe(0);
  });

  it("pago con retraso: antes de la fecha → 409 salvo force; luego PAID; ya no se puede pagar ni anular", async () => {
    const admin = await createTestAdmin();
    const aff = await approvedAffiliate(admin, { commissionType: "FIXED", commissionValue: 5, payoutDelayDays: 5 });
    await subscriptionService.payMySubscription((await registerBorrower(aff.code)).id);
    const commission = await prisma.affiliateCommission.findFirstOrThrow({ where: { affiliateId: aff.id } });
    expect(commission.amountCents).toBe(500);
    expect(commission.payableAt.getTime()).toBeGreaterThan(Date.now() + 4 * 86_400_000);

    expect((await affiliates.adminListCommissions({ page: 1, pageSize: 50, affiliateId: aff.id, payable: true })).items).toHaveLength(0);
    await expect(affiliates.adminMarkCommissionPaid(commission.id, admin.id, { force: false })).rejects.toMatchObject({ code: "AFFILIATE_COMMISSION_NOT_PAYABLE_YET" });

    const paid = await affiliates.adminMarkCommissionPaid(commission.id, admin.id, { force: true, paymentReference: "wire-1" });
    expect(paid).toMatchObject({ status: "PAID", paidById: admin.id, paymentReference: "wire-1" });
    await expect(affiliates.adminMarkCommissionPaid(commission.id, admin.id, { force: true })).rejects.toMatchObject({ code: "AFFILIATE_COMMISSION_NOT_PENDING" });
    await expect(affiliates.adminVoidCommission(commission.id, admin.id, "x")).rejects.toMatchObject({ code: "AFFILIATE_COMMISSION_NOT_PENDING" });
    expect((await affiliates.getMyAffiliate(aff.user.id))).toMatchObject({ pendingCents: 0, paidCents: 500 });
  });

  it("comisión manual pagable de inmediato; payableAt editable; void", async () => {
    const admin = await createTestAdmin();
    const aff = await approvedAffiliate(admin, { commissionType: "PERCENT", commissionValue: 10 });
    const manual = await affiliates.adminCreateManualCommission(aff.id, admin.id, { amountCents: 1000, note: "Bono" });
    expect((await affiliates.adminListCommissions({ page: 1, pageSize: 50, affiliateId: aff.id, payable: true })).items.map((c) => c.id)).toEqual([manual.id]);

    const later = new Date(Date.now() + 3 * 86_400_000);
    expect((await affiliates.adminSetCommissionPayableAt(manual.id, later)).payableAt).toEqual(later);
    expect((await affiliates.adminVoidCommission(manual.id, admin.id, "Error")).status).toBe("VOID");

    const neverApproved = await createTestUser("LENDER");
    const pending = await affiliates.applyAffiliate(neverApproved.id);
    await expect(affiliates.adminCreateManualCommission(pending.id, admin.id, { amountCents: 100, note: "x" })).rejects.toMatchObject({ code: "AFFILIATE_INVALID_STATE" });
  });

  it("listado admin filtra por estado y busca por código", async () => {
    const admin = await createTestAdmin();
    const aff = await approvedAffiliate(admin, { commissionType: "PERCENT", commissionValue: 10 });
    await createTestBorrower();
    const byCode = await affiliates.adminListAffiliates({ page: 1, pageSize: 20, status: "APPROVED", search: aff.code.toLowerCase() });
    expect(byCode.items.map((i) => i.id)).toEqual([aff.id]);
  });
});
