import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as contractsService from "@/services/contracts.service";
import * as loanQuotesService from "@/services/loanQuotes.service";
import * as loanRequestsService from "@/services/loanRequests.service";
import type { CreateLoanRequestInput } from "@/validations/loanRequests.validation";
import type { SubmitLoanQuoteInput } from "@/validations/loanQuotes.validation";

function requestPayload(): CreateLoanRequestInput {
  return {
    property: { addressLine1: "9 Rehab Ave", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" },
    projectType: "FIX_AND_FLIP",
    purchasePrice: 150_000,
    rehabAmount: 30_000,
    totalLoanAmountRequested: 160_000,
    requestedClosingDate: new Date("2026-06-01T00:00:00.000Z"),
    visibility: "PUBLIC",
  };
}

function quotePayload(overrides: Partial<SubmitLoanQuoteInput> = {}): SubmitLoanQuoteInput {
  return {
    structure: "AMORTIZED",
    principalAmount: 160_000,
    interestRate: 9.5,
    amortizationTermMonths: 12,
    message: "Happy to fund this one",
    ...overrides,
  };
}

async function publishedLoanRequest(borrowerUserId: string) {
  const loanRequest = await loanRequestsService.createLoanRequest(borrowerUserId, requestPayload());
  return loanRequestsService.publishLoanRequest(borrowerUserId, loanRequest.id);
}

// PB-026/PB-017 (D-S2-21). Contra Postgres real.
describe("loanQuotes.service (Fase 13)", () => {
  afterAll(resetPhase1Tables);

  it("un Lender sin target sobre un LoanRequest PRIVATE recibe 404 al cotizar; PUBLIC sí puede", async () => {
    const { user: borrowerUser } = await createTestBorrower();
    const priv = await loanRequestsService.createLoanRequest(borrowerUser.id, { ...requestPayload(), visibility: "PRIVATE" });
    await loanRequestsService.publishLoanRequest(borrowerUser.id, priv.id);

    const stranger = await createTestLenderCompany();
    const blocked = await loanQuotesService.submitQuote(stranger.lenderUser.id, priv.id, quotePayload()).catch((e) => e);
    expect(blocked).toBeInstanceOf(AppError);
    expect((blocked as AppError).statusCode).toBe(404);

    const pub = await publishedLoanRequest(borrowerUser.id);
    const quote = await loanQuotesService.submitQuote(stranger.lenderUser.id, pub.id, quotePayload());
    expect(quote.status).toBe("SUBMITTED");
  });

  it("reemplaza la propia cotización en la misma fila mientras SUBMITTED (no crea una segunda)", async () => {
    const { user: borrowerUser } = await createTestBorrower();
    const loanRequest = await publishedLoanRequest(borrowerUser.id);
    const lender = await createTestLenderCompany();

    const first = await loanQuotesService.submitQuote(lender.lenderUser.id, loanRequest.id, quotePayload({ interestRate: 9 }));
    const second = await loanQuotesService.submitQuote(lender.lenderUser.id, loanRequest.id, quotePayload({ interestRate: 8.5 }));
    expect(second.id).toBe(first.id);
    expect(second.interestRate.toFixed(2)).toBe("8.50");

    const all = await prisma.loanQuote.count({ where: { loanRequestId: loanRequest.id } });
    expect(all).toBe(1);
  });

  it("BE-045-style multi-empresa: sin lenderCompanyId y 2 empresas -> 400; con una ajena -> 404", async () => {
    const { user: borrowerUser } = await createTestBorrower();
    const loanRequest = await publishedLoanRequest(borrowerUser.id);

    const { lenderUser, lenderProfile } = await createTestLenderCompany();
    const secondCompany = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: "Second Lending Co",
        ein: `ein-2nd-${Date.now()}`,
        addressLine1: "2 St",
        city: "Austin",
        state: "TX",
        postalCode: "78703",
        createdByUserId: lenderUser.id,
      },
    });

    const withoutCompanyId = await loanQuotesService.submitQuote(lenderUser.id, loanRequest.id, quotePayload()).catch((e) => e);
    expect(withoutCompanyId).toBeInstanceOf(AppError);
    expect((withoutCompanyId as AppError).code).toBe("LENDER_COMPANY_REQUIRED");

    const withOwnCompany = await loanQuotesService.submitQuote(lenderUser.id, loanRequest.id, quotePayload({ lenderCompanyId: secondCompany.id }));
    expect(withOwnCompany.lenderCompanyId).toBe(secondCompany.id);
  });

  it("PB-017: el Deudor selecciona una cotización -> crea Contract MARKETPLACE con MARKETPLACE_CONNECTION, declina el resto, backfillea Property.lenderCompanyId", async () => {
    const { user: borrowerUser } = await createTestBorrower();
    const loanRequest = await publishedLoanRequest(borrowerUser.id);

    const lenderA = await createTestLenderCompany();
    const lenderB = await createTestLenderCompany();
    const quoteA = await loanQuotesService.submitQuote(lenderA.lenderUser.id, loanRequest.id, quotePayload({ interestRate: 9 }));
    const quoteB = await loanQuotesService.submitQuote(lenderB.lenderUser.id, loanRequest.id, quotePayload({ interestRate: 11, principalAmount: 200_000 }));

    const received = await loanQuotesService.listReceivedQuotes(borrowerUser.id, loanRequest.id);
    expect(received).toHaveLength(2);

    const { contractId } = await loanQuotesService.selectQuote(borrowerUser.id, loanRequest.id, quoteA.id);

    const contract = await contractsService.getContract({ userId: lenderA.lenderUser.id, role: "LENDER" }, contractId);
    expect(contract.originationSource).toBe("MARKETPLACE");
    expect(contract.loanRequestId).toBe(loanRequest.id);
    expect(contract.lenderCompanyId).toBe(lenderA.lenderCompany.id);
    expect(contract.currentTerms?.principalAmount.toFixed(2)).toBe("160000.00");

    const fees = contract.currentTerms?.feeItems ?? [];
    const marketplaceFee = fees.find((fee) => fee.code === "MARKETPLACE_CONNECTION");
    expect(marketplaceFee).toBeDefined();
    // 1% de 160,000 = 1,600 > mínimo 999.
    expect(marketplaceFee?.computedAmount.toFixed(2)).toBe("1600.00");

    const declinedB = await prisma.loanQuote.findUniqueOrThrow({ where: { id: quoteB.id } });
    expect(declinedB.status).toBe("DECLINED");

    const property = await prisma.property.findUniqueOrThrow({ where: { id: loanRequest.property.id } });
    expect(property.lenderCompanyId).toBe(lenderA.lenderCompany.id);

    const matchedRequest = await loanRequestsService.getOwnLoanRequest(borrowerUser.id, loanRequest.id);
    expect(matchedRequest.status).toBe("MATCHED");
    expect(matchedRequest.matchedLenderCompanyId).toBe(lenderA.lenderCompany.id);

    // D-P5-3 (cierra D-P5-1): seleccionar la cotización debe dejar un
    // LenderBorrower ACTIVE nuevo (única forma de crear el vínculo con
    // BE-045 deshabilitado) y asociar al Borrower como ContractBorrower —
    // sin esto el propio Borrower no podría ver su contrato.
    const link = await prisma.lenderBorrower.findUniqueOrThrow({
      where: { lenderCompanyId_borrowerProfileId: { lenderCompanyId: lenderA.lenderCompany.id, borrowerProfileId: loanRequest.borrowerProfileId } },
    });
    expect(link.status).toBe("ACTIVE");
    expect(link.invitedByUserId).toBe(lenderA.lenderUser.id);

    const contractBorrowers = await prisma.contractBorrower.findMany({ where: { contractId } });
    expect(contractBorrowers).toHaveLength(1);
    expect(contractBorrowers[0].borrowerProfileId).toBe(loanRequest.borrowerProfileId);
    expect(contractBorrowers[0].isPrimary).toBe(true);

    const borrowerContracts = await contractsService.listContracts({ userId: borrowerUser.id, role: "BORROWER" }, { page: 1, pageSize: 20 });
    expect(borrowerContracts.items.map((c) => c.id)).toContain(contractId);

    // Ya SELECTED — un segundo intento de seleccionar (aunque fuera otra
    // cotización) responde 409, cubre la carrera de dos selects casi
    // simultáneos.
    const secondSelect = await loanQuotesService.selectQuote(borrowerUser.id, loanRequest.id, quoteB.id).catch((e) => e);
    expect(secondSelect).toBeInstanceOf(AppError);
  });

  it("D-S2-5: MARKETPLACE_CONNECTION se recalcula (no se congela) en una versión nueva de ContractTerms tras el match", async () => {
    const { user: borrowerUser } = await createTestBorrower();
    const loanRequest = await publishedLoanRequest(borrowerUser.id);
    const lender = await createTestLenderCompany();
    const quote = await loanQuotesService.submitQuote(lender.lenderUser.id, loanRequest.id, quotePayload({ principalAmount: 160_000 }));
    const { contractId } = await loanQuotesService.selectQuote(borrowerUser.id, loanRequest.id, quote.id);

    // BE-060 solo permite proponer una versión nueva si la vigente NO está
    // DRAFT — se fuerza a ACCEPTED acá para aislar la regla de
    // MARKETPLACE_CONNECTION sin correr todo el flujo de aceptación (BE-061).
    const draftContract = await contractsService.getContract({ userId: lender.lenderUser.id, role: "LENDER" }, contractId);
    await prisma.contractTerms.update({ where: { id: draftContract.currentTerms!.id }, data: { status: "ACCEPTED" } });

    const revised = await contractsService.proposeContractTerms(lender.lenderUser.id, contractId, {
      structure: "AMORTIZED",
      principalAmount: 50_000, // por debajo del piso de $999 -> 1% = $500, gana el mínimo
      interestRate: 9,
      dayCountConvention: "THIRTY_360",
      amortizationTermMonths: 12,
      firstPaymentDate: new Date("2026-07-01T00:00:00.000Z"),
      paymentDueDay: 1,
      maturityDate: new Date("2027-06-01T00:00:00.000Z"),
      lateFeeType: "FLAT",
      lateFeeAmount: 50,
      gracePeriodDays: 10,
    });

    const newFees = revised.currentTerms?.feeItems ?? [];
    const newMarketplaceFee = newFees.find((fee) => fee.code === "MARKETPLACE_CONNECTION");
    expect(newMarketplaceFee).toBeDefined();
    expect(newMarketplaceFee?.computedAmount.toFixed(2)).toBe("999.00");
  });
});
