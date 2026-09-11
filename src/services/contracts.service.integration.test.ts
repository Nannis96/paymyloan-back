import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestLenderCompany, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import { generateAmortizationSchedule } from "@/services/amortization.service";
import * as contractsService from "@/services/contracts.service";
import type { ContractTermsInput, PropertyInput } from "@/validations/contracts.validation";

function property(overrides: Partial<PropertyInput> = {}): PropertyInput {
  return { addressLine1: "1 Test St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY", ...overrides };
}

function terms(overrides: Partial<ContractTermsInput> = {}): ContractTermsInput {
  return {
    structure: "AMORTIZED",
    principalAmount: 200_000,
    interestRate: 6,
    dayCountConvention: "THIRTY_360",
    amortizationTermMonths: 12,
    firstPaymentDate: new Date("2026-01-01T00:00:00.000Z"),
    paymentDueDay: 1,
    // maturityDate es la fecha del último pago (inclusive) — 12 meses de
    // amortizationTermMonths implican 12 filas: dic 2026, no ene 2027.
    maturityDate: new Date("2026-12-01T00:00:00.000Z"),
    lateFeeType: "FLAT",
    lateFeeAmount: 50,
    gracePeriodDays: 10,
    ...overrides,
  };
}

// BE-051..064, PB-020 (Fase 6). Contra Postgres real, nunca mocks (ver plan
// de backend §11).
describe("contracts.service (Fase 6)", () => {
  afterAll(resetPhase1Tables);

  it("BE-051: crea Contract(DRAFT) + ContractTerms v1 DRAFT + Property embebida en una sola llamada", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();

    const contract = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() });

    expect(contract.status).toBe("DRAFT");
    expect(contract.contractNumber).toMatch(/^PML-\d{4}-\d{6}$/);
    expect(contract.currentTerms?.status).toBe("DRAFT");
    expect(contract.currentTerms?.versionNumber).toBe(1);
    expect(contract.property.addressLine1).toBe("1 Test St");
    expect(contract.lenderCompanyId).toBe(lenderCompany.id);
  });

  it("BE-051 (D-P6-1): Lender con 2 LenderCompany sin lenderCompanyId -> 400; con una ajena -> 404", async () => {
    const { lenderUser, lenderProfile } = await createTestLenderCompany();
    await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: "Segunda Empresa",
        ein: `ein-2c-${Date.now()}`,
        addressLine1: "2 St",
        city: "Austin",
        state: "TX",
        postalCode: "78702",
        createdByUserId: lenderUser.id,
      },
    });

    const withoutCompanyId = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() }).catch((e) => e);
    expect(withoutCompanyId).toBeInstanceOf(AppError);
    expect((withoutCompanyId as AppError).code).toBe("LENDER_COMPANY_REQUIRED");

    const stranger = await createTestLenderCompany();
    const foreign = await contractsService
      .createContract(lenderUser.id, { property: property(), terms: terms(), lenderCompanyId: stranger.lenderCompany.id })
      .catch((e) => e);
    expect(foreign).toBeInstanceOf(AppError);
    expect((foreign as AppError).statusCode).toBe(404);
  });

  it("BE-055: DELETE solo permitido en DRAFT; BE-056: cancel solo en PENDING_ACCEPTANCE/ACTIVE/DELINQUENT", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const contract = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() });

    await contractsService.deleteContract(lenderUser.id, contract.id);
    const deleted = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(deleted.deletedAt).not.toBeNull();

    const second = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() });
    const cancelOnDraft = await contractsService.cancelContract(lenderUser.id, second.id, { reason: "test" }).catch((e) => e);
    expect(cancelOnDraft).toBeInstanceOf(AppError);
    expect((cancelOnDraft as AppError).code).toBe("CONTRACT_NOT_CANCELLABLE");
  });

  it("BE-057: asocia un borrower vinculado a la LenderCompany, 404 si no está vinculado", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const { borrowerProfile } = await createTestBorrower();
    const contract = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() });

    const notLinked = await contractsService.addContractBorrower(lenderUser.id, contract.id, { borrowerProfileId: borrowerProfile.id }).catch((e) => e);
    expect(notLinked).toBeInstanceOf(AppError);
    expect((notLinked as AppError).statusCode).toBe(404);

    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);
    const updated = await contractsService.addContractBorrower(lenderUser.id, contract.id, { borrowerProfileId: borrowerProfile.id });
    expect(updated.borrowers.map((b) => b.borrowerProfileId)).toContain(borrowerProfile.id);

    await contractsService.removeContractBorrower(lenderUser.id, contract.id, borrowerProfile.id);
    const link = await prisma.contractBorrower.findUniqueOrThrow({
      where: { contractId_borrowerProfileId: { contractId: contract.id, borrowerProfileId: borrowerProfile.id } },
    });
    expect(link.removedAt).not.toBeNull();
  });

  it("BE-059/BE-061: 2 co-deudores, 1 acepta y 1 rechaza -> vuelve a DRAFT sin activarse; ambos aceptan -> ACTIVE + calendario cerrado en $0.00 exacto", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const borrowerA = await createTestBorrower();
    const borrowerB = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerA.borrowerProfile.id, lenderUser.id);
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerB.borrowerProfile.id, lenderUser.id);

    const contract = await contractsService.createContract(lenderUser.id, {
      property: property(),
      terms: terms(),
      borrowerProfileIds: [borrowerA.borrowerProfile.id, borrowerB.borrowerProfile.id],
    });
    const termsId = contract.currentTerms!.id;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await contractsService.submitContractTerms(lenderUser.id, contract.id, termsId);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("PENDING_ACCEPTANCE");

    // Ronda 1: A acepta, B rechaza -> ninguno activa, el contrato vuelve a DRAFT.
    await contractsService.acceptContractTerms(borrowerA.user.id, contract.id, termsId, {});
    const afterReject = await contractsService.rejectContractTerms(borrowerB.user.id, contract.id, termsId, { comment: "no me sirve" }, {});
    expect(afterReject.status).toBe("DRAFT");
    expect(afterReject.currentTerms?.status).toBe("REJECTED");
    expect(sendEmailSpy).toHaveBeenCalledWith(expect.objectContaining({ template: "terms-rejected" }));

    // El Lender propone una nueva versión y la reenvía.
    const revised = await contractsService.proposeContractTerms(lenderUser.id, contract.id, terms());
    const newTermsId = revised.currentTerms!.id;
    await contractsService.submitContractTerms(lenderUser.id, contract.id, newTermsId);

    await contractsService.acceptContractTerms(borrowerA.user.id, contract.id, newTermsId, {});
    const activated = await contractsService.acceptContractTerms(borrowerB.user.id, contract.id, newTermsId, {});
    sendEmailSpy.mockRestore();

    expect(activated.status).toBe("ACTIVE");
    expect(activated.currentTerms?.status).toBe("ACCEPTED");
    expect(activated.activatedAt).not.toBeNull();

    const schedule = await contractsService.getSchedule({ userId: lenderUser.id, role: "LENDER" }, contract.id);
    expect(schedule).toHaveLength(12);
    expect(schedule[schedule.length - 1].projectedRemainingBalance.toFixed(2)).toBe("0.00");

    // No se puede generar el calendario dos veces para la misma versión.
    const duplicate = await prisma.$transaction((tx) => generateAmortizationSchedule(tx, newTermsId)).catch((e) => e);
    expect(duplicate).toBeInstanceOf(AppError);
    expect((duplicate as AppError).code).toBe("SCHEDULE_ALREADY_GENERATED");
  });

  it("BE-062: getBalance devuelve el principal vigente tras activarse", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);

    const contract = await contractsService.createContract(lenderUser.id, {
      property: property(),
      terms: terms(),
      borrowerProfileIds: [borrowerProfile.id],
    });
    const termsId = contract.currentTerms!.id;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await contractsService.submitContractTerms(lenderUser.id, contract.id, termsId);
    await contractsService.acceptContractTerms(borrowerUser.id, contract.id, termsId, {});
    sendEmailSpy.mockRestore();

    const balance = await contractsService.getBalance({ userId: lenderUser.id, role: "LENDER" }, contract.id);
    expect(balance.principalBalance.toFixed(2)).toBe("200000.00");
  });

  it("BE-061: un co-deudor no puede decidir dos veces sobre la misma versión mientras el quórum sigue incompleto (409 ALREADY_DECIDED)", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const borrowerA = await createTestBorrower();
    const borrowerB = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerA.borrowerProfile.id, lenderUser.id);
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerB.borrowerProfile.id, lenderUser.id);

    const contract = await contractsService.createContract(lenderUser.id, {
      property: property(),
      terms: terms(),
      borrowerProfileIds: [borrowerA.borrowerProfile.id, borrowerB.borrowerProfile.id],
    });
    const termsId = contract.currentTerms!.id;
    await contractsService.submitContractTerms(lenderUser.id, contract.id, termsId);
    await contractsService.acceptContractTerms(borrowerA.user.id, contract.id, termsId, {});

    // B nunca decidió — el quórum sigue incompleto, la versión sigue
    // PENDING_ACCEPTANCE — así que el segundo intento de A cae en
    // ALREADY_DECIDED, no en TERMS_NOT_PENDING.
    const doubleDecision = await contractsService.acceptContractTerms(borrowerA.user.id, contract.id, termsId, {}).catch((e) => e);
    expect(doubleDecision).toBeInstanceOf(AppError);
    expect((doubleDecision as AppError).code).toBe("ALREADY_DECIDED");
  });
});
