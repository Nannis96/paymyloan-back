import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as contractFeesService from "@/services/contractFees.service";
import * as contractsService from "@/services/contracts.service";
import type { ContractTermsInput, PropertyInput } from "@/validations/contracts.validation";

function property(): PropertyInput {
  return { addressLine1: "1 Test St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" };
}

function terms(): ContractTermsInput {
  return {
    structure: "AMORTIZED",
    principalAmount: 100_000,
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

// PB-020 (D-S2-2). Closing Fee Summary Table.
describe("contractFees.service (PB-020)", () => {
  afterAll(resetPhase1Tables);

  it("agrega fees FLAT y PERCENTAGE y resuelve computedAmount al crear la fila", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const contract = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() });
    const termsId = contract.currentTerms!.id;

    const flatFee = await contractFeesService.addFee(lenderUser.id, contract.id, termsId, {
      category: "LENDER",
      code: "PROCESSING",
      amountType: "FLAT",
      amountValue: 500,
    });
    expect(flatFee.computedAmount.toFixed(2)).toBe("500.00");

    const percentFee = await contractFeesService.addFee(lenderUser.id, contract.id, termsId, {
      category: "LENDER",
      code: "ORIGINATION_POINTS",
      amountType: "PERCENTAGE",
      amountValue: 2,
    });
    // 2% de 100,000 = 2,000.
    expect(percentFee.computedAmount.toFixed(2)).toBe("2000.00");

    const fees = await contractFeesService.listFees({ userId: lenderUser.id, role: "LENDER" }, contract.id, termsId);
    expect(fees).toHaveLength(2);
  });

  it("exige label cuando code=CUSTOM (validado en Zod, no en el service) y rechaza MARKETPLACE_CONNECTION manual", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const contract = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() });
    const termsId = contract.currentTerms!.id;

    const reserved = await contractFeesService
      .addFee(lenderUser.id, contract.id, termsId, { category: "PLATFORM", code: "MARKETPLACE_CONNECTION", amountType: "FLAT", amountValue: 999 })
      .catch((e) => e);
    expect(reserved).toBeInstanceOf(AppError);
    expect((reserved as AppError).code).toBe("RESERVED_FEE_CODE");
  });

  it("bloquea crear/borrar fees fuera de DRAFT (409)", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const contract = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() });
    const termsId = contract.currentTerms!.id;

    const fee = await contractFeesService.addFee(lenderUser.id, contract.id, termsId, {
      category: "LENDER",
      code: "DOC_PREP",
      amountType: "FLAT",
      amountValue: 100,
    });

    // Sin deudores asociados, submit falla antes de llegar a PENDING —
    // forzamos el estado directamente para aislar la regla de fees.
    await prisma.contractTerms.update({ where: { id: termsId }, data: { status: "PENDING_ACCEPTANCE" } });

    const addAfterSubmit = await contractFeesService
      .addFee(lenderUser.id, contract.id, termsId, { category: "LENDER", code: "UNDERWRITING", amountType: "FLAT", amountValue: 10 })
      .catch((e) => e);
    expect(addAfterSubmit).toBeInstanceOf(AppError);
    expect((addAfterSubmit as AppError).code).toBe("TERMS_NOT_EDITABLE");

    const deleteAfterSubmit = await contractFeesService.deleteFee(lenderUser.id, contract.id, termsId, fee.id).catch((e) => e);
    expect(deleteAfterSubmit).toBeInstanceOf(AppError);
    expect((deleteAfterSubmit as AppError).code).toBe("TERMS_NOT_EDITABLE");
  });
});
