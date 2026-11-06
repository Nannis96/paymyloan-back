import type { AffiliateStatus, Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { addDays, daysFromNow } from "./ctx";

// Afiliados de ejemplo (Docs/plan/19). Idempotente: si lender1 ya tiene perfil, no repite.
// Requiere los usuarios de seedIdentity (admin, lender1..3, borrower1..7).
const PRICE = 900;

export async function seedAffiliates() {
  const find = (e: string) => prisma.user.findUnique({ where: { email: `${e}@paymyloan.dev` } });
  const [admin, l1] = await Promise.all([find("admin"), find("lender1")]);
  if (!admin || !l1) return console.log("seedAffiliates: faltan usuarios base, se omite.");
  if (await prisma.affiliateProfile.findUnique({ where: { userId: l1.id } })) return console.log("seedAffiliates: ya aplicado.");

  const profile = async (email: string, status: AffiliateStatus, extra: Partial<Prisma.AffiliateProfileUncheckedCreateInput> = {}) => {
    const u = await find(email);
    if (!u) return null;
    return prisma.affiliateProfile.create({
      data: { userId: u.id, status, approvedById: status === "APPROVED" ? admin.id : null, approvedAt: status === "APPROVED" ? new Date() : null, ...extra },
    });
  };

  // Aprobados
  const a1 = await profile("lender1", "APPROVED", { code: "LENDER1X", commissionType: "PERCENT", commissionValue: 20, payoutDelayDays: 7 });
  const a2 = await profile("borrower4", "APPROVED", { code: "BORROW4X", commissionType: "FIXED", commissionValue: 5 });
  // Otros estados, para probar la UI
  await profile("lender2", "PENDING");
  await profile("lender3", "REJECTED", { statusReason: "Perfil incompleto (seed)" });
  await profile("borrower6", "SUSPENDED", { code: "BORROW6X", statusReason: "Actividad sospechosa (seed)" });
  await profile("borrower7", "INACTIVE", { code: "BORROW7X" });

  // Referidos: [afiliado, email, suscrito?]
  const referrals: [typeof a1, string, boolean][] = [
    [a1, "borrower1", true], [a1, "borrower2", true], [a1, "borrower3", true], [a1, "borrower5", false], [a2, "borrower8", true],
  ];
  const commissions: Record<string, string> = {};
  for (const [aff, email, subscribed] of referrals) {
    const u = await find(email);
    if (!aff || !u) continue;
    await prisma.user.update({ where: { id: u.id }, data: { referredByAffiliateId: aff.id } });
    const trial = daysFromNow(subscribed ? -30 : 5);
    const sub = await prisma.subscription.upsert({
      where: { userId: u.id },
      update: {},
      create: {
        userId: u.id, priceCents: PRICE, trialEndsAt: trial,
        ...(subscribed ? { status: "ACTIVE", currentPeriodStart: addDays(new Date(), -10), currentPeriodEnd: addDays(new Date(), 20) } : {}),
      },
    });
    if (!subscribed) continue;
    const pay = await prisma.subscriptionPayment.create({
      data: { subscriptionId: sub.id, amountCents: PRICE, currency: "usd", status: "SUCCEEDED", source: "SIMULATED", isFirstPayment: true, periodStart: addDays(new Date(), -10), periodEnd: addDays(new Date(), 20), paidAt: addDays(new Date(), -10) },
    });
    commissions[email] = pay.id;
  }

  const com = (affiliateId: string, email: string | null, data: Partial<Prisma.AffiliateCommissionUncheckedCreateInput> & { amountCents: number }) =>
    find(email ?? "admin").then((u) =>
      prisma.affiliateCommission.create({
        data: {
          affiliateId, referredUserId: email ? u?.id : null, subscriptionPaymentId: email ? commissions[email] : null,
          source: email ? "SUBSCRIPTION" : "MANUAL", baseAmountCents: email ? PRICE : null, currency: "usd", payableAt: new Date(), ...data,
        },
      }),
    );
  if (a1) {
    const t = { commissionType: "PERCENT" as const, commissionValue: 20 };
    await com(a1.id, "borrower1", { ...t, amountCents: 180, status: "PAID", payableAt: addDays(new Date(), -20), paidAt: addDays(new Date(), -3), paidById: admin.id, paymentReference: "TRANSFER-001" });
    await com(a1.id, "borrower2", { ...t, amountCents: 180, status: "PENDING", payableAt: addDays(new Date(), -1) }); // ya pagable
    await com(a1.id, "borrower3", { ...t, amountCents: 180, status: "PENDING", payableAt: daysFromNow(6) }); // aún no
    await com(a1.id, null, { amountCents: 500, status: "VOID", voidedAt: new Date(), voidedById: admin.id, note: "Bono manual anulado (seed)" });
  }
  if (a2) await com(a2.id, "borrower8", { commissionType: "FIXED", commissionValue: 5, amountCents: 500, status: "PENDING" });
  console.log("seedAffiliates: lender1 (20%, 7 días) y borrower4 ($5) aprobados; lender2 pendiente, lender3 rechazado, borrower6 suspendido, borrower7 inactivo.");
}
