import { Prisma, type AllocationType, type PaymentMethodChannel, type TransactionStatus, type TransactionType } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { NOW, addDays, audit, daysFromNow, ownerOf, type ContractEntry, type Ctx } from "./ctx";

// PaymentMethod (estado × verificación), ScheduledPayment (PENDING/PARTIALLY_PAID/
// PAID/VOIDED), Transaction (7 estados × 6 tipos × 5 canales), TransactionAllocation,
// Autopay (ACTIVE/PAUSED/CANCELLED) y WebhookEvent (4 estados). Todo ≥3 casos.

const D = Prisma.Decimal;
type Dec = Prisma.Decimal | string | number;
const METHODS: PaymentMethodChannel[] = ["ACH", "ACH", "CHECK", "WIRE", "CARD", "MANUAL"];
const byKey = (ctx: Ctx, key: string) => ctx.contracts.find((c) => c.spec.key === key)!;
let txSeq = 0;

export async function seedPayments(ctx: Ctx) {
  await seedPaymentMethods(ctx);
  for (const entry of ctx.contracts) {
    if (entry.spec.plan === "current") await payCurrent(ctx, entry);
    if (entry.spec.plan === "delinquent") await payDelinquent(ctx, entry);
    if (entry.spec.plan === "payoff") await payOff(ctx, entry);
    if (entry.spec.plan) await finalize(entry);
  }
  await seedExtraTransactions(ctx);
  await seedAutopays(ctx);
  await seedWebhooks();
}

// 6 ACTIVE+VERIFIED (uno por deudor) + casos PENDING_VERIFICATION / FAILED / REMOVED.
async function seedPaymentMethods(ctx: Ctx) {
  let n = 0;
  const add = async (key: string, status: "ACTIVE" | "REMOVED", verificationStatus: "PENDING_VERIFICATION" | "VERIFIED" | "FAILED", isDefault = false) => {
    n++;
    const pm = await prisma.paymentMethod.create({
      data: {
        userId: ctx.borrowers[key].user.id, status, verificationStatus, isDefault,
        stripeCustomerId: `cus_seed_${key}`, stripePaymentMethodId: `pm_seed_${n}`,
        bankName: ["Chase", "Wells Fargo", "Bank of America", "Frost Bank"][n % 4], last4: String(1000 + n * 37).slice(-4),
        removedAt: status === "REMOVED" ? daysFromNow(-12) : null,
      },
    });
    (ctx.paymentMethods[key] ??= []).push(pm);
    await audit({ action: status === "REMOVED" ? "PAYMENT_METHOD_REMOVED" : "PAYMENT_METHOD_ADDED", entityType: "PaymentMethod", entityId: pm.id, actorUserId: pm.userId });
  };
  for (const key of ["borrower1", "borrower2", "borrower3", "borrower4", "borrower5", "borrower6"]) await add(key, "ACTIVE", "VERIFIED", true);
  await add("borrower1", "ACTIVE", "PENDING_VERIFICATION");
  await add("borrower2", "REMOVED", "PENDING_VERIFICATION");
  await add("borrower3", "REMOVED", "PENDING_VERIFICATION");
  await add("borrower4", "REMOVED", "FAILED");
  await add("borrower5", "REMOVED", "FAILED");
  await add("borrower6", "REMOVED", "FAILED");
}

interface TxIn {
  c: ContractEntry;
  type: TransactionType;
  status: TransactionStatus;
  method: PaymentMethodChannel;
  amount: Dec;
  at: Date;
  by?: string;
  allocs?: [AllocationType, Dec, string | null][];
  notes?: string;
  failureReason?: string;
  returnCode?: string;
}

async function makeTx(ctx: Ctx, t: TxIn) {
  const n = ++txSeq;
  const card = t.method === "ACH" || t.method === "CARD";
  const pm = ctx.paymentMethods[t.c.spec.borrowers[0]]?.[0];
  const s = t.status;
  const tx = await prisma.transaction.create({
    data: {
      contractId: t.c.contract.id, type: t.type, status: s, method: t.method, amount: new D(t.amount),
      stripePaymentIntentId: card ? `pi_seed_${n}` : null, stripeChargeId: card && s === "SUCCEEDED" ? `ch_seed_${n}` : null,
      stripePaymentMethodId: card ? pm?.stripePaymentMethodId : null, last4: card ? pm?.last4 : null,
      failureReason: t.failureReason, returnCode: t.returnCode,
      initiatedByUserId: t.by ?? ctx.borrowers[t.c.spec.borrowers[0]]?.user.id ?? null,
      initiatedAt: t.at,
      processedAt: ["PROCESSING", "SUCCEEDED", "RETURNED", "REFUNDED"].includes(s) ? t.at : null,
      settledAt: ["SUCCEEDED", "RETURNED", "REFUNDED"].includes(s) ? addDays(t.at, 1) : null,
      failedAt: s === "FAILED" ? addDays(t.at, 1) : null,
      returnedAt: s === "RETURNED" ? addDays(t.at, 3) : null,
      refundedAt: s === "REFUNDED" ? addDays(t.at, 5) : null,
      notes: t.notes,
    },
  });
  for (const [allocationType, amount, scheduledPaymentId] of t.allocs ?? []) {
    if (new D(amount).lte(0)) continue;
    await prisma.transactionAllocation.create({ data: { transactionId: tx.id, scheduledPaymentId, allocationType, amount: new D(amount) } });
  }
  const log = { entityType: "Transaction", entityId: tx.id, contractId: t.c.contract.id, lenderCompanyId: t.c.contract.lenderCompanyId, actorUserId: tx.initiatedByUserId ?? undefined };
  await audit({ ...log, action: "TRANSACTION_CREATED" });
  if (s === "SUCCEEDED") await audit({ ...log, action: "TRANSACTION_SUCCEEDED" });
  if (s === "RETURNED") await audit({ ...log, action: "TRANSACTION_RETURNED", actorUserId: ctx.admin.id });
  return tx;
}

/** Paga (total o parcialmente) una cuota: Transaction SUCCEEDED + allocations + estado de la fila. */
async function payRow(ctx: Ctx, c: ContractEntry, idx: number, at: Date, fraction = 1) {
  const row = c.rows[idx];
  const amount = row.totalDue.times(fraction).toDecimalPlaces(2);
  const interest = D.min(amount, row.interestDue);
  await makeTx(ctx, {
    c, type: "SCHEDULED_PAYMENT", status: "SUCCEEDED", method: METHODS[(txSeq + 1) % METHODS.length], amount, at,
    allocs: [["INTEREST", interest, row.id], ["PRINCIPAL", amount.minus(interest), row.id]],
  });
  const full = fraction === 1;
  await prisma.scheduledPayment.update({ where: { id: row.id }, data: { amountPaid: amount, status: full ? "PAID" : "PARTIALLY_PAID", paidInFullAt: full ? at : null } });
}

const pastRows = (c: ContractEntry) => c.rows.filter((r) => r.dueDate <= NOW);
const payDate = (due: Date) => new Date(Math.min(addDays(due, 1).getTime(), NOW.getTime()));

async function payCurrent(ctx: Ctx, c: ContractEntry) {
  for (const [i, row] of pastRows(c).entries()) await payRow(ctx, c, i, payDate(row.dueDate));
}

async function payDelinquent(ctx: Ctx, c: ContractEntry) {
  const k = c.spec.paidRows!;
  for (let i = 0; i < k; i++) await payRow(ctx, c, i, payDate(c.rows[i].dueDate));
  await payRow(ctx, c, k, payDate(c.rows[k].dueDate), 0.5); // pago parcial → PARTIALLY_PAID

  const fee = c.terms.lateFeeType === "FLAT" ? c.terms.lateFeeAmount : (c.rows[k].totalDue.times(c.terms.lateFeeAmount).div(100).toDecimalPlaces(2));
  for (const [i, row] of pastRows(c).entries()) {
    if (i < k) continue;
    const assessedAt = addDays(row.dueDate, c.terms.gracePeriodDays + 1);
    await prisma.scheduledPayment.update({ where: { id: row.id }, data: { lateFeeAssessed: fee, lateFeeAssessedAt: assessedAt } });
    await audit({ action: "LATE_FEE_ASSESSED", entityType: "ScheduledPayment", entityId: row.id, systemActorLabel: "late-fee-job", lenderCompanyId: c.contract.lenderCompanyId, contractId: c.contract.id });
  }
  // LATE_FEE_PAYMENT (la mora de la cuota parcial, pagada) + intentos fallidos/devueltos/en proceso.
  await makeTx(ctx, { c, type: "LATE_FEE_PAYMENT", status: "SUCCEEDED", method: "ACH", amount: fee, at: addDays(c.rows[k].dueDate, 12), allocs: [["LATE_FEE", fee, c.rows[k].id]] });
  const next = c.rows[k + 1];
  await makeTx(ctx, { c, type: "SCHEDULED_PAYMENT", status: "FAILED", method: "ACH", amount: next.totalDue, at: addDays(next.dueDate, 2), failureReason: "Insufficient funds", returnCode: "R01" });
  await makeTx(ctx, { c, type: "SCHEDULED_PAYMENT", status: "RETURNED", method: "ACH", amount: next.totalDue, at: addDays(next.dueDate, 5), returnCode: "R02", notes: "Account closed", allocs: [["INTEREST", next.interestDue, next.id], ["PRINCIPAL", next.principalDue, next.id]] });
  await makeTx(ctx, { c, type: "SCHEDULED_PAYMENT", status: "PROCESSING", method: "ACH", amount: next.totalDue, at: addDays(NOW, -1) });
}

// Payoff anticipado: saldo restante + interés del mes; las cuotas siguientes quedan VOIDED.
async function payOff(ctx: Ctx, c: ContractEntry) {
  const k = c.spec.paidRows!;
  for (let i = 0; i < k; i++) await payRow(ctx, c, i, payDate(c.rows[i].dueDate));
  const at = payDate(c.rows[k].dueDate);
  const principal = c.rows[k - 1].projectedRemainingBalance;
  const interest = c.rows[k].interestDue;
  await makeTx(ctx, {
    c, type: "PAYOFF_PAYMENT", status: "SUCCEEDED", method: "WIRE", amount: principal.plus(interest), at,
    allocs: [["INTEREST", interest, null], ["PRINCIPAL", principal, null]], notes: "Payoff anticipado",
  });
  await prisma.scheduledPayment.updateMany({ where: { contractId: c.contract.id, sequenceNumber: { gt: k } }, data: { status: "VOIDED" } });
  await prisma.contract.update({ where: { id: c.contract.id }, data: { paidOffAt: at } });
}

// Saldo y próxima fecha derivados de las filas reales, no inventados.
async function finalize(c: ContractEntry) {
  const rows = await prisma.scheduledPayment.findMany({ where: { contractId: c.contract.id }, orderBy: { sequenceNumber: "asc" } });
  const lastPaid = [...rows].reverse().find((r) => r.status === "PAID");
  const open = rows.find((r) => r.status === "PENDING" || r.status === "PARTIALLY_PAID");
  const paidOff = c.spec.status === "PAID_OFF";
  await prisma.contract.update({
    where: { id: c.contract.id },
    data: { currentPrincipalBalance: paidOff ? "0.00" : (lastPaid?.projectedRemainingBalance ?? c.terms.principalAmount), nextPaymentDueDate: paidOff ? null : (open?.dueDate ?? null) },
  });
  c.rows = rows;
}

// Matriz de Transaction para llegar a ≥3 de cada estado/tipo que el flujo natural no cubre.
async function seedExtraTransactions(ctx: Ctx) {
  const actives = ["active1", "active2", "active3"].map((k) => byKey(ctx, k));
  const paids = ["paid1", "paid2", "paid3"].map((k) => byKey(ctx, k));
  for (const [i, c] of actives.entries()) {
    const next = c.rows.find((r) => r.dueDate > NOW)!;
    await makeTx(ctx, { c, type: "SCHEDULED_PAYMENT", status: "PENDING", method: "ACH", amount: next.totalDue, at: NOW });
    await makeTx(ctx, { c, type: "SCHEDULED_PAYMENT", status: "CANCELLED", method: i === 0 ? "CARD" : "ACH", amount: next.totalDue, at: addDays(NOW, -2), notes: "Cancelado por el deudor antes de procesarse" });
    await makeTx(ctx, { c, type: "ADJUSTMENT", status: "SUCCEEDED", method: "MANUAL", amount: "25.00", at: addDays(NOW, -3), by: ctx.admin.id, notes: "Ajuste manual por cargo bancario" });
    const prepay = (5_000 * (i + 1)).toFixed(2);
    await makeTx(ctx, { c, type: "PRINCIPAL_PREPAYMENT", status: "SUCCEEDED", method: "WIRE", amount: prepay, at: addDays(NOW, -1), allocs: [["PRINCIPAL", prepay, null]] });
    await prisma.contract.update({ where: { id: c.contract.id }, data: { currentPrincipalBalance: { decrement: prepay } } });
  }
  for (const c of paids) {
    const at = addDays(NOW, -40);
    await makeTx(ctx, { c, type: "SCHEDULED_PAYMENT", status: "REFUNDED", method: "CHECK", amount: "500.00", at, notes: "Pago duplicado" });
    await makeTx(ctx, { c, type: "REFUND", status: "SUCCEEDED", method: "CHECK", amount: "500.00", at: addDays(at, 5), by: ownerOf(ctx, c.spec.company).id, notes: "Reembolso del pago duplicado" });
  }
}

async function seedAutopays(ctx: Ctx) {
  const make = async (key: string, status: "ACTIVE" | "PAUSED" | "CANCELLED") => {
    const c = byKey(ctx, key);
    const b = ctx.borrowers[c.spec.borrowers[0]];
    const next = c.rows.find((r) => r.status === "PENDING" && r.dueDate > NOW);
    await prisma.autopay.create({
      data: {
        contractId: c.contract.id, borrowerProfileId: b.profile.id, paymentMethodId: ctx.paymentMethods[c.spec.borrowers[0]][0].id, status,
        amountType: status === "PAUSED" ? "FIXED_AMOUNT" : "SCHEDULED_AMOUNT_DUE", fixedAmount: status === "PAUSED" ? "1000.00" : null,
        nextAttemptScheduledFor: status === "CANCELLED" ? null : next?.dueDate,
        cancelledByUserId: status === "CANCELLED" ? b.user.id : null, cancelledAt: status === "CANCELLED" ? daysFromNow(-30) : null,
      },
    });
  };
  for (const k of ["active1", "active2", "active3"]) await make(k, "ACTIVE");
  for (const k of ["delinq1", "delinq2", "delinq3"]) await make(k, "PAUSED");
  for (const k of ["paid1", "paid2", "paid3"]) await make(k, "CANCELLED");
}

async function seedWebhooks() {
  const pis = (await prisma.transaction.findMany({ where: { stripePaymentIntentId: { not: null } }, take: 12, orderBy: { createdAt: "asc" } })).map((t) => t.stripePaymentIntentId!);
  const plan = [
    ...Array(3).fill(["PROCESSED", "payment_intent.succeeded"]),
    ...Array(3).fill(["RECEIVED", "payment_intent.processing"]),
    ...Array(3).fill(["FAILED", "payment_intent.payment_failed"]),
    ...Array(3).fill(["IGNORED", "customer.created"]),
  ] as ["PROCESSED" | "RECEIVED" | "FAILED" | "IGNORED", string][];
  for (const [i, [status, eventType]] of plan.entries()) {
    await prisma.webhookEvent.create({
      data: {
        externalEventId: `evt_seed_${i + 1}`, eventType, status,
        payload: { id: `evt_seed_${i + 1}`, type: eventType, data: { object: { id: pis[i] ?? `pi_unknown_${i}` } } },
        error: status === "FAILED" ? "No matching Transaction for payment intent" : null,
        processedAt: status === "RECEIVED" ? null : daysFromNow(-1),
      },
    });
  }
}
