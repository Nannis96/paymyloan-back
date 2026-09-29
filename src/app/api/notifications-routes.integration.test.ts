import { afterAll, describe, expect, it } from "vitest";
import { GET as LIST } from "@/app/api/notifications/route";
import { POST as READ_ONE } from "@/app/api/notifications/[id]/read/route";
import { POST as READ_ALL } from "@/app/api/notifications/read-all/route";
import { GET as UNREAD_COUNT } from "@/app/api/notifications/unread-count/route";
import { prisma } from "@/db/prisma";
import { createTestUserWithPassword, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";
import * as contractsService from "@/services/contracts.service";
import * as loanQuotesService from "@/services/loanQuotes.service";
import * as loanRequestsService from "@/services/loanRequests.service";
import * as messagingService from "@/services/messaging.service";
import type { CreateLoanRequestInput } from "@/validations/loanRequests.validation";

// Fase 19 (PB-035..039). Notificaciones in-app — Postgres real, sin mocks.
// Cubre los 8 disparadores de Docs/plan/fases/fase-19-notificaciones.md §3.1
// y las 4 rutas.

const PASSWORD = "Clave12345!";
let sequence = 0;

function req(method: string, url: string, authorization?: string) {
  return new Request(url, { method, headers: authorization ? { authorization } : {} });
}
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function lender() {
  sequence += 1;
  const user = await createTestUserWithPassword("LENDER", PASSWORD);
  const profile = await prisma.lenderProfile.create({ data: { userId: user.id } });
  const company = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: profile.id,
      companyName: `Notif Lending ${sequence}`,
      ein: `77-${String(sequence).padStart(7, "0")}`,
      addressLine1: "1 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: user.id,
    },
  });
  return { user, company, auth: `Bearer ${await issueAccessTokenFor(user, PASSWORD)}` };
}

async function borrower() {
  const user = await createTestUserWithPassword("BORROWER", PASSWORD);
  const profile = await prisma.borrowerProfile.create({ data: { userId: user.id } });
  return { user, profile, auth: `Bearer ${await issueAccessTokenFor(user, PASSWORD)}` };
}

const requestPayload: CreateLoanRequestInput = {
  property: { addressLine1: "9 Rehab Ave", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" },
  projectType: "FIX_AND_FLIP",
  purchasePrice: 150_000,
  rehabAmount: 30_000,
  totalLoanAmountRequested: 160_000,
  requestedClosingDate: new Date("2026-06-01T00:00:00.000Z"),
  visibility: "PUBLIC",
};

const quotePayload = { structure: "AMORTIZED", principalAmount: 160_000, interestRate: 9.5, amortizationTermMonths: 12 } as const;

const notificationsOf = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
const typesOf = async (userId: string) => (await notificationsOf(userId)).map((n) => n.type);

describe("notificaciones (Fase 19)", () => {
  afterAll(resetPhase1Tables);

  it("solicitud de cotización: solo a los targets; los agregados en DRAFT se notifican al publicar", async () => {
    const b = await borrower();
    const targeted = await lender();
    const late = await lender();
    const stranger = await lender();

    const draft = await loanRequestsService.createLoanRequest(b.user.id, requestPayload);
    await loanRequestsService.addLoanRequestTarget(b.user.id, draft.id, { lenderCompanyId: targeted.company.id });
    expect(await typesOf(targeted.user.id)).toEqual([]);

    await loanRequestsService.publishLoanRequest(b.user.id, draft.id);
    const [n] = await notificationsOf(targeted.user.id);
    expect(n.type).toBe("LOAN_QUOTE_REQUESTED");
    expect(n.relatedEntityType).toBe("LoanRequest");
    expect(n.relatedEntityId).toBe(draft.id);

    await loanRequestsService.addLoanRequestTarget(b.user.id, draft.id, { lenderCompanyId: late.company.id });
    expect(await typesOf(late.user.id)).toEqual(["LOAN_QUOTE_REQUESTED"]);
    expect(await typesOf(stranger.user.id)).toEqual([]);
    expect(await typesOf(b.user.id)).toEqual([]);
  });

  it("flujo completo: oferta -> selección -> términos -> aceptación -> contrato activo", async () => {
    const b = await borrower();
    const l = await lender();

    const loanRequest = await loanRequestsService.createLoanRequest(b.user.id, requestPayload);
    await loanRequestsService.publishLoanRequest(b.user.id, loanRequest.id);

    await loanQuotesService.submitQuote(l.user.id, loanRequest.id, { ...quotePayload, lenderCompanyId: l.company.id });
    expect(await typesOf(b.user.id)).toEqual(["LOAN_QUOTE_RECEIVED"]);

    const quote = await prisma.loanQuote.findFirstOrThrow({ where: { loanRequestId: loanRequest.id } });
    const { contractId } = await loanQuotesService.selectQuote(b.user.id, loanRequest.id, quote.id);
    expect(await typesOf(l.user.id)).toEqual(["LOAN_QUOTE_SELECTED"]);

    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    await contractsService.submitContractTerms(l.user.id, contractId, contract.currentTermsId!);
    expect(await typesOf(b.user.id)).toEqual(["LOAN_QUOTE_RECEIVED", "CONTRACT_TERMS_SUBMITTED"]);

    await contractsService.acceptContractTerms(b.user.id, contractId, contract.currentTermsId!, {});
    expect(await typesOf(l.user.id)).toEqual(["LOAN_QUOTE_SELECTED", "CONTRACT_ACTIVATED"]);
    expect(await typesOf(b.user.id)).toEqual(["LOAN_QUOTE_RECEIVED", "CONTRACT_TERMS_SUBMITTED", "CONTRACT_ACTIVATED"]);
  });

  it("rechazo de términos: notifica al Lender y no activa el contrato", async () => {
    const b = await borrower();
    const l = await lender();
    const loanRequest = await loanRequestsService.createLoanRequest(b.user.id, requestPayload);
    await loanRequestsService.publishLoanRequest(b.user.id, loanRequest.id);
    await loanQuotesService.submitQuote(l.user.id, loanRequest.id, { ...quotePayload, lenderCompanyId: l.company.id });
    const quote = await prisma.loanQuote.findFirstOrThrow({ where: { loanRequestId: loanRequest.id } });
    const { contractId } = await loanQuotesService.selectQuote(b.user.id, loanRequest.id, quote.id);
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    await contractsService.submitContractTerms(l.user.id, contractId, contract.currentTermsId!);

    await contractsService.rejectContractTerms(b.user.id, contractId, contract.currentTermsId!, { comment: "Rate too high" }, {});
    const notifications = await notificationsOf(l.user.id);
    expect(notifications.map((n) => n.type)).toEqual(["LOAN_QUOTE_SELECTED", "CONTRACT_TERMS_REJECTED"]);
    expect(notifications[1].body).toContain("Rate too high");
    expect(await typesOf(b.user.id)).not.toContain("CONTRACT_ACTIVATED");
  });

  it("mensajes: coalescidos por hilo mientras estén sin leer; leer el hilo apaga la notificación", async () => {
    const b = await borrower();
    const l = await lender();
    const loanRequest = await loanRequestsService.createLoanRequest(b.user.id, requestPayload);
    await loanRequestsService.publishLoanRequest(b.user.id, loanRequest.id);
    await loanQuotesService.submitQuote(l.user.id, loanRequest.id, { ...quotePayload, lenderCompanyId: l.company.id });
    const bNotificationsBefore = (await notificationsOf(b.user.id)).length;

    for (const body of ["one", "two", "three"]) {
      await messagingService.sendFromLender(l.user.id, { borrowerProfileId: b.profile.id, lenderCompanyId: l.company.id, body });
    }
    const messages = (await notificationsOf(b.user.id)).filter((n) => n.type === "MESSAGE_RECEIVED");
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe("three");
    expect(messages[0].relatedEntityId).toBe(l.company.id);
    expect((await notificationsOf(b.user.id)).length).toBe(bNotificationsBefore + 1);

    await messagingService.markThreadReadForBorrower(b.user.id, l.company.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: messages[0].id } })).isRead).toBe(true);

    await messagingService.sendFromLender(l.user.id, { borrowerProfileId: b.profile.id, lenderCompanyId: l.company.id, body: "four" });
    expect((await notificationsOf(b.user.id)).filter((n) => n.type === "MESSAGE_RECEIVED")).toHaveLength(2);

    // Del otro lado: la respuesta del Borrower llega al Lender, hilo = BorrowerProfile.
    await messagingService.sendFromBorrower(b.user.id, { lenderCompanyId: l.company.id, body: "reply" });
    const reply = (await notificationsOf(l.user.id)).find((n) => n.type === "MESSAGE_RECEIVED");
    expect(reply?.relatedEntityId).toBe(b.profile.id);
  });

  it("rutas: lista propia con filtros, unread-count, read (404 ajena, idempotente) y read-all", async () => {
    const owner = await borrower();
    const other = await borrower();
    const rows = [];
    for (const title of ["A", "B", "C"]) {
      rows.push(await prisma.notification.create({ data: { userId: owner.user.id, type: title === "C" ? "MESSAGE_RECEIVED" : "LOAN_QUOTE_RECEIVED", title, body: title } }));
    }
    const foreign = await prisma.notification.create({ data: { userId: other.user.id, type: "LOAN_QUOTE_RECEIVED", title: "X", body: "X" } });

    expect((await LIST(req("GET", "http://localhost/api/notifications"))).status).toBe(401);

    const list = (await (await LIST(req("GET", "http://localhost/api/notifications", owner.auth))).json()).data;
    expect(list.total).toBe(3);
    expect(list.items.map((n: { title: string }) => n.title)).toEqual(["C", "B", "A"]);
    const byType = (await (await LIST(req("GET", "http://localhost/api/notifications?type=MESSAGE_RECEIVED", owner.auth))).json()).data;
    expect(byType.total).toBe(1);

    const count = async () => (await (await UNREAD_COUNT(req("GET", "http://localhost/api/notifications/unread-count", owner.auth))).json()).data.unread;
    expect(await count()).toBe(3);

    const readUrl = (id: string) => `http://localhost/api/notifications/${id}/read`;
    expect((await READ_ONE(req("POST", readUrl(rows[0].id), owner.auth), ctx({ id: rows[0].id }))).status).toBe(200);
    const readAt = (await prisma.notification.findUniqueOrThrow({ where: { id: rows[0].id } })).readAt;
    expect((await READ_ONE(req("POST", readUrl(rows[0].id), owner.auth), ctx({ id: rows[0].id }))).status).toBe(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: rows[0].id } })).readAt).toEqual(readAt);
    expect(await count()).toBe(2);

    expect((await READ_ONE(req("POST", readUrl(foreign.id), owner.auth), ctx({ id: foreign.id }))).status).toBe(404);
    expect((await READ_ONE(req("POST", readUrl("nope"), owner.auth), ctx({ id: "nope" }))).status).toBe(400);

    const unreadOnly = (await (await LIST(req("GET", "http://localhost/api/notifications?isRead=false", owner.auth))).json()).data;
    expect(unreadOnly.total).toBe(2);

    const all = (await (await READ_ALL(req("POST", "http://localhost/api/notifications/read-all", owner.auth))).json()).data;
    expect(all.updated).toBe(2);
    expect(await count()).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } })).isRead).toBe(false);
  });
});
