import { afterAll, describe, expect, it, vi } from "vitest";
import { POST as acceptTermsRoute } from "@/app/api/contracts/[id]/terms/[termsId]/accept/route";
import { POST as submitTermsRoute } from "@/app/api/contracts/[id]/terms/[termsId]/submit/route";
import { GET as getContractRoute } from "@/app/api/contracts/[id]/route";
import { GET as getBalanceRoute } from "@/app/api/contracts/[id]/balance/route";
import { GET as getScheduleRoute } from "@/app/api/contracts/[id]/schedule/route";
import { POST as addFeeRoute } from "@/app/api/contracts/[id]/terms/[termsId]/fees/route";
import { GET, POST } from "@/app/api/contracts/route";
import { signAccessToken } from "@/auth/jwt";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestUserWithTwoFactor, issueAccessTokenFor, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
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
      principalAmount: 100_000,
      interestRate: 6,
      amortizationTermMonths: 12,
      firstPaymentDate: "2026-01-01",
      paymentDueDay: 1,
      maturityDate: "2026-12-01",
      lateFeeType: "FLAT",
      lateFeeAmount: 50,
    },
    ...(borrowerProfileId ? { borrowerProfileIds: [borrowerProfileId] } : {}),
  };
}

async function createTestLenderCompanyWithTwoFactor(einPrefix: string) {
  const { user: lenderUser, secret } = await createTestUserWithTwoFactor("LENDER", LENDER_PASSWORD);
  const lenderProfile = await prisma.lenderProfile.create({ data: { userId: lenderUser.id, createdByAdminId: null } });
  const lenderCompany = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lenderProfile.id,
      companyName: `HTTP Contracts Co ${einPrefix}-${Date.now()}`,
      ein: `${einPrefix}-${Date.now().toString().slice(-7)}`,
      addressLine1: "1 St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: lenderUser.id,
    },
  });
  return { lenderUser, secret, lenderCompany };
}

// BE-051..064, PB-020 (Fase 6) — rutas HTTP end to end.
describe("rutas HTTP de /api/contracts (Fase 6)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: crear -> fee -> submit -> accept -> ACTIVE -> schedule/balance visibles", async () => {
    const { lenderUser, secret, lenderCompany } = await createTestLenderCompanyWithTwoFactor("88");
    const lenderAuth = `Bearer ${await issueAccessTokenFor(lenderUser, LENDER_PASSWORD, secret)}`;

    const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);
    const borrowerAuth = `Bearer ${await signAccessToken({ sub: borrowerUser.id, role: "BORROWER" })}`;

    const createResponse = await POST(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(borrowerProfile.id), { authorization: lenderAuth }));
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    const contractId = created.data.id as string;
    const termsId = created.data.currentTerms.id as string;
    expect(created.data.status).toBe("DRAFT");

    const listResponse = await GET(jsonRequest("GET", "http://localhost/api/contracts", undefined, { authorization: lenderAuth }));
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.data.total).toBe(1);

    const feeResponse = await addFeeRoute(
      jsonRequest("POST", "http://localhost/x", { category: "LENDER", code: "PROCESSING", amountType: "FLAT", amountValue: 250 }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId, termsId }) },
    );
    expect(feeResponse.status).toBe(201);

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const submitResponse = await submitTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId, termsId }),
    });
    expect(submitResponse.status).toBe(200);
    const submitted = await submitResponse.json();
    expect(submitted.data.status).toBe("PENDING_ACCEPTANCE");

    const acceptResponse = await acceptTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: borrowerAuth }), {
      params: Promise.resolve({ id: contractId, termsId }),
    });
    sendEmailSpy.mockRestore();
    expect(acceptResponse.status).toBe(200);
    const accepted = await acceptResponse.json();
    expect(accepted.data.status).toBe("ACTIVE");

    const scheduleResponse = await getScheduleRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: contractId }),
    });
    expect(scheduleResponse.status).toBe(200);
    const schedule = await scheduleResponse.json();
    expect(schedule.data).toHaveLength(12);

    const balanceResponse = await getBalanceRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: borrowerAuth }), {
      params: Promise.resolve({ id: contractId }),
    });
    expect(balanceResponse.status).toBe(200);
    const balance = await balanceResponse.json();
    expect(balance.data.principalBalance).toBe("100000");
  });

  it("un Lender ajeno recibe 404 al intentar leer un contrato que no es suyo", async () => {
    const owner = await createTestLenderCompanyWithTwoFactor("89");
    const stranger = await createTestLenderCompanyWithTwoFactor("90");

    const ownerAuth = `Bearer ${await signAccessToken({ sub: owner.lenderUser.id, role: "LENDER" })}`;
    const createResponse = await POST(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(), { authorization: ownerAuth }));
    const created = await createResponse.json();

    const strangerAuth = `Bearer ${await issueAccessTokenFor(stranger.lenderUser, LENDER_PASSWORD, stranger.secret)}`;
    const getResponse = await getContractRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: strangerAuth }), {
      params: Promise.resolve({ id: created.data.id }),
    });
    expect(getResponse.status).toBe(404);
  });
});
