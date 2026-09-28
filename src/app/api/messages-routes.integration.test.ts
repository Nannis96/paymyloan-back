import { afterAll, describe, expect, it } from "vitest";
import { POST as SEND_BORROWER } from "@/app/api/borrowers/me/messages/route";
import { GET as BORROWER_THREAD } from "@/app/api/borrowers/me/messages/threads/[lenderCompanyId]/route";
import { POST as BORROWER_READ } from "@/app/api/borrowers/me/messages/threads/[lenderCompanyId]/read/route";
import { GET as BORROWER_THREADS } from "@/app/api/borrowers/me/messages/threads/route";
import { POST as SEND_LENDER } from "@/app/api/lenders/me/messages/route";
import { GET as LENDER_THREAD } from "@/app/api/lenders/me/messages/threads/[borrowerProfileId]/route";
import { POST as LENDER_READ } from "@/app/api/lenders/me/messages/threads/[borrowerProfileId]/read/route";
import { GET as LENDER_THREADS } from "@/app/api/lenders/me/messages/threads/route";
import { prisma } from "@/db/prisma";
import { createTestProperty, createTestUserWithPassword, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";
import * as loanQuotesService from "@/services/loanQuotes.service";
import * as loanRequestsService from "@/services/loanRequests.service";
import type { CreateLoanRequestInput } from "@/validations/loanRequests.validation";

// Fase 17 (PB-027..030). Chat directo Lender <-> Borrower — Postgres real,
// sin mocks. Cubre la regla de elegibilidad (Docs/plan/fases/fase-17-messaging.md)
// y las 8 rutas (send/threads/thread/read por rol).

const PASSWORD = "Clave12345!";
let sequence = 0;

function req(method: string, url: string, authorization?: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function lender() {
  sequence += 1;
  const user = await createTestUserWithPassword("LENDER", PASSWORD);
  const profile = await prisma.lenderProfile.create({ data: { userId: user.id } });
  const company = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: profile.id,
      companyName: `Messaging Lending ${sequence}`,
      ein: `88-${String(sequence).padStart(7, "0")}`,
      addressLine1: "1 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: user.id,
    },
  });
  return { user, profile, company, auth: `Bearer ${await issueAccessTokenFor(user, PASSWORD)}` };
}

async function borrower() {
  const user = await createTestUserWithPassword("BORROWER", PASSWORD);
  const profile = await prisma.borrowerProfile.create({ data: { userId: user.id } });
  return { user, profile, auth: `Bearer ${await issueAccessTokenFor(user, PASSWORD)}` };
}

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

// Habilita el chat vía D3 (LoanQuote SUBMITTED) entre `lenderCompanyId` y `borrowerUserId`.
async function submittedQuoteBetween(lenderUserId: string, lenderCompanyId: string, borrowerUserId: string) {
  const loanRequest = await loanRequestsService.createLoanRequest(borrowerUserId, requestPayload());
  const published = await loanRequestsService.publishLoanRequest(borrowerUserId, loanRequest.id);
  await loanQuotesService.submitQuote(lenderUserId, published.id, {
    structure: "AMORTIZED",
    principalAmount: 160_000,
    interestRate: 9.5,
    amortizationTermMonths: 12,
    lenderCompanyId,
  });
  return published.id;
}

// Habilita el chat vía D2 (Contract fuera de DRAFT) sin pasar por todo el
// flujo de ContractTerms — canMessage solo mira status + ContractBorrower.
async function loanBetween(lenderCompanyId: string, borrowerProfileId: string, createdByUserId: string, status: "PENDING_ACCEPTANCE" | "DRAFT" = "PENDING_ACCEPTANCE") {
  const property = await createTestProperty(lenderCompanyId, createdByUserId);
  return prisma.contract.create({
    data: {
      lenderCompanyId,
      propertyId: property.id,
      createdByUserId,
      contractNumber: `PML-MSG-${Date.now()}-${sequence}`,
      status,
      borrowers: { create: { borrowerProfileId, addedByUserId: createdByUserId } },
    },
  });
}

describe("mensajería Lender <-> Borrower (Fase 17)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: una cotización SUBMITTED habilita el chat en ambos sentidos, aparece en los threads y se puede marcar como leído", async () => {
    const l = await lender();
    const b = await borrower();

    const blocked = await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, body: "hi" }));
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("MESSAGING_NOT_ALLOWED");

    await submittedQuoteBetween(l.user.id, l.company.id, b.user.id);

    const fromBorrower = await SEND_BORROWER(req("POST", "http://localhost/api/borrowers/me/messages", b.auth, { lenderCompanyId: l.company.id, body: "Interested, what's the rate?" }));
    expect(fromBorrower.status).toBe(201);

    const fromLender = await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, body: "9.5% APR, 12 months" }));
    expect(fromLender.status).toBe(201);
    expect((await fromLender.json()).data.senderRole).toBe("LENDER");

    const lenderThreads = (await (await LENDER_THREADS(req("GET", "http://localhost/api/lenders/me/messages/threads", l.auth))).json()).data;
    expect(lenderThreads).toHaveLength(1);
    expect(lenderThreads[0].borrowerProfile.id).toBe(b.profile.id);
    expect(lenderThreads[0].lastMessage.body).toBe("9.5% APR, 12 months");
    expect(lenderThreads[0].unreadCount).toBe(1); // el mensaje del Borrower, todavía sin leer

    const borrowerThreads = (await (await BORROWER_THREADS(req("GET", "http://localhost/api/borrowers/me/messages/threads", b.auth))).json()).data;
    expect(borrowerThreads).toHaveLength(1);
    expect(borrowerThreads[0].lenderCompany.id).toBe(l.company.id);
    expect(borrowerThreads[0].lastMessage.body).toBe("9.5% APR, 12 months");
    expect(borrowerThreads[0].unreadCount).toBe(1); // el mensaje del Lender, todavía sin leer

    const history = (
      await (
        await LENDER_THREAD(req("GET", `http://localhost/api/lenders/me/messages/threads/${b.profile.id}`, l.auth), ctx({ borrowerProfileId: b.profile.id }))
      ).json()
    ).data;
    expect(history.items.map((m: { body: string }) => m.body)).toEqual(["Interested, what's the rate?", "9.5% APR, 12 months"]);

    await LENDER_READ(req("POST", `http://localhost/api/lenders/me/messages/threads/${b.profile.id}/read`, l.auth), ctx({ borrowerProfileId: b.profile.id }));
    const lenderThreadsAfterRead = (await (await LENDER_THREADS(req("GET", "http://localhost/api/lenders/me/messages/threads", l.auth))).json()).data;
    expect(lenderThreadsAfterRead[0].unreadCount).toBe(0);

    await BORROWER_READ(req("POST", `http://localhost/api/borrowers/me/messages/threads/${l.company.id}/read`, b.auth), ctx({ lenderCompanyId: l.company.id }));
    const borrowerThreadsAfterRead = (await (await BORROWER_THREADS(req("GET", "http://localhost/api/borrowers/me/messages/threads", b.auth))).json()).data;
    expect(borrowerThreadsAfterRead[0].unreadCount).toBe(0);
  });

  it("D4: si la cotización se retira sin llegar a contrato, se bloquea el envío pero el historial se sigue leyendo", async () => {
    const l = await lender();
    const b = await borrower();
    const loanRequestId = await submittedQuoteBetween(l.user.id, l.company.id, b.user.id);

    await SEND_BORROWER(req("POST", "http://localhost/api/borrowers/me/messages", b.auth, { lenderCompanyId: l.company.id, body: "First message" }));
    await loanQuotesService.withdrawQuote(l.user.id, loanRequestId);

    const blocked = await SEND_BORROWER(req("POST", "http://localhost/api/borrowers/me/messages", b.auth, { lenderCompanyId: l.company.id, body: "Are you still there?" }));
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("MESSAGING_NOT_ALLOWED");

    const history = await BORROWER_THREAD(req("GET", `http://localhost/api/borrowers/me/messages/threads/${l.company.id}`, b.auth), ctx({ lenderCompanyId: l.company.id }));
    expect(history.status).toBe(200);
    expect((await history.json()).data.items).toHaveLength(1);
  });

  it("D2: un Contract fuera de DRAFT habilita el chat sin ninguna cotización, y sigue habilitado en PAID_OFF/CANCELLED", async () => {
    const l = await lender();
    const b = await borrower();
    const contract = await loanBetween(l.company.id, b.profile.id, l.user.id, "PENDING_ACCEPTANCE");

    const sent = await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, body: "Welcome aboard" }));
    expect(sent.status).toBe(201);

    await prisma.contract.update({ where: { id: contract.id }, data: { status: "PAID_OFF" } });
    expect((await SEND_BORROWER(req("POST", "http://localhost/api/borrowers/me/messages", b.auth, { lenderCompanyId: l.company.id, body: "Thanks for everything" }))).status).toBe(201);

    await prisma.contract.update({ where: { id: contract.id }, data: { status: "CANCELLED" } });
    expect((await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, body: "One last note" }))).status).toBe(201);
  });

  it("D2: un Contract todavía DRAFT no habilita el chat", async () => {
    const l = await lender();
    const b = await borrower();
    await loanBetween(l.company.id, b.profile.id, l.user.id, "DRAFT");

    const blocked = await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, body: "hi" }));
    expect(blocked.status).toBe(403);
    expect((await blocked.json()).error.code).toBe("MESSAGING_NOT_ALLOWED");
  });

  it("multi-empresa: sin lenderCompanyId y 2 empresas -> 400; empresa propia sin relación -> 403; empresa ajena -> 404", async () => {
    const l = await lender();
    const b = await borrower();
    const secondCompany = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: l.profile.id,
        companyName: "Second Messaging Co",
        ein: `89-${String(sequence).padStart(7, "0")}`,
        addressLine1: "2 St",
        city: "Austin",
        state: "TX",
        postalCode: "78703",
        createdByUserId: l.user.id,
      },
    });
    await submittedQuoteBetween(l.user.id, l.company.id, b.user.id);

    const stranger = await lender();

    const missing = await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, body: "hi" }));
    expect(missing.status).toBe(400);
    expect((await missing.json()).error.code).toBe("LENDER_COMPANY_REQUIRED");

    const wrongCompany = await SEND_LENDER(
      req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, lenderCompanyId: secondCompany.id, body: "hi" }),
    );
    expect(wrongCompany.status).toBe(403);
    expect((await wrongCompany.json()).error.code).toBe("MESSAGING_NOT_ALLOWED");

    const foreignCompany = await SEND_LENDER(
      req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, lenderCompanyId: stranger.company.id, body: "hi" }),
    );
    expect(foreignCompany.status).toBe(404);

    const ok = await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, lenderCompanyId: l.company.id, body: "hi" }));
    expect(ok.status).toBe(201);

    const historyNeedsCompany = await LENDER_THREAD(req("GET", `http://localhost/api/lenders/me/messages/threads/${b.profile.id}`, l.auth), ctx({ borrowerProfileId: b.profile.id }));
    expect(historyNeedsCompany.status).toBe(400);
    const historyOk = await LENDER_THREAD(
      req("GET", `http://localhost/api/lenders/me/messages/threads/${b.profile.id}?lenderCompanyId=${l.company.id}`, l.auth),
      ctx({ borrowerProfileId: b.profile.id }),
    );
    expect(historyOk.status).toBe(200);
  });

  it("acceso: rol equivocado, sin token, contraparte sin mensajes, y validación del body", async () => {
    const l = await lender();
    const b = await borrower();

    const wrongRole = await SEND_BORROWER(req("POST", "http://localhost/api/borrowers/me/messages", l.auth, { lenderCompanyId: l.company.id, body: "hi" }));
    expect(wrongRole.status).toBe(403);

    expect((await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", undefined, { borrowerProfileId: b.profile.id, body: "hi" }))).status).toBe(401);

    const noThread = await LENDER_THREAD(req("GET", `http://localhost/api/lenders/me/messages/threads/${b.profile.id}`, l.auth), ctx({ borrowerProfileId: b.profile.id }));
    expect(noThread.status).toBe(404);
    expect((await noThread.json()).error.code).toBe("THREAD_NOT_FOUND");

    await submittedQuoteBetween(l.user.id, l.company.id, b.user.id);
    const emptyBody = await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, body: "   " }));
    expect(emptyBody.status).toBe(400);

    const tooLong = await SEND_LENDER(req("POST", "http://localhost/api/lenders/me/messages", l.auth, { borrowerProfileId: b.profile.id, body: "x".repeat(4001) }));
    expect(tooLong.status).toBe(400);
  });
});
