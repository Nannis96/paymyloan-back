import { afterAll, describe, expect, it } from "vitest";
import { createTestBorrower, createTestLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as loanRequestsService from "@/services/loanRequests.service";
import type { CreateLoanRequestInput } from "@/validations/loanRequests.validation";

function payload(overrides: Partial<CreateLoanRequestInput> = {}): CreateLoanRequestInput {
  return {
    property: { addressLine1: "1 Flip St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" },
    projectType: "FIX_AND_FLIP",
    purchasePrice: 150_000,
    rehabAmount: 30_000,
    totalLoanAmountRequested: 160_000,
    requestedClosingDate: new Date("2026-06-01T00:00:00.000Z"),
    visibility: "PUBLIC",
    ...overrides,
  };
}

// PB-011 (D-P6-2/D-S2-25, D-S2-22). Contra Postgres real.
describe("loanRequests.service (Fase 13)", () => {
  afterAll(resetPhase1Tables);

  it("crea un LoanRequest(DRAFT) + Property embebida sin LenderCompany todavía", async () => {
    const { user } = await createTestBorrower();
    const loanRequest = await loanRequestsService.createLoanRequest(user.id, payload());

    expect(loanRequest.status).toBe("DRAFT");
    expect(loanRequest.property.addressLine1).toBe("1 Flip St");
    expect(loanRequest.property.lenderCompanyId).toBeNull();
  });

  it("ciclo DRAFT -> PUBLISHED -> WITHDRAWN; edición solo mientras DRAFT", async () => {
    const { user } = await createTestBorrower();
    const loanRequest = await loanRequestsService.createLoanRequest(user.id, payload());

    const published = await loanRequestsService.publishLoanRequest(user.id, loanRequest.id);
    expect(published.status).toBe("PUBLISHED");

    const editAfterPublish = await loanRequestsService.updateLoanRequest(user.id, loanRequest.id, { purchasePrice: 200_000 }).catch((e) => e);
    expect(editAfterPublish).toBeInstanceOf(AppError);
    expect((editAfterPublish as AppError).code).toBe("LOAN_REQUEST_NOT_EDITABLE");

    const withdrawn = await loanRequestsService.withdrawLoanRequest(user.id, loanRequest.id);
    expect(withdrawn.status).toBe("WITHDRAWN");
  });

  it("D-S2-22: agrega/quita varios targets; un LenderCompany ajeno responde 404", async () => {
    const { user } = await createTestBorrower();
    const loanRequest = await loanRequestsService.createLoanRequest(user.id, payload({ visibility: "PRIVATE" }));

    const lenderA = await createTestLenderCompany();
    const lenderB = await createTestLenderCompany();

    const withA = await loanRequestsService.addLoanRequestTarget(user.id, loanRequest.id, { lenderCompanyId: lenderA.lenderCompany.id });
    expect(withA.targets.map((t) => t.lenderCompanyId)).toEqual([lenderA.lenderCompany.id]);

    const withBoth = await loanRequestsService.addLoanRequestTarget(user.id, loanRequest.id, { lenderCompanyId: lenderB.lenderCompany.id });
    expect(withBoth.targets).toHaveLength(2);

    const duplicate = await loanRequestsService.addLoanRequestTarget(user.id, loanRequest.id, { lenderCompanyId: lenderA.lenderCompany.id }).catch((e) => e);
    expect(duplicate).toBeInstanceOf(AppError);
    expect((duplicate as AppError).code).toBe("ALREADY_TARGETED");

    await loanRequestsService.removeLoanRequestTarget(user.id, loanRequest.id, lenderA.lenderCompany.id);
    const afterRemove = await loanRequestsService.getOwnLoanRequest(user.id, loanRequest.id);
    expect(afterRemove.targets.map((t) => t.lenderCompanyId)).toEqual([lenderB.lenderCompany.id]);
  });

  it("regla 17: marketplace PUBLIC enmascara borrowerProfileId/dirección; PRIVATE targeteado se ve completo; PRIVATE no targeteado no aparece", async () => {
    const { user: borrowerUser } = await createTestBorrower();
    const publicRequest = await loanRequestsService.createLoanRequest(borrowerUser.id, payload({ visibility: "PUBLIC" }));
    await loanRequestsService.publishLoanRequest(borrowerUser.id, publicRequest.id);

    const privateRequest = await loanRequestsService.createLoanRequest(borrowerUser.id, payload({ visibility: "PRIVATE" }));
    const targeted = await createTestLenderCompany();
    await loanRequestsService.addLoanRequestTarget(borrowerUser.id, privateRequest.id, { lenderCompanyId: targeted.lenderCompany.id });
    await loanRequestsService.publishLoanRequest(borrowerUser.id, privateRequest.id);

    const stranger = await createTestLenderCompany();

    const publicListing = await loanRequestsService.getMarketplaceLoanRequest(stranger.lenderUser.id, publicRequest.id);
    expect(publicListing.borrowerProfileId).toBeNull();
    expect(publicListing.property.addressLine1).toBe("");

    const privateForTargeted = await loanRequestsService.getMarketplaceLoanRequest(targeted.lenderUser.id, privateRequest.id);
    expect(privateForTargeted.borrowerProfileId).not.toBeNull();
    expect(privateForTargeted.property.addressLine1).toBe("1 Flip St");

    const privateForStranger = await loanRequestsService.getMarketplaceLoanRequest(stranger.lenderUser.id, privateRequest.id).catch((e) => e);
    expect(privateForStranger).toBeInstanceOf(AppError);
    expect((privateForStranger as AppError).statusCode).toBe(404);
  });
});
