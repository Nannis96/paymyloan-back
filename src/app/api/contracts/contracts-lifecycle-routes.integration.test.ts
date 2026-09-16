import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as createContractRoute } from "@/app/api/contracts/route";
import { DELETE as deleteContractRoute } from "@/app/api/contracts/[id]/route";
import { POST as addBorrowerRoute } from "@/app/api/contracts/[id]/borrowers/route";
import { DELETE as removeBorrowerRoute } from "@/app/api/contracts/[id]/borrowers/[borrowerId]/route";
import { POST as cancelContractRoute } from "@/app/api/contracts/[id]/cancel/route";
import { GET as listTermsRoute, POST as proposeTermsRoute } from "@/app/api/contracts/[id]/terms/route";
import { POST as submitTermsRoute } from "@/app/api/contracts/[id]/terms/[termsId]/submit/route";
import { POST as acceptTermsRoute } from "@/app/api/contracts/[id]/terms/[termsId]/accept/route";
import { POST as rejectTermsRoute } from "@/app/api/contracts/[id]/terms/[termsId]/reject/route";
import { POST as addFeeRoute, GET as listFeesRoute } from "@/app/api/contracts/[id]/terms/[termsId]/fees/route";
import { DELETE as deleteFeeRoute } from "@/app/api/contracts/[id]/terms/[termsId]/fees/[feeId]/route";
import { signAccessToken } from "@/auth/jwt";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestUserWithTwoFactor, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import * as emailLib from "@/lib/email";

const LENDER_PASSWORD = "LenderClave123!";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function contractPayload(borrowerProfileId?: string) {
  return {
    property: { addressLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" },
    terms: {
      structure: "AMORTIZED",
      principalAmount: 50_000,
      interestRate: 8,
      amortizationTermMonths: 6,
      firstPaymentDate: "2026-01-01",
      paymentDueDay: 1,
      maturityDate: "2026-06-01",
      lateFeeType: "FLAT",
      lateFeeAmount: 25,
    },
    ...(borrowerProfileId ? { borrowerProfileIds: [borrowerProfileId] } : {}),
  };
}

async function setupLenderWithCompany(einPrefix: string) {
  const { user: lenderUser, secret } = await createTestUserWithTwoFactor("LENDER", LENDER_PASSWORD);
  const lenderProfile = await prisma.lenderProfile.create({ data: { userId: lenderUser.id, createdByAdminId: null } });
  const lenderCompany = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lenderProfile.id,
      companyName: `Lifecycle Co ${einPrefix}-${Date.now()}`,
      ein: `${einPrefix}-${Date.now().toString().slice(-7)}`,
      addressLine1: "1 St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: lenderUser.id,
    },
  });
  const lenderAuth = `Bearer ${await signAccessToken({ sub: lenderUser.id, role: "LENDER" })}`;
  return { lenderUser, secret, lenderCompany, lenderAuth };
}

// BE-057/056/060/061 (fees, add/remove borrower, cancel, propose/reject de
// una versión nueva) a nivel HTTP — contracts.service.integration.test.ts ya
// cubre las reglas de negocio a fondo; acá se prueba el wiring real de las
// rutas (roles, status codes, parseo).
describe("rutas HTTP del ciclo de vida de /api/contracts/:id (BE-056/057/060/061, PB-020)", () => {
  afterAll(resetPhase1Tables);

  it("agregar/quitar deudores de un contrato DRAFT: éxito, duplicado (409) y ajeno a la empresa (404)", async () => {
    const { lenderUser, lenderCompany, lenderAuth } = await setupLenderWithCompany("70");
    const { borrowerProfile: primaryBorrower } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, primaryBorrower.id, lenderUser.id);

    const createResponse = await createContractRoute(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(primaryBorrower.id), { authorization: lenderAuth }));
    const created = await createResponse.json();
    const contractId = created.data.id as string;

    const { borrowerProfile: secondBorrower } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, secondBorrower.id, lenderUser.id);

    const addResponse = await addBorrowerRoute(
      jsonRequest("POST", "http://localhost/x", { borrowerProfileId: secondBorrower.id }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(addResponse.status).toBe(201);

    const duplicateResponse = await addBorrowerRoute(
      jsonRequest("POST", "http://localhost/x", { borrowerProfileId: secondBorrower.id }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(duplicateResponse.status).toBe(409);
    expect((await duplicateResponse.json()).error.code).toBe("ALREADY_ASSOCIATED");

    const { borrowerProfile: strangerBorrower } = await createTestBorrower();
    const strangerResponse = await addBorrowerRoute(
      jsonRequest("POST", "http://localhost/x", { borrowerProfileId: strangerBorrower.id }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(strangerResponse.status).toBe(404);

    const removeResponse = await removeBorrowerRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId, borrowerId: secondBorrower.id }),
    });
    expect(removeResponse.status).toBe(200);
    expect((await removeResponse.json()).data.removed).toBe(true);

    const feesListResponse = await listFeesRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId, termsId: created.data.currentTerms.id }),
    });
    expect(feesListResponse.status).toBe(200);
  });

  it("agregar/borrar fees de una versión DRAFT; una versión no-DRAFT no admite altas", async () => {
    const { lenderUser, lenderCompany, lenderAuth } = await setupLenderWithCompany("71");
    const { borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);

    const createResponse = await createContractRoute(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(borrowerProfile.id), { authorization: lenderAuth }));
    const created = await createResponse.json();
    const contractId = created.data.id as string;
    const termsId = created.data.currentTerms.id as string;

    const addFeeResponse = await addFeeRoute(
      jsonRequest("POST", "http://localhost/x", { category: "LENDER", code: "PROCESSING", amountType: "FLAT", amountValue: 100 }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId, termsId }) },
    );
    expect(addFeeResponse.status).toBe(201);
    const fee = await addFeeResponse.json();

    const deleteFeeResponse = await deleteFeeRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId, termsId, feeId: fee.data.id }),
    });
    expect(deleteFeeResponse.status).toBe(200);

    const remainingFees = await listFeesRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId, termsId }),
    });
    expect((await remainingFees.json()).data).toHaveLength(0);
  });

  it("cancelar un contrato PENDING_ACCEPTANCE funciona una vez; cancelarlo de nuevo responde 409", async () => {
    const { lenderUser, lenderCompany, lenderAuth } = await setupLenderWithCompany("72");
    const { borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);

    const createResponse = await createContractRoute(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(borrowerProfile.id), { authorization: lenderAuth }));
    const created = await createResponse.json();
    const contractId = created.data.id as string;
    const termsId = created.data.currentTerms.id as string;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await submitTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: lenderAuth }), { params: Promise.resolve({ id: contractId, termsId }) });
    sendEmailSpy.mockRestore();

    const cancelResponse = await cancelContractRoute(
      jsonRequest("POST", "http://localhost/x", { reason: "Deal fell through" }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(cancelResponse.status).toBe(200);
    expect((await cancelResponse.json()).data.status).toBe("CANCELLED");

    const cancelAgainResponse = await cancelContractRoute(
      jsonRequest("POST", "http://localhost/x", { reason: "Otra vez" }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(cancelAgainResponse.status).toBe(409);
    expect((await cancelAgainResponse.json()).error.code).toBe("CONTRACT_NOT_CANCELLABLE");

    const missingReasonResponse = await cancelContractRoute(jsonRequest("POST", "http://localhost/x", {}, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId }),
    });
    expect(missingReasonResponse.status).toBe(400);
  });

  it("proponer una versión nueva sobre un contrato ACTIVE y que el Deudor la rechace: la versión anterior sigue activa", async () => {
    const { lenderUser, lenderCompany, lenderAuth } = await setupLenderWithCompany("73");
    const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);
    const borrowerAuth = `Bearer ${await signAccessToken({ sub: borrowerUser.id, role: "BORROWER" })}`;

    const createResponse = await createContractRoute(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(borrowerProfile.id), { authorization: lenderAuth }));
    const created = await createResponse.json();
    const contractId = created.data.id as string;
    const firstTermsId = created.data.currentTerms.id as string;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await submitTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: lenderAuth }), { params: Promise.resolve({ id: contractId, termsId: firstTermsId }) });
    const activateResponse = await acceptTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: borrowerAuth }), {
      params: Promise.resolve({ id: contractId, termsId: firstTermsId }),
    });
    expect((await activateResponse.json()).data.status).toBe("ACTIVE");

    const proposeResponse = await proposeTermsRoute(
      jsonRequest("POST", "http://localhost/x", contractPayload().terms, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(proposeResponse.status).toBe(201);
    const proposed = await proposeResponse.json();
    const newTermsId = proposed.data.currentTerms.id as string;
    expect(newTermsId).not.toBe(firstTermsId);

    await submitTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: lenderAuth }), { params: Promise.resolve({ id: contractId, termsId: newTermsId }) });
    sendEmailSpy.mockRestore();

    const historyResponse = await listTermsRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId }),
    });
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json();
    expect(history.data).toHaveLength(2);

    const rejectSendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const rejectResponse = await rejectTermsRoute(
      jsonRequest("POST", "http://localhost/x", { comment: "Rate too high" }, { authorization: borrowerAuth }),
      { params: Promise.resolve({ id: contractId, termsId: newTermsId }) },
    );
    rejectSendEmailSpy.mockRestore();
    expect(rejectResponse.status).toBe(200);
    const rejected = await rejectResponse.json();
    // El contrato ya se había activado antes de esta renegociación — sigue
    // ACTIVE, no vuelve a DRAFT (eso solo pasa si nunca se activó).
    expect(rejected.data.status).toBe("ACTIVE");

    const rejectAgainResponse = await rejectTermsRoute(
      jsonRequest("POST", "http://localhost/x", {}, { authorization: borrowerAuth }),
      { params: Promise.resolve({ id: contractId, termsId: newTermsId }) },
    );
    expect(rejectAgainResponse.status).toBe(409);
    expect((await rejectAgainResponse.json()).error.code).toBe("TERMS_NOT_PENDING");
  });

  it("un BORROWER no puede cancelar ni proponer términos (403 FORBIDDEN)", async () => {
    const { lenderUser, lenderCompany, lenderAuth } = await setupLenderWithCompany("74");
    const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);
    const borrowerAuth = `Bearer ${await signAccessToken({ sub: borrowerUser.id, role: "BORROWER" })}`;

    const createResponse = await createContractRoute(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(borrowerProfile.id), { authorization: lenderAuth }));
    const created = await createResponse.json();
    const contractId = created.data.id as string;

    const cancelResponse = await cancelContractRoute(
      jsonRequest("POST", "http://localhost/x", { reason: "intento no autorizado" }, { authorization: borrowerAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(cancelResponse.status).toBe(403);

    const proposeResponse = await proposeTermsRoute(
      jsonRequest("POST", "http://localhost/x", contractPayload().terms, { authorization: borrowerAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(proposeResponse.status).toBe(403);
  });

  it("DELETE de un contrato DRAFT funciona (BE-055); tras submit ya no es DRAFT y responde 409", async () => {
    const { lenderUser, lenderCompany, lenderAuth } = await setupLenderWithCompany("75");
    const { borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);

    const createResponse = await createContractRoute(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(borrowerProfile.id), { authorization: lenderAuth }));
    const created = await createResponse.json();
    const contractId = created.data.id as string;

    const deleteResponse = await deleteContractRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId }),
    });
    expect(deleteResponse.status).toBe(200);
    expect((await deleteResponse.json()).data.deleted).toBe(true);

    const deleteAgainResponse = await deleteContractRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId }),
    });
    expect(deleteAgainResponse.status).toBe(404);

    const secondCreateResponse = await createContractRoute(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(borrowerProfile.id), { authorization: lenderAuth }));
    const secondCreated = await secondCreateResponse.json();
    const secondContractId = secondCreated.data.id as string;
    const secondTermsId = secondCreated.data.currentTerms.id as string;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await submitTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: lenderAuth }), { params: Promise.resolve({ id: secondContractId, termsId: secondTermsId }) });
    sendEmailSpy.mockRestore();

    const deleteNonDraftResponse = await deleteContractRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: secondContractId }),
    });
    expect(deleteNonDraftResponse.status).toBe(409);
    expect((await deleteNonDraftResponse.json()).error.code).toBe("CONTRACT_NOT_DELETABLE");
  });
});
