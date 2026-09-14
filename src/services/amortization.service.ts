import { Prisma } from "@prisma/client";
import { AppError } from "@/errors/AppError";

const { Decimal } = Prisma;

type DecimalInput = Prisma.Decimal | number | string;
type TxClient = Prisma.TransactionClient;

function d(value: DecimalInput): Prisma.Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

// BE-058. Fórmula PMT francesa estándar (REUSE de lib/actions.ts de Owner,
// ver Docs/plan/08-contratos.md §8.4) — r=0 (poco común, pero matemáticamente
// válido) se trata aparte para no dividir por cero.
export function calculateAmortizedPayment(principal: DecimalInput, annualRatePercent: DecimalInput, termMonths: number): Prisma.Decimal {
  const p = d(principal);
  const monthlyRate = d(annualRatePercent).div(100).div(12);
  if (monthlyRate.isZero()) {
    return p.div(termMonths).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  const factor = monthlyRate.plus(1).pow(termMonths);
  return p.times(monthlyRate).times(factor).div(factor.minus(1)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// BE-058. ADAPT — no existe aislada en Owner, fórmula trivial: interés
// mensual simple, sin amortización de capital.
export function calculateInterestOnlyPayment(principal: DecimalInput, annualRatePercent: DecimalInput): Prisma.Decimal {
  return d(principal)
    .times(d(annualRatePercent).div(100))
    .div(12)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// BE-058. NEW — el pago mensual de un balloon es el PMT calculado sobre el
// plazo de amortización "teórico" (amortizationTermMonths, ej. 30 años);
// maturityDate/firstPaymentDate no cambian ese monto, solo truncan el
// calendario (generateAmortizationSchedule) — se reciben para respetar la
// firma que pide el ticket, documentando por qué no se usan acá.
export function calculateBalloonPayment(
  principal: DecimalInput,
  annualRatePercent: DecimalInput,
  amortizationTermMonths: number,
  maturityDate: Date,
  firstPaymentDate: Date,
): Prisma.Decimal {
  if (maturityDate <= firstPaymentDate) {
    throw new AppError("maturityDate must be after firstPaymentDate", 400, "VALIDATION_ERROR");
  }
  return calculateAmortizedPayment(principal, annualRatePercent, amortizationTermMonths);
}

export type DayCountConvention = "THIRTY_360" | "ACTUAL_365";

function days30360(from: Date, to: Date): number {
  let d1 = from.getUTCDate();
  let d2 = to.getUTCDate();
  const m1 = from.getUTCMonth() + 1;
  const m2 = to.getUTCMonth() + 1;
  const y1 = from.getUTCFullYear();
  const y2 = to.getUTCFullYear();
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

function daysActual(from: Date, to: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

// BE-058. NEW — interés devengado por día, necesario para saldo vivo entre
// fechas de corte (Owner nunca calcula esto, ver 08-contratos.md §8.4).
export function calculateAccruedInterest(
  principal: DecimalInput,
  annualRatePercent: DecimalInput,
  dayCountConvention: DayCountConvention,
  fromDate: Date,
  toDate: Date,
): Prisma.Decimal {
  const days = dayCountConvention === "THIRTY_360" ? days30360(fromDate, toDate) : daysActual(fromDate, toDate);
  if (days <= 0) return new Decimal(0);
  const denominator = dayCountConvention === "THIRTY_360" ? 360 : 365;
  const dailyRate = d(annualRatePercent).div(100).div(denominator);
  return d(principal).times(dailyRate).times(days).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// Exportada para Fase 13 (loanQuotes.service.ts) — deriva firstPaymentDate/
// maturityDate a partir de LoanRequest.requestedClosingDate + los años que
// pidió el Deudor.
export function addMonths(date: Date, months: number): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
  return result;
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

interface ScheduleRowDraft {
  sequenceNumber: number;
  dueDate: Date;
  principalDue: Prisma.Decimal;
  interestDue: Prisma.Decimal;
  totalDue: Prisma.Decimal;
  projectedRemainingBalance: Prisma.Decimal;
}

// Núcleo compartido por AMORTIZED y BALLOON: ambos son la misma
// amortización declinante mes a mes, solo cambia cuántas filas se generan
// (n) y con qué PMT (monthlyPayment) — ver Docs/plan/08-contratos.md §8.4.
// La última fila siempre cierra el saldo restante exacto en $0.00 (nunca
// deja centavos flotando por redondeo acumulado, PAYMYLOAN_DATABASE_DESIGN
// §14).
function buildDecliningBalanceRows(params: {
  principal: Prisma.Decimal;
  annualRatePercent: Prisma.Decimal;
  monthlyPayment: Prisma.Decimal;
  firstPaymentDate: Date;
  rowCount: number;
}): ScheduleRowDraft[] {
  const { principal, annualRatePercent, monthlyPayment, firstPaymentDate, rowCount } = params;
  const monthlyRate = annualRatePercent.div(100).div(12);

  const rows: ScheduleRowDraft[] = [];
  let balance = principal;
  for (let i = 1; i <= rowCount; i++) {
    const interestDue = balance.times(monthlyRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const isLastRow = i === rowCount;
    const principalDue = isLastRow ? balance : Decimal.min(monthlyPayment.minus(interestDue), balance);
    const totalDue = principalDue.plus(interestDue);
    balance = balance.minus(principalDue);

    rows.push({
      sequenceNumber: i,
      dueDate: addMonths(firstPaymentDate, i - 1),
      principalDue,
      interestDue,
      totalDue,
      projectedRemainingBalance: balance,
    });
  }
  return rows;
}

function buildInterestOnlyRows(params: {
  principal: Prisma.Decimal;
  annualRatePercent: Prisma.Decimal;
  firstPaymentDate: Date;
  rowCount: number;
}): ScheduleRowDraft[] {
  const { principal, annualRatePercent, firstPaymentDate, rowCount } = params;
  const monthlyInterest = calculateInterestOnlyPayment(principal, annualRatePercent);

  const rows: ScheduleRowDraft[] = [];
  for (let i = 1; i <= rowCount; i++) {
    const isLastRow = i === rowCount;
    const principalDue = isLastRow ? principal : new Decimal(0);
    const totalDue = monthlyInterest.plus(principalDue);
    rows.push({
      sequenceNumber: i,
      dueDate: addMonths(firstPaymentDate, i - 1),
      principalDue,
      interestDue: monthlyInterest,
      totalDue,
      projectedRemainingBalance: isLastRow ? new Decimal(0) : principal,
    });
  }
  return rows;
}

// BE-059. Genera el calendario completo de una ContractTerms ACCEPTED en
// una sola $transaction (recibe `tx`, no crea la suya — se llama siempre
// desde dentro de la transacción más grande de contracts.service que
// también mueve Contract.status/ContractTerms.status, D0-3). Sin el
// auto-marcado de filas pasadas como PAID que tenía Owner (ADAPT, incorrecto
// para un préstamo que nace hoy).
export async function generateAmortizationSchedule(tx: TxClient, contractTermsId: string): Promise<void> {
  const existing = await tx.scheduledPayment.count({ where: { contractTermsId } });
  if (existing > 0) {
    throw new AppError("A schedule already exists for this terms version", 409, "SCHEDULE_ALREADY_GENERATED");
  }

  const terms = await tx.contractTerms.findUniqueOrThrow({ where: { id: contractTermsId } });
  const rowCount = monthsBetween(terms.firstPaymentDate, terms.maturityDate) + 1;
  if (rowCount < 1) {
    throw new AppError("maturityDate must be after firstPaymentDate", 400, "VALIDATION_ERROR");
  }

  const principal = d(terms.principalAmount);
  const annualRate = d(terms.interestRate);

  let rows: ScheduleRowDraft[];
  let monthlyPayment: Prisma.Decimal;
  if (terms.structure === "INTEREST_ONLY") {
    monthlyPayment = calculateInterestOnlyPayment(principal, annualRate);
    rows = buildInterestOnlyRows({ principal, annualRatePercent: annualRate, firstPaymentDate: terms.firstPaymentDate, rowCount });
  } else if (terms.structure === "BALLOON") {
    monthlyPayment = calculateBalloonPayment(principal, annualRate, terms.amortizationTermMonths, terms.maturityDate, terms.firstPaymentDate);
    rows = buildDecliningBalanceRows({ principal, annualRatePercent: annualRate, monthlyPayment, firstPaymentDate: terms.firstPaymentDate, rowCount });
  } else {
    monthlyPayment = calculateAmortizedPayment(principal, annualRate, terms.amortizationTermMonths);
    rows = buildDecliningBalanceRows({ principal, annualRatePercent: annualRate, monthlyPayment, firstPaymentDate: terms.firstPaymentDate, rowCount });
  }

  await tx.scheduledPayment.createMany({
    data: rows.map((row) => ({
      contractId: terms.contractId,
      contractTermsId,
      sequenceNumber: row.sequenceNumber,
      dueDate: row.dueDate,
      principalDue: row.principalDue,
      interestDue: row.interestDue,
      totalDue: row.totalDue,
      projectedRemainingBalance: row.projectedRemainingBalance,
    })),
  });

  await tx.contractTerms.update({ where: { id: contractTermsId }, data: { calculatedMonthlyPayment: monthlyPayment } });
  await tx.contract.update({
    where: { id: terms.contractId },
    data: { currentPrincipalBalance: principal, nextPaymentDueDate: rows[0].dueDate },
  });
}

// BE-058/059. NEW — al renegociar un contrato ya ACTIVE (una versión nueva
// de ContractTerms completa su propio quórum de aceptación), anula las
// filas PENDING/PARTIALLY_PAID de la versión anterior (las ya PAID quedan
// intactas, son historial real) y genera el calendario de la nueva versión.
export async function regenerateScheduleAfterTermsChange(
  tx: TxClient,
  params: { previousContractTermsId: string; newContractTermsId: string },
): Promise<void> {
  await tx.scheduledPayment.updateMany({
    where: { contractTermsId: params.previousContractTermsId, status: { in: ["PENDING", "PARTIALLY_PAID"] } },
    data: { status: "VOIDED" },
  });
  await generateAmortizationSchedule(tx, params.newContractTermsId);
}
