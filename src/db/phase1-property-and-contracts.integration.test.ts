import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import {
  createTestBorrower,
  createTestContract,
  createTestLenderCompany,
  createTestProperty,
  resetPhase1Tables,
} from "@/db/testFixtures";

// BE-095 (Property), BE-011 (Contract), BE-012 (ContractTerms + FK circular),
// BE-013 (ContractTermsAcceptance), BE-014 (ContractBorrower) — ver
// Docs/plan/16-fase-1-actualizada.md.
describe("Fase 1 — Property y Contratos", () => {
  afterAll(resetPhase1Tables);

  it("Property se crea con solo dirección + propertyType — todo lo demás es opcional (BE-095, D-P1-5)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);

    expect(property.afterRepairValue).toBeNull();
    expect(property.estimatedMarketValue).toBeNull();
    expect(property.annualPropertyTax).toBeNull();
    expect(property.conditionScale).toBeNull();
  });

  it("Property acepta los campos de valuation/ARV tomados de Owner (BE-095)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await prisma.property.create({
      data: {
        addressLine1: "789 Elm St",
        city: "Austin",
        state: "TX",
        postalCode: "78704",
        propertyType: "SINGLE_FAMILY",
        lenderCompanyId: lenderCompany.id,
        createdByUserId: lenderUser.id,
        squareFootage: 1500,
        yearBuilt: 1985,
        bedrooms: 3,
        bathrooms: 2.5,
        conditionScale: 3,
        estimatedRepairCost: "15000.00",
        estimatedMarketValue: "220000.00",
        afterRepairValue: "260000.00",
        annualPropertyTax: "4400.00",
        annualInsuranceEstimate: "1100.00",
      },
    });

    expect(property.afterRepairValue?.toNumber()).toBe(260000);
    expect(property.bathrooms?.toString()).toBe("2.5");
  });

  it("un Contract requiere propertyId — una propiedad puede tener varios contratos en el tiempo (BE-011, D-P1-5)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);

    const contractA = await createTestContract({
      lenderCompanyId: lenderCompany.id,
      propertyId: property.id,
      createdByUserId: lenderUser.id,
    });
    const contractB = await createTestContract({
      lenderCompanyId: lenderCompany.id,
      propertyId: property.id,
      createdByUserId: lenderUser.id,
    });

    const contractsForProperty = await prisma.contract.findMany({ where: { propertyId: property.id } });
    expect(contractsForProperty.map((c) => c.id).sort()).toEqual([contractA.id, contractB.id].sort());
    expect(contractA.status).toBe("DRAFT");
    expect(contractA.insuranceCompanyId).toBeNull();
  });

  it("contractNumber es único (BE-011)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);

    await prisma.contract.create({
      data: {
        lenderCompanyId: lenderCompany.id,
        propertyId: property.id,
        createdByUserId: lenderUser.id,
        contractNumber: "PML-DUP-0001",
      },
    });

    await expect(
      prisma.contract.create({
        data: {
          lenderCompanyId: lenderCompany.id,
          propertyId: property.id,
          createdByUserId: lenderUser.id,
          contractNumber: "PML-DUP-0001",
        },
      }),
    ).rejects.toThrow();
  });

  it("resuelve la FK circular Contract.currentTermsId <-> ContractTerms.contractId (BE-012)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({
      lenderCompanyId: lenderCompany.id,
      propertyId: property.id,
      createdByUserId: lenderUser.id,
    });

    const terms = await prisma.contractTerms.create({
      data: {
        contractId: contract.id,
        versionNumber: 1,
        structure: "AMORTIZED",
        principalAmount: "150000.00",
        interestRate: "8.125",
        amortizationTermMonths: 360,
        firstPaymentDate: new Date("2026-11-01"),
        paymentDueDay: 1,
        maturityDate: new Date("2027-10-01"),
        lateFeeType: "FLAT",
        lateFeeAmount: "50.00",
        createdByUserId: lenderUser.id,
      },
    });

    const updated = await prisma.contract.update({
      where: { id: contract.id },
      data: { currentTermsId: terms.id },
    });

    expect(updated.currentTermsId).toBe(terms.id);
  });

  it("una versión de términos no se puede duplicar dentro del mismo contrato (BE-012)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({
      lenderCompanyId: lenderCompany.id,
      propertyId: property.id,
      createdByUserId: lenderUser.id,
    });

    const baseTermsData = {
      contractId: contract.id,
      versionNumber: 1,
      structure: "AMORTIZED" as const,
      principalAmount: "150000.00",
      interestRate: "8.125",
      amortizationTermMonths: 360,
      firstPaymentDate: new Date("2026-11-01"),
      paymentDueDay: 1,
      maturityDate: new Date("2027-10-01"),
      lateFeeType: "FLAT" as const,
      lateFeeAmount: "50.00",
      createdByUserId: lenderUser.id,
    };

    await prisma.contractTerms.create({ data: baseTermsData });

    await expect(prisma.contractTerms.create({ data: baseTermsData })).rejects.toThrow();
  });

  it("ContractTermsAcceptance es única por (contractTermsId, borrowerProfileId) e inmutable por convención (BE-013, D0-3)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({
      lenderCompanyId: lenderCompany.id,
      propertyId: property.id,
      createdByUserId: lenderUser.id,
    });
    const terms = await prisma.contractTerms.create({
      data: {
        contractId: contract.id,
        versionNumber: 1,
        structure: "AMORTIZED",
        principalAmount: "150000.00",
        interestRate: "8.125",
        amortizationTermMonths: 360,
        firstPaymentDate: new Date("2026-11-01"),
        paymentDueDay: 1,
        maturityDate: new Date("2027-10-01"),
        lateFeeType: "FLAT",
        lateFeeAmount: "50.00",
        createdByUserId: lenderUser.id,
      },
    });
    const { borrowerProfile } = await createTestBorrower();

    await prisma.contractTermsAcceptance.create({
      data: {
        contractTermsId: terms.id,
        borrowerProfileId: borrowerProfile.id,
        decision: "ACCEPTED",
        decidedAt: new Date(),
      },
    });

    await expect(
      prisma.contractTermsAcceptance.create({
        data: {
          contractTermsId: terms.id,
          borrowerProfileId: borrowerProfile.id,
          decision: "REJECTED",
          decidedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("ContractBorrower usa PK compuesta — no permite asociar dos veces el mismo par (BE-014)", async () => {
    const { lenderCompany, lenderUser } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({
      lenderCompanyId: lenderCompany.id,
      propertyId: property.id,
      createdByUserId: lenderUser.id,
    });
    const { borrowerProfile } = await createTestBorrower();

    await prisma.contractBorrower.create({
      data: { contractId: contract.id, borrowerProfileId: borrowerProfile.id, addedByUserId: lenderUser.id },
    });

    await expect(
      prisma.contractBorrower.create({
        data: { contractId: contract.id, borrowerProfileId: borrowerProfile.id, addedByUserId: lenderUser.id },
      }),
    ).rejects.toThrow();
  });
});
