import { afterAll, describe, expect, it, vi } from "vitest";
import { GET as auditLogsRoute } from "@/app/api/audit-logs/route";
import { GET, PATCH } from "@/app/api/contracts/[id]/route";
import { POST as recordManualPaymentRoute } from "@/app/api/contracts/[id]/payments/manual/route";
import { GET as getScheduleRoute } from "@/app/api/contracts/[id]/schedule/route";
import { POST as acceptTermsRoute } from "@/app/api/contracts/[id]/terms/[termsId]/accept/route";
import { POST as submitTermsRoute } from "@/app/api/contracts/[id]/terms/[termsId]/submit/route";
import { GET as listTransactionsRoute } from "@/app/api/contracts/[id]/transactions/route";
import { POST as createContractRoute } from "@/app/api/contracts/route";
import { GET as getTransactionRoute } from "@/app/api/transactions/[id]/route";
import { POST as reverseTransactionRoute } from "@/app/api/transactions/[id]/reverse/route";
import { signAccessToken } from "@/auth/jwt";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestUserWithTwoFactor, issueAccessTokenFor, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import * as emailLib from "@/lib/email";

const LENDER_PASSWORD = "LenderClave123!";
const ADMIN_PASSWORD = "AdminClave123!";

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
      principalAmount: 10_000,
      interestRate: 12,
      amortizationTermMonths: 3,
      firstPaymentDate: "2026-01-01",
      paymentDueDay: 1,
      maturityDate: "2026-03-01",
      lateFeeType: "FLAT",
      lateFeeAmount: 25,
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
      companyName: `HTTP Payments Co ${einPrefix}-${Date.now()}`,
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

async function activateContractViaHttp(einPrefix: string) {
  const { lenderUser, secret, lenderCompany } = await createTestLenderCompanyWithTwoFactor(einPrefix);
  const lenderAuth = `Bearer ${await issueAccessTokenFor(lenderUser, LENDER_PASSWORD, secret)}`;

  const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
  await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);
  const borrowerAuth = `Bearer ${await signAccessToken({ sub: borrowerUser.id, role: "BORROWER", roles: ["BORROWER"] })}`;

  const createResponse = await createContractRoute(jsonRequest("POST", "http://localhost/api/contracts", contractPayload(borrowerProfile.id), { authorization: lenderAuth }));
  const created = await createResponse.json();
  const contractId = created.data.id as string;
  const termsId = created.data.currentTerms.id as string;

  const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
  await submitTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: lenderAuth }), { params: Promise.resolve({ id: contractId, termsId }) });
  await acceptTermsRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: borrowerAuth }), { params: Promise.resolve({ id: contractId, termsId }) });
  sendEmailSpy.mockRestore();

  const scheduleResponse = await getScheduleRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: lenderAuth }), { params: Promise.resolve({ id: contractId }) });
  const schedule = (await scheduleResponse.json()).data as Array<{ id: string; totalDue: string }>;

  return { lenderUser, lenderAuth, lenderCompany, borrowerUser, borrowerAuth, contractId, schedule };
}

// BE-067/069/071/072 + acceso de Admin a contratos/pagos (Fase 7) — rutas
// HTTP end to end, mismo estilo que contracts-routes.integration.test.ts.
describe("rutas HTTP de pagos y acceso de Admin (Fase 7)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: pago manual -> aparece en transactions -> Admin lo reversa -> vuelve a aparecer pendiente", async () => {
    const { lenderAuth, borrowerAuth, contractId, schedule } = await activateContractViaHttp("f7-1");
    const firstRow = schedule[0];

    const paymentResponse = await recordManualPaymentRoute(
      jsonRequest("POST", "http://localhost/x", { amount: Number(firstRow.totalDue), method: "WIRE", notes: "Wire #1" }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(paymentResponse.status).toBe(201);
    const payment = await paymentResponse.json();
    expect(payment.data.status).toBe("SUCCEEDED");
    const transactionId = payment.data.id as string;

    // El propio deudor puede ver su historial de pagos.
    const listResponse = await listTransactionsRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: borrowerAuth }), {
      params: Promise.resolve({ id: contractId }),
    });
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json();
    expect(list.data.total).toBe(1);

    const getResponse = await getTransactionRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: borrowerAuth }), {
      params: Promise.resolve({ id: transactionId }),
    });
    expect(getResponse.status).toBe(200);

    // Un LENDER no puede reversar.
    const forbiddenReverse = await reverseTransactionRoute(
      jsonRequest("POST", "http://localhost/x", { reason: "no autorizado" }, { authorization: lenderAuth }),
      { params: Promise.resolve({ id: transactionId }) },
    );
    expect(forbiddenReverse.status).toBe(403);

    const { user: adminUser, secret: adminSecret } = await createTestUserWithTwoFactor("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(adminUser, ADMIN_PASSWORD, adminSecret)}`;

    const reverseResponse = await reverseTransactionRoute(
      jsonRequest("POST", "http://localhost/x", { reason: "Wire bounced" }, { authorization: adminAuth }),
      { params: Promise.resolve({ id: transactionId }) },
    );
    expect(reverseResponse.status).toBe(200);
    const reversed = await reverseResponse.json();
    expect(reversed.data.status).toBe("RETURNED");

    // El Admin también puede ver (y editar) el contrato directamente.
    const adminGetResponse = await GET(jsonRequest("GET", "http://localhost/x", undefined, { authorization: adminAuth }), { params: Promise.resolve({ id: contractId }) });
    expect(adminGetResponse.status).toBe(200);

    const adminPatchResponse = await PATCH(
      jsonRequest("PATCH", "http://localhost/x", { property: { city: "Dallas" } }, { authorization: adminAuth }),
      { params: Promise.resolve({ id: contractId }) },
    );
    expect(adminPatchResponse.status).toBe(200);
    const patched = await adminPatchResponse.json();
    expect(patched.data.property.city).toBe("Dallas");

    // Y la auditoría de todo lo anterior queda visible para el Admin.
    const auditResponse = await auditLogsRoute(jsonRequest("GET", `http://localhost/api/audit-logs?contractId=${contractId}`, undefined, { authorization: adminAuth }));
    expect(auditResponse.status).toBe(200);
    const auditBody = await auditResponse.json();
    expect(auditBody.data.items.some((log: { action: string }) => log.action === "TRANSACTION_RETURNED")).toBe(true);
  });

  it("un BORROWER no puede consultar /api/audit-logs (403 FORBIDDEN)", async () => {
    const { borrowerAuth } = await activateContractViaHttp("f7-2");
    const response = await auditLogsRoute(jsonRequest("GET", "http://localhost/api/audit-logs", undefined, { authorization: borrowerAuth }));
    expect(response.status).toBe(403);
  });
});
