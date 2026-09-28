import { afterAll, describe, expect, it } from "vitest";
import { GET as OVERVIEW } from "@/app/api/admin/overview/route";
import { POST as APPROVE } from "@/app/api/admin/verifications/[id]/approve/route";
import { POST as REJECT } from "@/app/api/admin/verifications/[id]/reject/route";
import { GET as LIST } from "@/app/api/admin/verifications/route";
import { GET as BORROWER_GET, POST as BORROWER_POST } from "@/app/api/borrowers/me/verification/route";
import { GET as LENDER_GET, POST as LENDER_POST } from "@/app/api/lenders/me/companies/[companyId]/verification/route";
import { prisma } from "@/db/prisma";
import { createTestUserWithPassword, createTestUserWithTwoFactor, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";

const PASSWORD = "Clave12345!";
let einSequence = 0;

function req(method: string, url: string, authorization: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", authorization },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const entity = (overrides: Record<string, unknown> = {}) => ({
  entityName: "Memphis Realty LLC",
  entityType: "LLC",
  ein: "12-3456789",
  stateOfFormation: "tn",
  signatoryName: "Ana Perez",
  ...overrides,
});

async function admin() {
  const { user, secret } = await createTestUserWithTwoFactor("ADMIN", PASSWORD);
  return `Bearer ${await issueAccessTokenFor(user, PASSWORD, secret)}`;
}

async function lender() {
  const { user, secret } = await createTestUserWithTwoFactor("LENDER", PASSWORD);
  const profile = await prisma.lenderProfile.create({ data: { userId: user.id } });
  einSequence += 1;
  const company = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: profile.id,
      companyName: "Verify Me Lending",
      ein: `77-${String(einSequence).padStart(7, "0")}`,
      addressLine1: "1 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: user.id,
    },
  });
  return { user, company, auth: `Bearer ${await issueAccessTokenFor(user, PASSWORD, secret)}` };
}

async function borrower() {
  const user = await createTestUserWithPassword("BORROWER", PASSWORD);
  await prisma.borrowerProfile.create({ data: { userId: user.id } });
  return { user, auth: `Bearer ${await issueAccessTokenFor(user, PASSWORD)}` };
}

const lenderUrl = (companyId: string) => `http://localhost/api/lenders/me/companies/${companyId}/verification`;
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function overview(adminAuth: string) {
  return (await (await OVERVIEW(req("GET", "http://localhost/api/admin/overview", adminAuth))).json()).data;
}

// AD-003 (Fase 16). Verificación de entidad ("Business") — Postgres real.
describe("verificaciones de entidad (AD-003)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: el Lender envía, el Admin lo ve en la cola y en el panel, aprueba, y ya no se puede reenviar", async () => {
    const adminAuth = await admin();
    const before = await overview(adminAuth);
    const { user, company, auth } = await lender();

    const sent = await LENDER_POST(req("POST", lenderUrl(company.id), auth, entity()), ctx({ companyId: company.id }));
    expect(sent.status).toBe(201);
    const request = (await sent.json()).data;
    expect(request).toMatchObject({ status: "PENDING", stateOfFormation: "TN", lenderCompanyId: company.id, borrowerProfileId: null });

    const latest = await (await LENDER_GET(req("GET", lenderUrl(company.id), auth), ctx({ companyId: company.id }))).json();
    expect(latest.data.id).toBe(request.id);

    const again = await LENDER_POST(req("POST", lenderUrl(company.id), auth, entity()), ctx({ companyId: company.id }));
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("VERIFICATION_PENDING");

    const queue = (await (await LIST(req("GET", "http://localhost/api/admin/verifications?status=PENDING&subject=LENDER", adminAuth))).json()).data;
    const row = queue.items.find((item: { id: string }) => item.id === request.id);
    expect(row.lenderCompany.companyName).toBe("Verify Me Lending");
    expect(row.submittedByUser.id).toBe(user.id);

    const pending = await overview(adminAuth);
    expect(pending.kpis.pendingVerifications - before.kpis.pendingVerifications).toBe(1);
    expect(pending.needsAttention.find((item: { type: string }) => item.type === "VERIFICATIONS_PENDING")).toMatchObject({ severity: "red", entityType: "VerificationRequest" });
    expect(pending.recentSignups.find((signup: { userId: string }) => signup.userId === user.id).verification).toBe("PENDING");

    const approved = await APPROVE(req("POST", "http://localhost/x", adminAuth), ctx({ id: request.id }));
    expect(approved.status).toBe(200);
    expect((await approved.json()).data.status).toBe("APPROVED");

    const done = await overview(adminAuth);
    expect(done.kpis.pendingVerifications).toBe(before.kpis.pendingVerifications);
    expect(done.recentSignups.find((signup: { userId: string }) => signup.userId === user.id).verification).toBe("APPROVED");

    const resend = await LENDER_POST(req("POST", lenderUrl(company.id), auth, entity()), ctx({ companyId: company.id }));
    expect((await resend.json()).error.code).toBe("VERIFICATION_ALREADY_APPROVED");

    const second = await APPROVE(req("POST", "http://localhost/x", adminAuth), ctx({ id: request.id }));
    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe("VERIFICATION_NOT_PENDING");

    expect(await prisma.auditLog.count({ where: { entityId: request.id, action: { in: ["VERIFICATION_SUBMITTED", "VERIFICATION_APPROVED"] } } })).toBe(2);
  });

  it("rechazo: exige motivo, el Deudor lo ve y puede volver a enviar", async () => {
    const adminAuth = await admin();
    const { auth } = await borrower();

    const sent = await BORROWER_POST(req("POST", "http://localhost/api/borrowers/me/verification", auth, entity({ entityType: "TRUST" })));
    expect(sent.status).toBe(201);
    const request = (await sent.json()).data;
    expect(request.borrowerProfileId).not.toBeNull();

    const noReason = await REJECT(req("POST", "http://localhost/x", adminAuth, {}), ctx({ id: request.id }));
    expect(noReason.status).toBe(400);

    const rejected = await REJECT(req("POST", "http://localhost/x", adminAuth, { reason: "EIN does not match the entity name" }), ctx({ id: request.id }));
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).data).toMatchObject({ status: "REJECTED", rejectionReason: "EIN does not match the entity name" });

    const mine = (await (await BORROWER_GET(req("GET", "http://localhost/api/borrowers/me/verification", auth))).json()).data;
    expect(mine).toMatchObject({ status: "REJECTED", rejectionReason: "EIN does not match the entity name" });

    const resend = await BORROWER_POST(req("POST", "http://localhost/api/borrowers/me/verification", auth, entity({ ein: "98-7654321" })));
    expect(resend.status).toBe(201);
    expect((await resend.json()).data.status).toBe("PENDING");
  });

  it("acceso: EIN inválido 400, empresa ajena 404, sin token 401, y solo un ADMIN aprueba", async () => {
    const owner = await lender();
    const stranger = await lender();
    const { auth: borrowerAuth } = await borrower();

    const badEin = await LENDER_POST(req("POST", lenderUrl(owner.company.id), owner.auth, entity({ ein: "123" })), ctx({ companyId: owner.company.id }));
    expect(badEin.status).toBe(400);

    const foreign = await LENDER_POST(req("POST", lenderUrl(owner.company.id), stranger.auth, entity()), ctx({ companyId: owner.company.id }));
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe("LENDER_COMPANY_NOT_FOUND");

    const asBorrower = await LENDER_POST(req("POST", lenderUrl(owner.company.id), borrowerAuth, entity()), ctx({ companyId: owner.company.id }));
    expect(asBorrower.status).toBe(403);

    const sent = await LENDER_POST(req("POST", lenderUrl(owner.company.id), owner.auth, entity()), ctx({ companyId: owner.company.id }));
    const { id } = (await sent.json()).data;

    expect((await LIST(new Request("http://localhost/api/admin/verifications"))).status).toBe(401);
    expect((await LIST(req("GET", "http://localhost/api/admin/verifications", owner.auth))).status).toBe(403);
    expect((await APPROVE(req("POST", "http://localhost/x", owner.auth), ctx({ id }))).status).toBe(403);

    const missing = await APPROVE(req("POST", "http://localhost/x", await admin()), ctx({ id: "00000000-0000-0000-0000-000000000000" }));
    expect(missing.status).toBe(404);
    expect((await missing.json()).error.code).toBe("VERIFICATION_NOT_FOUND");
  });
});
