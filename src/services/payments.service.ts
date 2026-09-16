import { Prisma } from "@prisma/client";
import type { Session } from "@/middlewares/withAuth";
import { requireContractAccess } from "@/middlewares/requireContractAccess";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import type { CreateManualPaymentInput, ListTransactionsQuery, ReverseTransactionInput } from "@/validations/payments.validation";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";

const { Decimal } = Prisma;
type TxClient = Prisma.TransactionClient;
type AllocationBucket = "LATE_FEE" | "INTEREST" | "PRINCIPAL";

const transactionInclude = { allocations: true } satisfies Prisma.TransactionInclude;
export type TransactionDetail = Prisma.TransactionGetPayload<{ include: typeof transactionInclude }>;

// BE-068. Fila candidata a recibir un pago, con lo que todavía le falta a
// cada balde (mora/interés/capital) — "todavía le falta" se calcula sobre
// las asignaciones de transacciones SUCCEEDED únicamente (09-pagos.md §9.3):
// una Transaction RETURNED/REFUNDED no cuenta como pagada, así que
// reverseTransaction no necesita tocar TransactionAllocation, solo cambiar
// el status de la Transaction — el próximo cálculo ya la ignora sola.
export interface AllocationRow {
  scheduledPaymentId: string;
  remainingLateFee: Prisma.Decimal;
  remainingInterest: Prisma.Decimal;
  remainingPrincipal: Prisma.Decimal;
}

export interface AllocationPlanItem {
  scheduledPaymentId: string;
  allocationType: AllocationBucket;
  amount: Prisma.Decimal;
}

// BE-068. Waterfall puro (09-pagos.md §9.3): filas más antiguas primero: `rows`
// ya viene ordenado por dueDate/sequenceNumber asc — dentro de cada fila,
// mora -> interés -> capital, hasta agotar `amount` o las filas. Sin acceso a
// Prisma acá a propósito (unit-testable, mismo patrón que
// amortization.service.ts).
export function calculatePaymentAllocation(rows: AllocationRow[], amount: Prisma.Decimal): AllocationPlanItem[] {
  let remaining = amount;
  const plan: AllocationPlanItem[] = [];

  for (const row of rows) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const buckets: [AllocationBucket, Prisma.Decimal][] = [
      ["LATE_FEE", row.remainingLateFee],
      ["INTEREST", row.remainingInterest],
      ["PRINCIPAL", row.remainingPrincipal],
    ];

    for (const [allocationType, due] of buckets) {
      if (remaining.lessThanOrEqualTo(0)) break;
      if (due.lessThanOrEqualTo(0)) continue;
      const applied = Decimal.min(due, remaining);
      plan.push({ scheduledPaymentId: row.scheduledPaymentId, allocationType, amount: applied });
      remaining = remaining.minus(applied);
    }
  }

  return plan;
}

async function loadAllocationRows(tx: TxClient, contractId: string): Promise<AllocationRow[]> {
  const candidates = await tx.scheduledPayment.findMany({
    where: { contractId, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
    orderBy: [{ dueDate: "asc" }, { sequenceNumber: "asc" }],
    include: { allocations: { include: { transaction: { select: { status: true } } } } },
  });

  return candidates.map((row) => {
    const paidFor = (type: AllocationBucket) =>
      row.allocations
        .filter((allocation) => allocation.allocationType === type && allocation.transaction.status === "SUCCEEDED")
        .reduce((sum, allocation) => sum.plus(allocation.amount), new Decimal(0));

    return {
      scheduledPaymentId: row.id,
      remainingLateFee: row.lateFeeAssessed.minus(paidFor("LATE_FEE")),
      remainingInterest: row.interestDue.minus(paidFor("INTEREST")),
      remainingPrincipal: row.principalDue.minus(paidFor("PRINCIPAL")),
    };
  });
}

async function recomputeNextPaymentDueDate(tx: TxClient, contractId: string): Promise<void> {
  const nextPending = await tx.scheduledPayment.findFirst({
    where: { contractId, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
    orderBy: [{ dueDate: "asc" }, { sequenceNumber: "asc" }],
  });
  await tx.contract.update({ where: { id: contractId }, data: { nextPaymentDueDate: nextPending?.dueDate ?? null } });
}

// BE-068. Se ejecuta SOLO sobre una Transaction ya SUCCEEDED (09-pagos.md
// §9.2/9.3) — nunca antes; corre dentro de la misma `$transaction` de Prisma
// que la creó (o, para el ACH del deudor de BE-066, la que procesa el
// webhook, todavía bloqueado por A-3). Persiste TransactionAllocation y
// actualiza ScheduledPayment.amountPaid/status + Contract.
// currentPrincipalBalance/nextPaymentDueDate.
export async function applyTransaction(tx: TxClient, transactionId: string): Promise<void> {
  const transaction = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (transaction.status !== "SUCCEEDED") {
    throw new AppError("applyTransaction only runs on a SUCCEEDED transaction", 409, "TRANSACTION_NOT_SUCCEEDED");
  }

  const rows = await loadAllocationRows(tx, transaction.contractId);
  const totalOutstanding = rows.reduce(
    (sum, row) => sum.plus(row.remainingLateFee).plus(row.remainingInterest).plus(row.remainingPrincipal),
    new Decimal(0),
  );
  if (transaction.amount.greaterThan(totalOutstanding)) {
    throw new AppError("Payment amount exceeds the contract's total outstanding balance", 400, "AMOUNT_EXCEEDS_BALANCE");
  }

  const plan = calculatePaymentAllocation(rows, transaction.amount);
  if (plan.length === 0) return;

  await tx.transactionAllocation.createMany({
    data: plan.map((item) => ({
      transactionId,
      scheduledPaymentId: item.scheduledPaymentId,
      allocationType: item.allocationType,
      amount: item.amount,
    })),
  });

  // amountPaid/status de ScheduledPayment reflejan solo interés+capital
  // (totalDue = principalDue + interestDue, la mora se factura aparte —
  // amortization.service.ts) — se agrupa por fila para actualizar cada una
  // una sola vez.
  const principalAndInterestByRow = new Map<string, Prisma.Decimal>();
  let totalPrincipalApplied = new Decimal(0);
  for (const item of plan) {
    if (item.allocationType === "LATE_FEE") continue;
    principalAndInterestByRow.set(item.scheduledPaymentId, (principalAndInterestByRow.get(item.scheduledPaymentId) ?? new Decimal(0)).plus(item.amount));
    if (item.allocationType === "PRINCIPAL") totalPrincipalApplied = totalPrincipalApplied.plus(item.amount);
  }

  for (const [scheduledPaymentId, appliedAmount] of principalAndInterestByRow) {
    const row = await tx.scheduledPayment.findUniqueOrThrow({ where: { id: scheduledPaymentId } });
    const newAmountPaid = row.amountPaid.plus(appliedAmount);
    const isFull = newAmountPaid.greaterThanOrEqualTo(row.totalDue);
    await tx.scheduledPayment.update({
      where: { id: scheduledPaymentId },
      data: { amountPaid: newAmountPaid, status: isFull ? "PAID" : "PARTIALLY_PAID", paidInFullAt: isFull ? new Date() : null },
    });
  }

  if (totalPrincipalApplied.greaterThan(0)) {
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: transaction.contractId } });
    await tx.contract.update({
      where: { id: contract.id },
      data: { currentPrincipalBalance: (contract.currentPrincipalBalance ?? new Decimal(0)).minus(totalPrincipalApplied) },
    });
  }

  await recomputeNextPaymentDueDate(tx, transaction.contractId);
}

// BE-067. `POST /api/contracts/:id/payments/manual` — reconciliación manual
// (wire/cheque), sin depender de Stripe (A-3 sigue bloqueado). El Lender
// registra un cobro que ya se liquidó fuera de la plataforma, así que la
// Transaction nace directamente SUCCEEDED (no hay PENDING/PROCESSING
// asíncrono que esperar, a diferencia del ACH de BE-066) y se aplica en el
// acto.
export async function recordManualPayment(userId: string, contractId: string, input: CreateManualPaymentInput): Promise<TransactionDetail> {
  const contract = await requireContractAccess({ userId, role: "LENDER", roles: ["LENDER"] }, contractId);
  if (contract.status !== "ACTIVE" && contract.status !== "DELINQUENT") {
    throw new AppError("The contract has no active payment schedule to apply a payment to", 409, "CONTRACT_NOT_ACTIVE");
  }

  const amount = new Decimal(input.amount);
  const occurredAt = input.occurredAt ?? new Date();

  const transactionId = await prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        contractId,
        type: "SCHEDULED_PAYMENT",
        status: "SUCCEEDED",
        method: input.method,
        amount,
        initiatedByUserId: userId,
        initiatedAt: occurredAt,
        processedAt: new Date(),
        settledAt: new Date(),
        notes: input.notes,
      },
    });
    await applyTransaction(tx, transaction.id);
    return transaction.id;
  });

  await logAuditEvent({
    action: "TRANSACTION_CREATED",
    entityType: "Transaction",
    entityId: transactionId,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId,
    metadata: { amount: amount.toString(), method: input.method },
  });
  await logAuditEvent({
    action: "TRANSACTION_SUCCEEDED",
    entityType: "Transaction",
    entityId: transactionId,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId,
  });

  return prisma.transaction.findUniqueOrThrow({ where: { id: transactionId }, include: transactionInclude });
}

// BE-069.
export async function listTransactions(session: Session, contractId: string, query: ListTransactionsQuery): Promise<PaginatedResult<TransactionDetail>> {
  await requireContractAccess(session, contractId);

  const where: Prisma.TransactionWhereInput = { contractId };
  const [total, transactions] = await Promise.all([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      include: transactionInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return buildPaginatedResult(transactions, total, query);
}

// BE-069.
export async function getTransaction(session: Session, transactionId: string): Promise<TransactionDetail> {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId }, include: transactionInclude });
  if (!transaction) {
    throw new AppError("Transaction not found", 404, "NOT_FOUND");
  }
  await requireContractAccess(session, transaction.contractId);
  return transaction;
}

// BE-071. Solo ADMIN (09-pagos.md §9.5: "Reversar transacción (ACH return)":
// Sí para ADMIN, No para LENDER/BORROWER). Nunca borra/edita
// TransactionAllocation (append-only, igual que AuditLog) — revierte
// ScheduledPayment.amountPaid/status y Contract.currentPrincipalBalance
// restando lo que esa Transaction había aplicado, y deja la Transaction en
// RETURNED: el próximo calculatePaymentAllocation ya la ignora (filtra por
// status=SUCCEEDED, ver loadAllocationRows).
export async function reverseTransaction(userId: string, transactionId: string, input: ReverseTransactionInput): Promise<TransactionDetail> {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId }, include: transactionInclude });
  if (!transaction) {
    throw new AppError("Transaction not found", 404, "NOT_FOUND");
  }
  if (transaction.status !== "SUCCEEDED") {
    throw new AppError("Only a SUCCEEDED transaction can be reversed", 409, "TRANSACTION_NOT_REVERSIBLE");
  }

  const contract = await requireContractAccess({ userId, role: "ADMIN", roles: ["ADMIN"] }, transaction.contractId);

  await prisma.$transaction(async (tx) => {
    const principalAndInterestByRow = new Map<string, Prisma.Decimal>();
    let totalPrincipalReversed = new Decimal(0);
    for (const allocation of transaction.allocations) {
      if (allocation.allocationType === "LATE_FEE" || !allocation.scheduledPaymentId) continue;
      principalAndInterestByRow.set(
        allocation.scheduledPaymentId,
        (principalAndInterestByRow.get(allocation.scheduledPaymentId) ?? new Decimal(0)).plus(allocation.amount),
      );
      if (allocation.allocationType === "PRINCIPAL") totalPrincipalReversed = totalPrincipalReversed.plus(allocation.amount);
    }

    for (const [scheduledPaymentId, reversedAmount] of principalAndInterestByRow) {
      const row = await tx.scheduledPayment.findUniqueOrThrow({ where: { id: scheduledPaymentId } });
      const newAmountPaid = Decimal.max(row.amountPaid.minus(reversedAmount), 0);
      const status = newAmountPaid.lessThanOrEqualTo(0) ? "PENDING" : newAmountPaid.lessThan(row.totalDue) ? "PARTIALLY_PAID" : "PAID";
      await tx.scheduledPayment.update({
        where: { id: scheduledPaymentId },
        data: { amountPaid: newAmountPaid, status, paidInFullAt: status === "PAID" ? (row.paidInFullAt ?? new Date()) : null },
      });
    }

    if (totalPrincipalReversed.greaterThan(0)) {
      const currentContract = await tx.contract.findUniqueOrThrow({ where: { id: transaction.contractId } });
      await tx.contract.update({
        where: { id: currentContract.id },
        data: { currentPrincipalBalance: (currentContract.currentPrincipalBalance ?? new Decimal(0)).plus(totalPrincipalReversed) },
      });
    }

    await recomputeNextPaymentDueDate(tx, transaction.contractId);

    await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        notes: [transaction.notes, `Reversed: ${input.reason}`].filter(Boolean).join(" | "),
      },
    });
  });

  await logAuditEvent({
    action: "TRANSACTION_RETURNED",
    entityType: "Transaction",
    entityId: transactionId,
    actorUserId: userId,
    lenderCompanyId: contract.lenderCompanyId,
    contractId: transaction.contractId,
    metadata: { reason: input.reason },
  });

  return prisma.transaction.findUniqueOrThrow({ where: { id: transactionId }, include: transactionInclude });
}
