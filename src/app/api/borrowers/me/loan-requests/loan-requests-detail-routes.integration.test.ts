import { afterAll, describe, expect, it } from "vitest";
import { GET as listLoanRequestsRoute, POST as createLoanRequestRoute } from "@/app/api/borrowers/me/loan-requests/route";
import { GET as getLoanRequestRoute, PATCH as updateLoanRequestRoute } from "@/app/api/borrowers/me/loan-requests/[id]/route";
import { POST as publishRoute } from "@/app/api/borrowers/me/loan-requests/[id]/publish/route";
import { POST as withdrawRoute } from "@/app/api/borrowers/me/loan-requests/[id]/withdraw/route";
import { POST as addTargetRoute } from "@/app/api/borrowers/me/loan-requests/[id]/targets/route";
import { DELETE as removeTargetRoute } from "@/app/api/borrowers/me/loan-requests/[id]/targets/[lenderCompanyId]/route";
import { GET as getMarketplaceLoanRequestRoute } from "@/app/api/marketplace/loan-requests/[id]/route";
import { POST as submitQuoteRoute, DELETE as withdrawQuoteRoute } from "@/app/api/marketplace/loan-requests/[id]/quotes/route";
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

function loanRequestPayload(visibility: "PUBLIC" | "PRIVATE") {
  return {
    property: { addressLine1: "12 Duplex Rd", city: "Austin", state: "TX", postalCode: "78701", propertyType: "MULTI_FAMILY" },
    projectType: "RENTAL",
    purchasePrice: 300_000,
    rehabAmount: 20_000,
    totalLoanAmountRequested: 280_000,
    requestedClosingDate: "2026-08-01",
    visibility,
  };
}

async function createTestLenderCompany(einPrefix: string) {
  const { user: lenderUser } = await createTestUserWithTwoFactor("LENDER", "LenderClave123!");
  const lenderProfile = await prisma.lenderProfile.create({ data: { userId: lenderUser.id, createdByAdminId: null } });
  const lenderCompany = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lenderProfile.id,
      companyName: `Detail Co ${einPrefix}-${Date.now()}`,
      ein: `${einPrefix}-${Date.now().toString().slice(-7)}`,
      addressLine1: "1 St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: lenderUser.id,
    },
  });
  return { lenderUser, lenderCompany, lenderAuth: `Bearer ${await signAccessToken({ sub: lenderUser.id, role: "LENDER", roles: ["LENDER"] })}` };
}

// PB-011/D-S2-22 a nivel HTTP — loanRequests.service.integration.test.ts ya
// cubre las reglas de negocio; acá se prueba GET/PATCH single, withdraw y
// quitar un target por HTTP, incluyendo el aislamiento entre deudores.
describe("rutas HTTP de detalle de /api/borrowers/me/loan-requests/:id y /api/marketplace/loan-requests/:id", () => {
  afterAll(resetPhase1Tables);

  it("GET/PATCH de un loan request propio funcionan; de uno ajeno responden 404", async () => {
    const { user: ownerUser } = await createTestBorrower();
    const ownerAuth = `Bearer ${await signAccessToken({ sub: ownerUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;

    const createResponse = await createLoanRequestRoute(
      jsonRequest("POST", "http://localhost/api/borrowers/me/loan-requests", loanRequestPayload("PRIVATE"), { authorization: ownerAuth }),
    );
    const created = await createResponse.json();
    const loanRequestId = created.data.id as string;

    const getResponse = await getLoanRequestRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ownerAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(getResponse.status).toBe(200);

    const patchResponse = await updateLoanRequestRoute(
      jsonRequest("PATCH", "http://localhost/x", { purchasePrice: 310_000 }, { authorization: ownerAuth }),
      { params: Promise.resolve({ id: loanRequestId }) },
    );
    expect(patchResponse.status).toBe(200);
    expect((await patchResponse.json()).data.purchasePrice).toBe("310000");

    const { user: strangerUser } = await createTestBorrower();
    const strangerAuth = `Bearer ${await signAccessToken({ sub: strangerUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;

    const strangerGetResponse = await getLoanRequestRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: strangerAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(strangerGetResponse.status).toBe(404);

    const strangerPatchResponse = await updateLoanRequestRoute(
      jsonRequest("PATCH", "http://localhost/x", { purchasePrice: 1 }, { authorization: strangerAuth }),
      { params: Promise.resolve({ id: loanRequestId }) },
    );
    expect(strangerPatchResponse.status).toBe(404);
  });

  it("publicar -> editar responde 409; withdraw funciona una vez y la segunda responde 409", async () => {
    const { user: ownerUser } = await createTestBorrower();
    const ownerAuth = `Bearer ${await signAccessToken({ sub: ownerUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;

    const createResponse = await createLoanRequestRoute(
      jsonRequest("POST", "http://localhost/x", loanRequestPayload("PUBLIC"), { authorization: ownerAuth }),
    );
    const loanRequestId = (await createResponse.json()).data.id as string;

    await publishRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: ownerAuth }), { params: Promise.resolve({ id: loanRequestId }) });

    const patchAfterPublishResponse = await updateLoanRequestRoute(
      jsonRequest("PATCH", "http://localhost/x", { purchasePrice: 400_000 }, { authorization: ownerAuth }),
      { params: Promise.resolve({ id: loanRequestId }) },
    );
    expect(patchAfterPublishResponse.status).toBe(409);
    expect((await patchAfterPublishResponse.json()).error.code).toBe("LOAN_REQUEST_NOT_EDITABLE");

    const withdrawResponse = await withdrawRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: ownerAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(withdrawResponse.status).toBe(200);
    expect((await withdrawResponse.json()).data.status).toBe("WITHDRAWN");

    const withdrawAgainResponse = await withdrawRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: ownerAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(withdrawAgainResponse.status).toBe(409);
    expect((await withdrawAgainResponse.json()).error.code).toBe("LOAN_REQUEST_NOT_PUBLISHED");
  });

  it("agregar y quitar un target por HTTP; un mismo target duplicado responde 409", async () => {
    const { user: ownerUser } = await createTestBorrower();
    const ownerAuth = `Bearer ${await signAccessToken({ sub: ownerUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;
    const { lenderCompany } = await createTestLenderCompany("60");

    const createResponse = await createLoanRequestRoute(
      jsonRequest("POST", "http://localhost/x", loanRequestPayload("PRIVATE"), { authorization: ownerAuth }),
    );
    const loanRequestId = (await createResponse.json()).data.id as string;

    const addResponse = await addTargetRoute(
      jsonRequest("POST", "http://localhost/x", { lenderCompanyId: lenderCompany.id }, { authorization: ownerAuth }),
      { params: Promise.resolve({ id: loanRequestId }) },
    );
    expect(addResponse.status).toBe(201);

    const duplicateResponse = await addTargetRoute(
      jsonRequest("POST", "http://localhost/x", { lenderCompanyId: lenderCompany.id }, { authorization: ownerAuth }),
      { params: Promise.resolve({ id: loanRequestId }) },
    );
    expect(duplicateResponse.status).toBe(409);
    expect((await duplicateResponse.json()).error.code).toBe("ALREADY_TARGETED");

    const removeResponse = await removeTargetRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: ownerAuth }), {
      params: Promise.resolve({ id: loanRequestId, lenderCompanyId: lenderCompany.id }),
    });
    expect(removeResponse.status).toBe(200);
    expect((await removeResponse.json()).data.removed).toBe(true);
  });

  it("GET /api/marketplace/loan-requests/:id: PUBLIC visible a cualquier Lender, PRIVATE solo al targeteado", async () => {
    const { user: ownerUser } = await createTestBorrower();
    const ownerAuth = `Bearer ${await signAccessToken({ sub: ownerUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;
    const { lenderCompany: targetedCompany, lenderUser: targetedLenderUser } = await createTestLenderCompany("61");
    const { lenderUser: outsiderLenderUser } = await createTestLenderCompany("62");
    const outsiderAuth = `Bearer ${await signAccessToken({ sub: outsiderLenderUser.id, role: "LENDER", roles: ["LENDER"] })}`;
    const targetedAuth = `Bearer ${await signAccessToken({ sub: targetedLenderUser.id, role: "LENDER", roles: ["LENDER"] })}`;

    const createResponse = await createLoanRequestRoute(
      jsonRequest("POST", "http://localhost/x", loanRequestPayload("PRIVATE"), { authorization: ownerAuth }),
    );
    const loanRequestId = (await createResponse.json()).data.id as string;
    await addTargetRoute(jsonRequest("POST", "http://localhost/x", { lenderCompanyId: targetedCompany.id }, { authorization: ownerAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    await publishRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: ownerAuth }), { params: Promise.resolve({ id: loanRequestId }) });

    const outsiderResponse = await getMarketplaceLoanRequestRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: outsiderAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(outsiderResponse.status).toBe(404);

    const targetedResponse = await getMarketplaceLoanRequestRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: targetedAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(targetedResponse.status).toBe(200);
  });

  it("un Lender puede retirar su propia cotización (DELETE /api/marketplace/loan-requests/:id/quotes); retirarla de nuevo responde 404", async () => {
    const { user: ownerUser } = await createTestBorrower();
    const ownerAuth = `Bearer ${await signAccessToken({ sub: ownerUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;
    const { lenderAuth } = await createTestLenderCompany("63");

    const createResponse = await createLoanRequestRoute(
      jsonRequest("POST", "http://localhost/x", loanRequestPayload("PUBLIC"), { authorization: ownerAuth }),
    );
    const loanRequestId = (await createResponse.json()).data.id as string;
    await publishRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: ownerAuth }), { params: Promise.resolve({ id: loanRequestId }) });

    const submitResponse = await submitQuoteRoute(
      jsonRequest("POST", "http://localhost/x", { structure: "AMORTIZED", principalAmount: 280_000, interestRate: 9, amortizationTermMonths: 24 }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: loanRequestId }) },
    );
    expect(submitResponse.status).toBe(201);

    const withdrawResponse = await withdrawQuoteRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(withdrawResponse.status).toBe(200);
    expect((await withdrawResponse.json()).data.withdrawn).toBe(true);

    const withdrawAgainResponse = await withdrawQuoteRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: loanRequestId }),
    });
    expect(withdrawAgainResponse.status).toBe(404);
  });

  it("GET /api/borrowers/me/loan-requests lista solo los propios, paginado", async () => {
    const { user: ownerUser } = await createTestBorrower();
    const ownerAuth = `Bearer ${await signAccessToken({ sub: ownerUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;
    await createLoanRequestRoute(jsonRequest("POST", "http://localhost/x", loanRequestPayload("PRIVATE"), { authorization: ownerAuth }));
    await createLoanRequestRoute(jsonRequest("POST", "http://localhost/x", loanRequestPayload("PUBLIC"), { authorization: ownerAuth }));

    const { user: otherUser } = await createTestBorrower();
    const otherAuth = `Bearer ${await signAccessToken({ sub: otherUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;
    await createLoanRequestRoute(jsonRequest("POST", "http://localhost/x", loanRequestPayload("PUBLIC"), { authorization: otherAuth }));

    const listResponse = await listLoanRequestsRoute(jsonRequest("GET", "http://localhost/api/borrowers/me/loan-requests", undefined, { authorization: ownerAuth }));
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.data.total).toBe(2);
  });
});
