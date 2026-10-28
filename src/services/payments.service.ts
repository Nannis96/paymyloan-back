import { Prisma } from "@prisma/client";
import type { Session } from "@/middlewares/withAuth";
import { requireContractAccess } from "@/middlewares/requireContractAccess";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { notify, notifyLenderCompany } from "@/lib/notify";
import { addMonths, applyPrepaymentToSchedule, calculateAccruedInterest, type DayCountConvention } from "@/services/amortization.service";
import type {
  CreateManualPaymentInput,
  CreatePayoffInput,
  CreatePrepaymentInput,
  ListTransactionsQuery,
  PayoffQuoteQuery,
  RejectPaymentRequestInput,
  ReverseTransactionInput,
} from "@/validations/payments.validation";
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

// Fila con lo necesario para cotizar una liquidación anticipada.
export interface PayoffRow extends AllocationRow {
  dueDate: Date;
  interestDue: Prisma.Decimal;
}

async function loadAllocationRows(tx: TxClient, contractId: string): Promise<PayoffRow[]> {
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
      dueDate: row.dueDate,
      interestDue: row.interestDue,
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
export async function applyTransaction(tx: TxClient, transactionId: string, rowsOverride?: AllocationRow[]): Promise<void> {
  const transaction = await tx.transaction.findUniqueOrThrow({ where: { id: transactionId } });
  if (transaction.status !== "SUCCEEDED") {
    throw new AppError("applyTransaction only runs on a SUCCEEDED transaction", 409, "TRANSACTION_NOT_SUCCEEDED");
  }

  const rows = rowsOverride ?? (await loadAllocationRows(tx, transaction.contractId));
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
  // El calendario ya se rehízo / anuló al aplicarlas — no hay vuelta atrás limpia.
  if (transaction.type === "PRINCIPAL_PREPAYMENT" || transaction.type === "PAYOFF_PAYMENT") {
    throw new AppError("Prepayments and payoffs cannot be reversed", 409, "TRANSACTION_NOT_REVERSIBLE");
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

// ---------------------------------------------------------------------------
// Abono a capital y liquidación anticipada. Solo si ContractTerms.
// allowPrepayment. El Lender las ejecuta en el acto; el Borrower deja una
// Transaction PENDING que el Lender confirma o rechaza.
// ---------------------------------------------------------------------------

export interface PayoffQuote {
  principal: Prisma.Decimal;
  accruedInterest: Prisma.Decimal;
  lateFees: Prisma.Decimal;
  total: Prisma.Decimal;
  asOf: Date;
}

// Puro (unit-testable). Cuotas ya vencidas se deben completas; la cuota en
// curso solo el interés devengado desde la cuota anterior hasta `asOf`; las
// futuras solo su capital. Devuelve filas listas para calculatePaymentAllocation.
export function buildPayoffRows(rows: PayoffRow[], asOf: Date, annualRatePercent: Prisma.Decimal.Value, dayCount: DayCountConvention): AllocationRow[] {
  const currentIndex = rows.findIndex((row) => row.dueDate > asOf);
  return rows.map((row, index) => {
    if (currentIndex === -1 || index < currentIndex) return row;
    if (index > currentIndex) return { ...row, remainingLateFee: new Decimal(0), remainingInterest: new Decimal(0) };

    const outstanding = rows.slice(index).reduce((sum, r) => sum.plus(r.remainingPrincipal), new Decimal(0));
    const accrued = Decimal.min(calculateAccruedInterest(outstanding, annualRatePercent, dayCount, addMonths(row.dueDate, -1), asOf), row.interestDue);
    const alreadyPaid = row.interestDue.minus(row.remainingInterest);
    return { ...row, remainingLateFee: new Decimal(0), remainingInterest: Decimal.max(accrued.minus(alreadyPaid), 0) };
  });
}

function summarizePayoff(rows: AllocationRow[], asOf: Date): PayoffQuote {
  const sum = (pick: (row: AllocationRow) => Prisma.Decimal) => rows.reduce((acc, row) => acc.plus(pick(row)), new Decimal(0));
  const principal = sum((r) => r.remainingPrincipal);
  const accruedInterest = sum((r) => r.remainingInterest);
  const lateFees = sum((r) => r.remainingLateFee);
  return { principal, accruedInterest, lateFees, total: principal.plus(accruedInterest).plus(lateFees), asOf };
}

async function requirePrepaymentContext(session: Session, contractId: string) {
  const contract = await requireContractAccess(session, contractId);
  if (contract.status !== "ACTIVE" && contract.status !== "DELINQUENT") {
    throw new AppError("The contract has no active payment schedule", 409, "CONTRACT_NOT_ACTIVE");
  }
  const terms = await prisma.contractTerms.findFirst({ where: { contractId, status: "ACCEPTED" } });
  if (!terms || !terms.allowPrepayment) {
    throw new AppError("The lender does not allow prepayments or early payoff on this contract", 403, "PREPAYMENT_NOT_ALLOWED");
  }
  return { contract, terms };
}

async function isContractLender(userId: string, lenderCompanyId: string): Promise<boolean> {
  return (await prisma.lenderCompany.findFirst({ where: { id: lenderCompanyId, lenderProfile: { userId } }, select: { id: true } })) !== null;
}

async function computePayoffQuote(tx: TxClient, contractId: string, terms: { interestRate: Prisma.Decimal; dayCountConvention: DayCountConvention }, asOf: Date) {
  const rows = buildPayoffRows(await loadAllocationRows(tx, contractId), asOf, terms.interestRate, terms.dayCountConvention);
  return { rows, quote: summarizePayoff(rows, asOf) };
}

export async function getPayoffQuote(session: Session, contractId: string, query: PayoffQuoteQuery): Promise<PayoffQuote> {
  const { terms } = await requirePrepaymentContext(session, contractId);
  return (await computePayoffQuote(prisma, contractId, terms, query.asOf ?? new Date())).quote;
}

// Ejecuta el abono dentro de `tx`: crea (o completa, si viene `existingId`) la
// Transaction y rehace el calendario.
async function executePrepayment(
  tx: TxClient,
  params: { contractId: string; userId: string; amount: Prisma.Decimal; method: CreatePrepaymentInput["method"]; notes?: string; existingId?: string; asOf: Date },
) {
  const { contractId, amount, asOf } = params;
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  const terms = await tx.contractTerms.findFirstOrThrow({ where: { contractId, status: "ACCEPTED" } });
  const balance = contract.currentPrincipalBalance ?? new Decimal(0);
  if (amount.greaterThanOrEqualTo(balance)) {
    throw new AppError("The amount covers the whole principal — use the payoff instead", 400, "USE_PAYOFF");
  }

  const settled = { status: "SUCCEEDED" as const, processedAt: new Date(), settledAt: new Date() };
  const transaction = params.existingId
    ? await tx.transaction.update({ where: { id: params.existingId }, data: settled })
    : await tx.transaction.create({
        data: { contractId, type: "PRINCIPAL_PREPAYMENT", method: params.method, amount, initiatedByUserId: params.userId, initiatedAt: asOf, notes: params.notes, ...settled },
      });

  await applyPrepaymentToSchedule(tx, { contractId, terms, currentBalance: balance, amount, asOf });
  await tx.transactionAllocation.create({ data: { transactionId: transaction.id, allocationType: "PRINCIPAL", amount } });
  await tx.contract.update({ where: { id: contractId }, data: { currentPrincipalBalance: balance.minus(amount) } });
  return transaction.id;
}

// Cotiza a `asOf`, cobra todo y cierra el contrato (PAID_OFF); las cuotas que
// no se completaron quedan VOIDED.
async function executePayoff(
  tx: TxClient,
  params: { contractId: string; userId: string; method: CreatePayoffInput["method"]; notes?: string; existingId?: string; asOf: Date },
) {
  const { contractId, asOf } = params;
  const terms = await tx.contractTerms.findFirstOrThrow({ where: { contractId, status: "ACCEPTED" } });
  const { rows, quote } = await computePayoffQuote(tx, contractId, terms, asOf);
  if (quote.total.lessThanOrEqualTo(0)) {
    throw new AppError("Nothing left to pay off", 409, "CONTRACT_NOT_ACTIVE");
  }

  const settled = { status: "SUCCEEDED" as const, amount: quote.total, processedAt: new Date(), settledAt: new Date() };
  const transaction = params.existingId
    ? await tx.transaction.update({ where: { id: params.existingId }, data: settled })
    : await tx.transaction.create({
        data: { contractId, type: "PAYOFF_PAYMENT", method: params.method, initiatedByUserId: params.userId, initiatedAt: asOf, notes: params.notes, ...settled },
      });

  await applyTransaction(tx, transaction.id, rows);
  await tx.scheduledPayment.updateMany({ where: { contractId, status: { in: ["PENDING", "PARTIALLY_PAID"] } }, data: { status: "VOIDED" } });
  await tx.contract.update({
    where: { id: contractId },
    data: { status: "PAID_OFF", paidOffAt: new Date(), currentPrincipalBalance: new Decimal(0), nextPaymentDueDate: null },
  });
  return transaction.id;
}

async function auditSettled(transactionId: string, contractId: string, lenderCompanyId: string, userId: string, metadata: Record<string, string>) {
  await logAuditEvent({ action: "TRANSACTION_CREATED", entityType: "Transaction", entityId: transactionId, actorUserId: userId, lenderCompanyId, contractId, metadata });
  await logAuditEvent({ action: "TRANSACTION_SUCCEEDED", entityType: "Transaction", entityId: transactionId, actorUserId: userId, lenderCompanyId, contractId });
}

// Borrower: deja la solicitud PENDING y avisa al Lender.
async function createRequest(params: {
  contractId: string;
  lenderCompanyId: string;
  userId: string;
  type: "PRINCIPAL_PREPAYMENT" | "PAYOFF_PAYMENT";
  amount: Prisma.Decimal;
  method: CreatePrepaymentInput["method"];
  notes?: string;
}) {
  const transaction = await prisma.transaction.create({
    data: {
      contractId: params.contractId,
      type: params.type,
      status: "PENDING",
      method: params.method,
      amount: params.amount,
      initiatedByUserId: params.userId,
      initiatedAt: new Date(),
      notes: params.notes,
    },
    include: transactionInclude,
  });
  const label = params.type === "PAYOFF_PAYMENT" ? "early payoff" : "principal prepayment";
  await notifyLenderCompany(params.lenderCompanyId, {
    type: "PAYMENT_REQUESTED",
    title: "Payment request",
    body: `The borrower requested an ${label} of ${params.amount.toFixed(2)}.`,
    relatedEntity: { type: "Contract", id: params.contractId },
  });
  return transaction;
}

export async function requestPrepayment(session: Session, contractId: string, input: CreatePrepaymentInput): Promise<TransactionDetail> {
  const { contract } = await requirePrepaymentContext(session, contractId);
  const amount = new Decimal(input.amount);
  if (!(await isContractLender(session.userId, contract.lenderCompanyId))) {
    if (amount.greaterThanOrEqualTo(contract.currentPrincipalBalance ?? 0)) {
      throw new AppError("The amount covers the whole principal — use the payoff instead", 400, "USE_PAYOFF");
    }
    return createRequest({
      contractId,
      lenderCompanyId: contract.lenderCompanyId,
      userId: session.userId,
      type: "PRINCIPAL_PREPAYMENT",
      amount,
      method: input.method,
      notes: input.notes,
    });
  }

  const transactionId = await prisma.$transaction((tx) =>
    executePrepayment(tx, { contractId, userId: session.userId, amount, method: input.method, notes: input.notes, asOf: input.occurredAt ?? new Date() }),
  );
  await auditSettled(transactionId, contractId, contract.lenderCompanyId, session.userId, { amount: amount.toString(), type: "PRINCIPAL_PREPAYMENT" });
  return prisma.transaction.findUniqueOrThrow({ where: { id: transactionId }, include: transactionInclude });
}

export async function requestPayoff(session: Session, contractId: string, input: CreatePayoffInput): Promise<TransactionDetail> {
  const { contract, terms } = await requirePrepaymentContext(session, contractId);
  if (!(await isContractLender(session.userId, contract.lenderCompanyId))) {
    const { quote } = await computePayoffQuote(prisma, contractId, terms, new Date());
    return createRequest({
      contractId,
      lenderCompanyId: contract.lenderCompanyId,
      userId: session.userId,
      type: "PAYOFF_PAYMENT",
      amount: quote.total,
      method: input.method,
      notes: input.notes,
    });
  }

  const transactionId = await prisma.$transaction((tx) =>
    executePayoff(tx, { contractId, userId: session.userId, method: input.method, notes: input.notes, asOf: input.occurredAt ?? new Date() }),
  );
  const done = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId }, include: transactionInclude });
  await auditSettled(transactionId, contractId, contract.lenderCompanyId, session.userId, { amount: done.amount.toString(), type: "PAYOFF_PAYMENT" });
  return done;
}

async function loadPendingRequest(session: Session, transactionId: string) {
  const transaction = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!transaction) throw new AppError("Transaction not found", 404, "NOT_FOUND");
  const contract = await requireContractAccess(session, transaction.contractId);
  if (!(await isContractLender(session.userId, contract.lenderCompanyId))) {
    throw new AppError("Transaction not found", 404, "NOT_FOUND");
  }
  const isRequest = transaction.type === "PRINCIPAL_PREPAYMENT" || transaction.type === "PAYOFF_PAYMENT";
  if (transaction.status !== "PENDING" || !isRequest) {
    throw new AppError("Only a pending prepayment/payoff request can be confirmed or rejected", 409, "TRANSACTION_NOT_PENDING");
  }
  return { transaction, contract };
}

// El Lender confirma que recibió el dinero. El payoff se re-cotiza a hoy
// (el interés corre entre la solicitud y la confirmación).
export async function confirmPaymentRequest(session: Session, transactionId: string): Promise<TransactionDetail> {
  const { transaction, contract } = await loadPendingRequest(session, transactionId);
  await requirePrepaymentContext(session, contract.id);
  const common = { contractId: contract.id, userId: session.userId, method: transaction.method as "WIRE" | "CHECK" | "MANUAL", existingId: transaction.id, asOf: new Date() };

  await prisma.$transaction((tx) =>
    transaction.type === "PAYOFF_PAYMENT" ? executePayoff(tx, common) : executePrepayment(tx, { ...common, amount: transaction.amount }),
  );
  const done = await prisma.transaction.findUniqueOrThrow({ where: { id: transactionId }, include: transactionInclude });
  await auditSettled(transactionId, contract.id, contract.lenderCompanyId, session.userId, { amount: done.amount.toString(), type: transaction.type });
  if (transaction.initiatedByUserId) {
    await notify({
      userId: transaction.initiatedByUserId,
      type: "PAYMENT_REQUEST_CONFIRMED",
      title: "Payment confirmed",
      body: "The lender confirmed your payment.",
      relatedEntity: { type: "Contract", id: contract.id },
    });
  }
  return done;
}

export async function rejectPaymentRequest(session: Session, transactionId: string, input: RejectPaymentRequestInput): Promise<TransactionDetail> {
  const { transaction, contract } = await loadPendingRequest(session, transactionId);
  const updated = await prisma.transaction.update({
    where: { id: transactionId },
    data: { status: "CANCELLED", notes: [transaction.notes, input.reason && `Rejected: ${input.reason}`].filter(Boolean).join(" | ") },
    include: transactionInclude,
  });
  if (transaction.initiatedByUserId) {
    await notify({
      userId: transaction.initiatedByUserId,
      type: "PAYMENT_REQUEST_REJECTED",
      title: "Payment request rejected",
      body: input.reason ?? "The lender rejected your request.",
      relatedEntity: { type: "Contract", id: contract.id },
    });
  }
  return updated;
}
