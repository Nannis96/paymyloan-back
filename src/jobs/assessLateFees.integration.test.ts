import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestLenderCompany, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import * as emailLib from "@/lib/email";
import { assessLateFee } from "@/jobs/assessLateFees";
import * as contractsService from "@/services/contracts.service";
import type { ContractTermsInput, PropertyInput } from "@/validations/contracts.validation";

function property(): PropertyInput {
  return { addressLine1: "1 Test St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" };
}

function terms(): ContractTermsInput {
  return {
    structure: "AMORTIZED",
    principalAmount: 12_000,
    interestRate: 6,
    dayCountConvention: "THIRTY_360",
    amortizationTermMonths: 12,
    firstPaymentDate: new Date("2026-01-01T00:00:00.000Z"),
    paymentDueDay: 1,
    maturityDate: new Date("2026-12-01T00:00:00.000Z"),
    lateFeeType: "FLAT",
    lateFeeAmount: 75,
    gracePeriodDays: 10,
  };
}

// BE-064.
describe("assessLateFee (BE-064)", () => {
  afterAll(resetPhase1Tables);

  it("aplica el cargo de mora FLAT una sola vez por fila vencida más allá de gracePeriodDays", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);
    const contract = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms(), borrowerProfileIds: [borrowerProfile.id] });
    const termsId = contract.currentTerms!.id;

    const spy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await contractsService.submitContractTerms(lenderUser.id, contract.id, termsId);
    await contractsService.acceptContractTerms(borrowerUser.id, contract.id, termsId, {});
    spy.mockRestore();

    const asOf = new Date("2026-03-01T00:00:00.000Z");
    const first = await assessLateFee(asOf);
    expect(first.assessed).toBeGreaterThanOrEqual(1);

    const firstPayment = await prisma.scheduledPayment.findFirstOrThrow({ where: { contractId: contract.id, sequenceNumber: 1 } });
    expect(firstPayment.lateFeeAssessed.toFixed(2)).toBe("75.00");
    expect(firstPayment.lateFeeAssessedAt).not.toBeNull();

    const auditRow = await prisma.auditLog.findFirst({ where: { action: "LATE_FEE_ASSESSED", contractId: contract.id, entityId: firstPayment.id } });
    expect(auditRow).not.toBeNull();

    // Idempotente: correr de nuevo no vuelve a cobrar la misma fila.
    const second = await assessLateFee(asOf);
    expect(second.assessed).toBe(0);
  });
});
