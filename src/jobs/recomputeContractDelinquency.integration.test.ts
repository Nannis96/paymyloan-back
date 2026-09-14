import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestLenderCompany, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import * as emailLib from "@/lib/email";
import { recomputeContractDelinquencyStatus } from "@/jobs/recomputeContractDelinquency";
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
    lateFeeAmount: 50,
    gracePeriodDays: 10,
  };
}

async function activateContract(lenderUserId: string, lenderCompanyId: string) {
  const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
  await linkBorrowerToLenderCompany(lenderCompanyId, borrowerProfile.id, lenderUserId);
  const contract = await contractsService.createContract(lenderUserId, { property: property(), terms: terms(), borrowerProfileIds: [borrowerProfile.id] });
  const termsId = contract.currentTerms!.id;

  const spy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
  await contractsService.submitContractTerms(lenderUserId, contract.id, termsId);
  await contractsService.acceptContractTerms(borrowerUser.id, contract.id, termsId, {});
  spy.mockRestore();

  return contract.id;
}

// BE-063.
describe("recomputeContractDelinquencyStatus (BE-063)", () => {
  afterAll(resetPhase1Tables);

  it("marca DELINQUENT un contrato ACTIVE con una cuota vencida más allá del gracePeriodDays, y lo regresa a ACTIVE cuando ya no la tiene", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const contractId = await activateContract(lenderUser.id, lenderCompany.id);

    // gracePeriodDays=10, primera cuota vence 2026-01-01 -> "hoy" muy
    // posterior la deja en mora.
    const asOf = new Date("2026-03-01T00:00:00.000Z");
    const result = await recomputeContractDelinquencyStatus(asOf);
    expect(result.markedDelinquent).toBeGreaterThanOrEqual(1);

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("DELINQUENT");

    const auditRow = await prisma.auditLog.findFirst({ where: { action: "CONTRACT_MARKED_DELINQUENT", contractId } });
    expect(auditRow).not.toBeNull();

    // Se ponen al día todas las cuotas vencidas a esta fecha -> ya no hay mora.
    await prisma.scheduledPayment.updateMany({ where: { contractId, status: "PENDING", dueDate: { lte: asOf } }, data: { status: "PAID" } });

    const resolved = await recomputeContractDelinquencyStatus(asOf);
    expect(resolved.resolvedToActive).toBeGreaterThanOrEqual(1);
    const backToActive = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(backToActive.status).toBe("ACTIVE");
  });
});
