import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestLenderCompany, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import { calculateAmortizedPayment } from "@/services/amortization.service";
import * as contractsService from "@/services/contracts.service";
import * as paymentsService from "@/services/payments.service";
import type { ContractTermsInput } from "@/validations/contracts.validation";

// 10.000 al 12% anual, 12 cuotas mensuales desde 2027-01-01. `asOf` cae a mitad
// del periodo que vence el 2027-01-01 (15 días de 30/360 desde 2026-12-01).
const AS_OF = new Date("2026-12-16T00:00:00.000Z");

function terms(overrides: Partial<ContractTermsInput> = {}): ContractTermsInput {
  return {
    structure: "AMORTIZED",
    principalAmount: 10_000,
    interestRate: 12,
    dayCountConvention: "THIRTY_360",
    amortizationTermMonths: 12,
    firstPaymentDate: new Date("2027-01-01T00:00:00.000Z"),
    paymentDueDay: 1,
    maturityDate: new Date("2027-12-01T00:00:00.000Z"),
    lateFeeType: "FLAT",
    lateFeeAmount: 25,
    gracePeriodDays: 10,
    allowPrepayment: true,
    ...overrides,
  };
}

async function activateContract(termsOverrides: Partial<ContractTermsInput> = {}) {
  const { lenderUser, lenderCompany } = await createTestLenderCompany();
  const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
  await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);

  const contract = await contractsService.createContract(lenderUser.id, {
    property: { addressLine1: "1 Test St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" },
    terms: terms(termsOverrides),
    borrowerProfileIds: [borrowerProfile.id],
  });
  const termsId = contract.currentTerms!.id;
  const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
  await contractsService.submitContractTerms(lenderUser.id, contract.id, termsId);
  await contractsService.acceptContractTerms(borrowerUser.id, contract.id, termsId, {});
  sendEmailSpy.mockRestore();

  const lender = { userId: lenderUser.id, role: "LENDER" as const, roles: ["LENDER" as const] };
  const borrower = { userId: borrowerUser.id, role: "BORROWER" as const, roles: ["BORROWER" as const] };
  return { contractId: contract.id, lender, borrower };
}

const rowsOf = (contractId: string) => prisma.scheduledPayment.findMany({ where: { contractId }, orderBy: { sequenceNumber: "asc" } });

describe("abono a capital y liquidación anticipada", () => {
  afterAll(resetPhase1Tables);

  it("rechaza abono, liquidación y cotización si el Lender no lo permite en el contrato", async () => {
    const { contractId, lender, borrower } = await activateContract({ allowPrepayment: false });

    for (const call of [
      paymentsService.requestPrepayment(lender, contractId, { amount: 1000, method: "WIRE" }),
      paymentsService.requestPayoff(borrower, contractId, { method: "WIRE" }),
      paymentsService.getPayoffQuote(borrower, contractId, {}),
    ]) {
      const error = await call.catch((e) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("PREPAYMENT_NOT_ALLOWED");
    }
  });

  it("abono del Lender: baja capital, mantiene plazo, rehace cuota e interés de la cuota en curso", async () => {
    const { contractId, lender } = await activateContract();

    const transaction = await paymentsService.requestPrepayment(lender, contractId, { amount: 4000, method: "WIRE", occurredAt: AS_OF });
    expect(transaction.type).toBe("PRINCIPAL_PREPAYMENT");
    expect(transaction.status).toBe("SUCCEEDED");

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.currentPrincipalBalance!.toString()).toBe("6000");

    const rows = await rowsOf(contractId);
    expect(rows).toHaveLength(12);
    // Cuota 1: 15 días sobre 10.000 (50.00) + 15 días sobre 6.000 (30.00).
    expect(rows[0].interestDue.toString()).toBe("80");
    expect(rows[0].totalDue.toString()).toBe(calculateAmortizedPayment(6000, 12, 12).toString());
    expect(rows[1].totalDue.toString()).toBe(calculateAmortizedPayment(6000, 12, 12).toString());
    expect(rows.reduce((sum, r) => sum + r.principalDue.toNumber(), 0)).toBeCloseTo(6000, 2);
    expect(rows[11].projectedRemainingBalance.toString()).toBe("0");

    const terms = await prisma.contractTerms.findFirstOrThrow({ where: { contractId, status: "ACCEPTED" } });
    expect(terms.calculatedMonthlyPayment!.toString()).toBe(calculateAmortizedPayment(6000, 12, 12).toString());
  });

  it("abono por el total del capital se rechaza (hay que liquidar)", async () => {
    const { contractId, lender } = await activateContract();
    const error = await paymentsService.requestPrepayment(lender, contractId, { amount: 10_000, method: "WIRE", occurredAt: AS_OF }).catch((e) => e);
    expect((error as AppError).code).toBe("USE_PAYOFF");
  });

  it("solicitud del Borrower queda PENDING, no mueve saldo; solo el Lender la confirma y la aplica", async () => {
    const { contractId, lender, borrower } = await activateContract();

    const request = await paymentsService.requestPrepayment(borrower, contractId, { amount: 4000, method: "WIRE" });
    expect(request.status).toBe("PENDING");
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).currentPrincipalBalance!.toString()).toBe("10000");

    const denied = await paymentsService.confirmPaymentRequest(borrower, request.id).catch((e) => e);
    expect((denied as AppError).code).toBe("NOT_FOUND");

    const confirmed = await paymentsService.confirmPaymentRequest(lender, request.id);
    expect(confirmed.status).toBe("SUCCEEDED");
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).currentPrincipalBalance!.toString()).toBe("6000");
  });

  it("el Lender puede rechazar la solicitud; no se puede confirmar después", async () => {
    const { contractId, lender, borrower } = await activateContract();
    const request = await paymentsService.requestPayoff(borrower, contractId, { method: "WIRE" });

    const rejected = await paymentsService.rejectPaymentRequest(lender, request.id, { reason: "No recibí el wire" });
    expect(rejected.status).toBe("CANCELLED");

    const again = await paymentsService.confirmPaymentRequest(lender, request.id).catch((e) => e);
    expect((again as AppError).code).toBe("TRANSACTION_NOT_PENDING");
  });

  it("liquidación: cotiza capital + interés devengado a la fecha, cobra, cierra el contrato y anula el calendario", async () => {
    const { contractId, lender } = await activateContract();

    const quote = await paymentsService.getPayoffQuote(lender, contractId, { asOf: AS_OF });
    expect(quote.principal.toString()).toBe("10000");
    expect(quote.accruedInterest.toString()).toBe("50");
    expect(quote.total.toString()).toBe("10050");

    const transaction = await paymentsService.requestPayoff(lender, contractId, { method: "WIRE", occurredAt: AS_OF });
    expect(transaction.type).toBe("PAYOFF_PAYMENT");
    expect(transaction.amount.toString()).toBe("10050");

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("PAID_OFF");
    expect(contract.currentPrincipalBalance!.toString()).toBe("0");
    expect(contract.nextPaymentDueDate).toBeNull();
    expect((await rowsOf(contractId)).every((r) => r.status === "VOIDED")).toBe(true);
  });

  it("no se puede reversar un abono ni una liquidación", async () => {
    const { contractId, lender } = await activateContract();
    const transaction = await paymentsService.requestPrepayment(lender, contractId, { amount: 1000, method: "WIRE", occurredAt: AS_OF });
    const error = await paymentsService.reverseTransaction("ignored", transaction.id, { reason: "x" }).catch((e) => e);
    expect((error as AppError).code).toBe("TRANSACTION_NOT_REVERSIBLE");
  });
});
