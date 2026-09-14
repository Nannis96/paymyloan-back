import { afterAll, describe, expect, it } from "vitest";
import { POST as createLoanRequestRoute } from "@/app/api/borrowers/me/loan-requests/route";
import { POST as publishRoute } from "@/app/api/borrowers/me/loan-requests/[id]/publish/route";
import { POST as addTargetRoute } from "@/app/api/borrowers/me/loan-requests/[id]/targets/route";
import { GET as listReceivedQuotesRoute } from "@/app/api/borrowers/me/loan-requests/[id]/quotes/route";
import { POST as selectQuoteRoute } from "@/app/api/borrowers/me/loan-requests/[id]/quotes/[quoteId]/select/route";
import { GET as marketplaceListRoute } from "@/app/api/marketplace/loan-requests/route";
import { POST as submitQuoteRoute } from "@/app/api/marketplace/loan-requests/[id]/quotes/route";
import { GET as getContractRoute } from "@/app/api/contracts/[id]/route";
import { signAccessToken } from "@/auth/jwt";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestUserWithTwoFactor, resetPhase1Tables } from "@/db/testFixtures";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createTestLenderCompanyWithTwoFactor(einPrefix: string) {
  const { user: lenderUser } = await createTestUserWithTwoFactor("LENDER", "LenderClave123!");
  const lenderProfile = await prisma.lenderProfile.create({ data: { userId: lenderUser.id, createdByAdminId: null } });
  const lenderCompany = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lenderProfile.id,
      companyName: `Marketplace Co ${einPrefix}-${Date.now()}`,
      ein: `${einPrefix}-${Date.now().toString().slice(-7)}`,
      addressLine1: "1 St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: lenderUser.id,
    },
  });
  return { lenderUser, lenderCompany };
}

// PB-011/PB-026/PB-017 (Fase 13) — rutas HTTP end to end.
describe("rutas HTTP de marketplace / loan-requests (Fase 13)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: publica -> targetea un Lender -> cotiza -> Deudor compara y selecciona -> Contract MARKETPLACE", async () => {
    const { user: borrowerUser } = await createTestBorrower();
    const borrowerAuth = `Bearer ${await signAccessToken({ sub: borrowerUser.id, role: "BORROWER" })}`;

    const createResponse = await createLoanRequestRoute(
      jsonRequest(
        "POST",
        "http://localhost/api/borrowers/me/loan-requests",
        {
          property: { addressLine1: "12 Duplex Rd", city: "Austin", state: "TX", postalCode: "78701", propertyType: "MULTI_FAMILY" },
          projectType: "RENTAL",
          purchasePrice: 300_000,
          rehabAmount: 20_000,
          totalLoanAmountRequested: 280_000,
          requestedClosingDate: "2026-08-01",
          visibility: "PRIVATE",
        },
        { authorization: borrowerAuth },
      ),
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    const loanRequestId = created.data.id as string;

    const { lenderUser, lenderCompany } = await createTestLenderCompanyWithTwoFactor("91");
    const lenderAuth = `Bearer ${await signAccessToken({ sub: lenderUser.id, role: "LENDER" })}`;

    const targetResponse = await addTargetRoute(
      jsonRequest("POST", "http://localhost/x", { lenderCompanyId: lenderCompany.id }, { authorization: borrowerAuth }),
      { params: Promise.resolve({ id: loanRequestId }) },
    );
    expect(targetResponse.status).toBe(201);

    const publishResponse = await publishRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: borrowerAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(publishResponse.status).toBe(200);

    const marketplaceListResponse = await marketplaceListRoute(jsonRequest("GET", "http://localhost/api/marketplace/loan-requests", undefined, { authorization: lenderAuth }));
    expect(marketplaceListResponse.status).toBe(200);
    const marketplaceList = await marketplaceListResponse.json();
    expect(marketplaceList.data.items.map((item: { id: string }) => item.id)).toContain(loanRequestId);

    const quoteResponse = await submitQuoteRoute(
      jsonRequest(
        "POST",
        "http://localhost/x",
        { structure: "AMORTIZED", principalAmount: 280_000, interestRate: 9, amortizationTermMonths: 24, message: "We can close in 2 weeks" },
        { authorization: lenderAuth },
      ),
      { params: Promise.resolve({ id: loanRequestId }) },
    );
    expect(quoteResponse.status).toBe(201);
    const quote = await quoteResponse.json();

    const receivedResponse = await listReceivedQuotesRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: borrowerAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(receivedResponse.status).toBe(200);
    const received = await receivedResponse.json();
    expect(received.data).toHaveLength(1);

    const selectResponse = await selectQuoteRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: borrowerAuth }), {
      params: Promise.resolve({ id: loanRequestId, quoteId: quote.data.id }),
    });
    expect(selectResponse.status).toBe(201);
    const selected = await selectResponse.json();
    const contractId = selected.data.contractId as string;

    const contractResponse = await getContractRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId }),
    });
    expect(contractResponse.status).toBe(200);
    const contract = await contractResponse.json();
    expect(contract.data.originationSource).toBe("MARKETPLACE");
    expect(contract.data.loanRequestId).toBe(loanRequestId);
  });
});
