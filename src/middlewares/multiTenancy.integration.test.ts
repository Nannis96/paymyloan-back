import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as createContractRoute } from "@/app/api/contracts/route";
import { GET as getContractRoute, PATCH as patchContractRoute, DELETE as deleteContractRoute } from "@/app/api/contracts/[id]/route";
import { POST as addBorrowerRoute } from "@/app/api/contracts/[id]/borrowers/route";
import { POST as cancelContractRoute } from "@/app/api/contracts/[id]/cancel/route";
import { GET as getScheduleRoute } from "@/app/api/contracts/[id]/schedule/route";
import { GET as getBalanceRoute } from "@/app/api/contracts/[id]/balance/route";
import { GET as listTransactionsRoute } from "@/app/api/contracts/[id]/transactions/route";
import { GET as listTermsRoute, POST as proposeTermsRoute } from "@/app/api/contracts/[id]/terms/route";
import { GET as listFeesRoute, POST as addFeeRoute } from "@/app/api/contracts/[id]/terms/[termsId]/fees/route";
import { GET as getBorrowerByIdRoute } from "@/app/api/lenders/me/borrowers/[id]/route";
import { PATCH as patchCompanyRoute } from "@/app/api/lenders/me/companies/[companyId]/route";
import { GET as getMarketplaceLoanRequestRoute } from "@/app/api/marketplace/loan-requests/[id]/route";
import { POST as createLoanRequestRoute, GET as listOwnLoanRequestsRoute } from "@/app/api/borrowers/me/loan-requests/route";
import { GET as getOwnLoanRequestRoute } from "@/app/api/borrowers/me/loan-requests/[id]/route";
import { signAccessToken } from "@/auth/jwt";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestUserWithTwoFactor, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import * as emailLib from "@/lib/email";
import * as lenderBorrowersService from "@/services/lenderBorrowers.service";

// BE-078 — la suite más importante del backlog de testing (13-backlog.md):
// enumera en un solo lugar, de forma parametrizada, cada endpoint sensible a
// tenant y confirma que un actor de una LenderCompany/BorrowerProfile
// distinta nunca puede leer ni escribir el recurso de otro — siempre 404
// (anti-enumeración, nunca 403, ver requireContractAccess.integration.test.ts
// y 07-autenticacion-y-autorizacion.md §7.5). No hay `withTenantScope`
// (descartado, D-P6-1): la regla vive en `lenderCompanyId` explícito +
// requireContractAccess, y esta suite es la prueba de que ese patrón se
// sostiene consistentemente en cada endpoint, no solo en el middleware.

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function createLenderWithCompany(einPrefix: string) {
  const { user: lenderUser, secret } = await createTestUserWithTwoFactor("LENDER", "LenderClave123!");
  const lenderProfile = await prisma.lenderProfile.create({ data: { userId: lenderUser.id, createdByAdminId: null } });
  const lenderCompany = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lenderProfile.id,
      companyName: `Tenant Co ${einPrefix}-${Date.now()}`,
      ein: `${einPrefix}-${Date.now().toString().slice(-7)}`,
      addressLine1: "1 St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: lenderUser.id,
    },
  });
  return {
    lenderUser,
    secret,
    lenderCompany,
    auth: `Bearer ${await signAccessToken({ sub: lenderUser.id, role: "LENDER" })}`,
  };
}

async function setupContractTenancyProbe() {
  const owner = await createLenderWithCompany("t1");
  const stranger = await createLenderWithCompany("t2");
  const { borrowerProfile: ownerBorrower } = await createTestBorrower();
  await linkBorrowerToLenderCompany(owner.lenderCompany.id, ownerBorrower.id, owner.lenderUser.id);
  const { borrowerProfile: strangerBorrower } = await createTestBorrower();

  const createResponse = await createContractRoute(
    jsonRequest(
      "POST",
      "http://localhost/api/contracts",
      {
        property: { addressLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" },
        terms: {
          structure: "AMORTIZED",
          principalAmount: 10_000,
          interestRate: 6,
          amortizationTermMonths: 6,
          firstPaymentDate: "2026-01-01",
          paymentDueDay: 1,
          maturityDate: "2026-06-01",
          lateFeeType: "FLAT",
          lateFeeAmount: 25,
        },
        borrowerProfileIds: [ownerBorrower.id],
      },
      { authorization: owner.auth },
    ),
  );
  const created = await createResponse.json();
  return {
    owner,
    stranger,
    ownerBorrower,
    strangerBorrower,
    contractId: created.data.id as string,
    termsId: created.data.currentTerms.id as string,
  };
}

describe("BE-078 — aislamiento multi-tenant, parametrizado por endpoint", () => {
  afterAll(resetPhase1Tables);

  const contractProbes: Array<[string, (ctx: Awaited<ReturnType<typeof setupContractTenancyProbe>>) => Promise<Response>]> = [
    ["GET /api/contracts/:id", (ctx) => getContractRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ctx.stranger.auth }), { params: Promise.resolve({ id: ctx.contractId }) })],
    [
      "PATCH /api/contracts/:id",
      (ctx) =>
        patchContractRoute(jsonRequest("PATCH", "http://localhost/x", { property: { city: "Dallas" } }, { authorization: ctx.stranger.auth }), {
          params: Promise.resolve({ id: ctx.contractId }),
        }),
    ],
    [
      "POST /api/contracts/:id/cancel",
      (ctx) =>
        cancelContractRoute(jsonRequest("POST", "http://localhost/x", { reason: "hijack attempt" }, { authorization: ctx.stranger.auth }), {
          params: Promise.resolve({ id: ctx.contractId }),
        }),
    ],
    ["GET /api/contracts/:id/schedule", (ctx) => getScheduleRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ctx.stranger.auth }), { params: Promise.resolve({ id: ctx.contractId }) })],
    ["GET /api/contracts/:id/balance", (ctx) => getBalanceRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ctx.stranger.auth }), { params: Promise.resolve({ id: ctx.contractId }) })],
    [
      "GET /api/contracts/:id/transactions",
      (ctx) => listTransactionsRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ctx.stranger.auth }), { params: Promise.resolve({ id: ctx.contractId }) }),
    ],
    ["GET /api/contracts/:id/terms", (ctx) => listTermsRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ctx.stranger.auth }), { params: Promise.resolve({ id: ctx.contractId }) })],
    [
      "POST /api/contracts/:id/terms",
      (ctx) =>
        proposeTermsRoute(
          jsonRequest(
            "POST",
            "http://localhost/x",
            { structure: "AMORTIZED", principalAmount: 5_000, interestRate: 5, amortizationTermMonths: 3, firstPaymentDate: "2026-01-01", paymentDueDay: 1, maturityDate: "2026-03-01", lateFeeType: "FLAT", lateFeeAmount: 10 },
            { authorization: ctx.stranger.auth },
          ),
          { params: Promise.resolve({ id: ctx.contractId }) },
        ),
    ],
    [
      "GET /api/contracts/:id/terms/:termsId/fees",
      (ctx) => listFeesRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ctx.stranger.auth }), { params: Promise.resolve({ id: ctx.contractId, termsId: ctx.termsId }) }),
    ],
    [
      "POST /api/contracts/:id/terms/:termsId/fees",
      (ctx) =>
        addFeeRoute(jsonRequest("POST", "http://localhost/x", { category: "LENDER", code: "PROCESSING", amountType: "FLAT", amountValue: 50 }, { authorization: ctx.stranger.auth }), {
          params: Promise.resolve({ id: ctx.contractId, termsId: ctx.termsId }),
        }),
    ],
    [
      "POST /api/contracts/:id/borrowers (con un borrower propio del stranger)",
      (ctx) =>
        addBorrowerRoute(jsonRequest("POST", "http://localhost/x", { borrowerProfileId: ctx.strangerBorrower.id }, { authorization: ctx.stranger.auth }), {
          params: Promise.resolve({ id: ctx.contractId }),
        }),
    ],
  ];

  it.each(contractProbes)("%s responde 404 (no 403) para un Lender de otra empresa", async (_label, call) => {
    const ctx = await setupContractTenancyProbe();
    const response = await call(ctx);
    expect(response.status).toBe(404);
  });

  it("DELETE /api/contracts/:id responde 404 para un Lender de otra empresa, y el contrato sigue existiendo", async () => {
    const ctx = await setupContractTenancyProbe();
    const response = await deleteContractRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: ctx.stranger.auth }), {
      params: Promise.resolve({ id: ctx.contractId }),
    });
    expect(response.status).toBe(404);

    const stillThere = await getContractRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ctx.owner.auth }), { params: Promise.resolve({ id: ctx.contractId }) });
    expect(stillThere.status).toBe(200);
  });

  it("GET /api/lenders/me/borrowers/:id: un deudor de otra empresa responde 404", async () => {
    const owner = await createLenderWithCompany("t3");
    const stranger = await createLenderWithCompany("t4");
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(owner.lenderUser.id, { name: "Tenancy Probe Borrower", email: `tenancy-probe-${Date.now()}@test.local` });
    sendEmailSpy.mockRestore();

    const response = await getBorrowerByIdRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: stranger.auth }), {
      params: Promise.resolve({ id: created.borrower.id }),
    });
    expect(response.status).toBe(404);
  });

  it("PATCH /api/lenders/me/companies/:companyId: editar una empresa de otro Lender responde 404", async () => {
    const owner = await createLenderWithCompany("t5");
    const stranger = await createLenderWithCompany("t6");

    const response = await patchCompanyRoute(
      jsonRequest("PATCH", "http://localhost/x", { companyName: "Hijacked" }, { authorization: stranger.auth }),
      { params: Promise.resolve({ companyId: owner.lenderCompany.id }) },
    );
    expect(response.status).toBe(404);
  });

  it("GET /api/borrowers/me/loan-requests/:id y GET /api/marketplace/loan-requests/:id: un LoanRequest PRIVATE de otro Deudor/no targeteado responde 404", async () => {
    const { user: ownerBorrowerUser } = await createTestBorrower();
    const ownerAuth = `Bearer ${await signAccessToken({ sub: ownerBorrowerUser.id, role: "BORROWER" })}`;
    const { user: strangerBorrowerUser } = await createTestBorrower();
    const strangerBorrowerAuth = `Bearer ${await signAccessToken({ sub: strangerBorrowerUser.id, role: "BORROWER" })}`;
    const strangerLender = await createLenderWithCompany("t7");

    const createResponse = await createLoanRequestRoute(
      jsonRequest(
        "POST",
        "http://localhost/x",
        {
          property: { addressLine1: "9 Isolated Way", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" },
          projectType: "RENTAL",
          purchasePrice: 200_000,
          rehabAmount: 0,
          totalLoanAmountRequested: 180_000,
          requestedClosingDate: "2026-08-01",
          visibility: "PRIVATE",
        },
        { authorization: ownerAuth },
      ),
    );
    const loanRequestId = (await createResponse.json()).data.id as string;

    const strangerBorrowerResponse = await getOwnLoanRequestRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: strangerBorrowerAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(strangerBorrowerResponse.status).toBe(404);

    const ownList = await listOwnLoanRequestsRoute(jsonRequest("GET", "http://localhost/api/borrowers/me/loan-requests", undefined, { authorization: strangerBorrowerAuth }));
    expect((await ownList.json()).data.items.map((item: { id: string }) => item.id)).not.toContain(loanRequestId);

    const untargetedLenderResponse = await getMarketplaceLoanRequestRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: strangerLender.auth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(untargetedLenderResponse.status).toBe(404);
  });
});
