import type { ContractStatus } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { GET as BORROWER_RATING } from "@/app/api/borrowers/[borrowerProfileId]/rating/route";
import { GET as CONTRACT_REVIEWS, POST as CREATE_REVIEW } from "@/app/api/contracts/[id]/reviews/route";
import { GET as LENDER_RATING } from "@/app/api/lenders/[lenderCompanyId]/rating/route";
import { GET as PENDING } from "@/app/api/me/reviews/pending/route";
import { prisma } from "@/db/prisma";
import { createTestProperty, createTestUserWithPassword, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";

// Fase 18 (PB-031..034). Ratings Lender <-> Borrower — Postgres real, sin
// mocks. Cubre canReview (Docs/plan/fases/fase-18-ratings-lender-borrower.md)
// y las 4 rutas.

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
      companyName: `Reviews Lending ${sequence}`,
      ein: `77-${String(sequence).padStart(7, "0")}`,
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

async function contractBetween(lenderCompanyId: string, createdByUserId: string, borrowerProfileIds: string[], status: ContractStatus = "ACTIVE") {
  sequence += 1;
  const property = await createTestProperty(lenderCompanyId, createdByUserId);
  return prisma.contract.create({
    data: {
      lenderCompanyId,
      propertyId: property.id,
      createdByUserId,
      contractNumber: `PML-REV-${Date.now()}-${sequence}`,
      status,
      borrowers: { create: borrowerProfileIds.map((borrowerProfileId, i) => ({ borrowerProfileId, addedByUserId: createdByUserId, isPrimary: i === 0 })) },
    },
  });
}

const review = (contractId: string, auth: string | undefined, body: unknown) => CREATE_REVIEW(req("POST", `http://localhost/api/contracts/${contractId}/reviews`, auth, body), ctx({ id: contractId }));
const errorCode = async (response: Response) => (await response.json()).error.code;

describe("ratings Lender <-> Borrower (Fase 18)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: ambos se califican, el contrato lista las dos, los promedios se derivan y R5 controla los comentarios", async () => {
    const l = await lender();
    const b = await borrower();
    const outsiderLender = await lender();
    const outsiderBorrower = await borrower();
    const contract = await contractBetween(l.company.id, l.user.id, [b.profile.id]);

    const pendingBefore = (await (await PENDING(req("GET", "http://localhost/api/me/reviews/pending", l.auth))).json()).data;
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0]).toMatchObject({ contractId: contract.id, direction: "LENDER_TO_BORROWER", borrowerProfileId: b.profile.id });

    const fromLender = await review(contract.id, l.auth, { rating: 4, comment: "  Pays on time  ", borrowerProfileId: b.profile.id });
    expect(fromLender.status).toBe(201);
    const created = (await fromLender.json()).data;
    expect(created).toMatchObject({ direction: "LENDER_TO_BORROWER", rating: 4, comment: "Pays on time", reviewerUserId: l.user.id });

    // El Borrower no manda borrowerProfileId ni direction: salen del contrato.
    const fromBorrower = await review(contract.id, b.auth, { rating: 5, comment: "Great lender" });
    expect(fromBorrower.status).toBe(201);
    expect((await fromBorrower.json()).data).toMatchObject({ direction: "BORROWER_TO_LENDER", borrowerProfileId: b.profile.id });

    const list = (await (await CONTRACT_REVIEWS(req("GET", `http://localhost/api/contracts/${contract.id}/reviews`, l.auth), ctx({ id: contract.id }))).json()).data;
    expect(list.reviews).toHaveLength(2);
    expect(list.canReview).toBe(false);
    expect(list.pendingBorrowerProfileIds).toEqual([]);

    const pendingAfter = (await (await PENDING(req("GET", "http://localhost/api/me/reviews/pending", b.auth))).json()).data;
    expect(pendingAfter).toEqual([]);

    // Rating del Lender: público para cualquier usuario autenticado, con comentarios.
    const lenderRating = (await (await LENDER_RATING(req("GET", `http://localhost/api/lenders/${l.company.id}/rating`, outsiderBorrower.auth), ctx({ lenderCompanyId: l.company.id }))).json()).data;
    expect(lenderRating).toMatchObject({ average: 5, count: 1, distribution: { "5": 1, "4": 0 } });
    expect(lenderRating.reviews.items[0].comment).toBe("Great lender");

    // Rating del Borrower: quien tiene contrato con él ve comentarios...
    const asOwnLender = (await (await BORROWER_RATING(req("GET", `http://localhost/api/borrowers/${b.profile.id}/rating`, l.auth), ctx({ borrowerProfileId: b.profile.id }))).json()).data;
    expect(asOwnLender).toMatchObject({ average: 4, count: 1 });
    expect(asOwnLender.reviews.items[0].comment).toBe("Pays on time");

    // ...él mismo también...
    const asSelf = (await (await BORROWER_RATING(req("GET", `http://localhost/api/borrowers/${b.profile.id}/rating`, b.auth), ctx({ borrowerProfileId: b.profile.id }))).json()).data;
    expect(asSelf.reviews.items).toHaveLength(1);

    // ...otro Lender sin contrato solo ve promedio y conteo...
    const asOtherLender = (await (await BORROWER_RATING(req("GET", `http://localhost/api/borrowers/${b.profile.id}/rating`, outsiderLender.auth), ctx({ borrowerProfileId: b.profile.id }))).json()).data;
    expect(asOtherLender).toMatchObject({ average: 4, count: 1, reviews: null });

    // ...y otro Borrower ni eso (persona física): 404.
    const asOtherBorrower = await BORROWER_RATING(req("GET", `http://localhost/api/borrowers/${b.profile.id}/rating`, outsiderBorrower.auth), ctx({ borrowerProfileId: b.profile.id }));
    expect(asOtherBorrower.status).toBe(404);
  });

  it("duplicado (mismo contrato + deudor + sentido) → 409, aunque cambie el comentario", async () => {
    const l = await lender();
    const b = await borrower();
    const contract = await contractBetween(l.company.id, l.user.id, [b.profile.id]);

    expect((await review(contract.id, b.auth, { rating: 3 })).status).toBe(201);
    const second = await review(contract.id, b.auth, { rating: 1, comment: "changed my mind" });
    expect(second.status).toBe(409);
    expect(await errorCode(second)).toBe("REVIEW_ALREADY_EXISTS");
  });

  it("R2: DRAFT, PENDING_ACCEPTANCE y CANCELLED no se pueden calificar; DELINQUENT y PAID_OFF sí", async () => {
    const l = await lender();
    const b = await borrower();
    for (const status of ["DRAFT", "PENDING_ACCEPTANCE", "CANCELLED"] as const) {
      const contract = await contractBetween(l.company.id, l.user.id, [b.profile.id], status);
      const response = await review(contract.id, b.auth, { rating: 5 });
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("REVIEW_NOT_ALLOWED");
    }
    for (const status of ["DELINQUENT", "PAID_OFF"] as const) {
      const contract = await contractBetween(l.company.id, l.user.id, [b.profile.id], status);
      expect((await review(contract.id, b.auth, { rating: 2 })).status).toBe(201);
    }
  });

  it("acceso: ajeno al contrato → 404, co-deudor removido → 404, sin token → 401", async () => {
    const l = await lender();
    const b = await borrower();
    const removed = await borrower();
    const outsiderLender = await lender();
    const contract = await contractBetween(l.company.id, l.user.id, [b.profile.id, removed.profile.id]);
    await prisma.contractBorrower.update({
      where: { contractId_borrowerProfileId: { contractId: contract.id, borrowerProfileId: removed.profile.id } },
      data: { removedAt: new Date() },
    });

    expect((await review(contract.id, outsiderLender.auth, { rating: 5, borrowerProfileId: b.profile.id })).status).toBe(404);
    expect((await review(contract.id, removed.auth, { rating: 5 })).status).toBe(404);
    expect((await review(contract.id, undefined, { rating: 5 })).status).toBe(401);
  });

  it("co-deudores: el Lender debe indicar a quién califica y cada uno se califica por separado", async () => {
    const l = await lender();
    const b1 = await borrower();
    const b2 = await borrower();
    const contract = await contractBetween(l.company.id, l.user.id, [b1.profile.id, b2.profile.id]);

    const missing = await review(contract.id, l.auth, { rating: 5 });
    expect(missing.status).toBe(400);
    expect(await errorCode(missing)).toBe("BORROWER_PROFILE_REQUIRED");

    const stranger = await borrower();
    expect((await review(contract.id, l.auth, { rating: 5, borrowerProfileId: stranger.profile.id })).status).toBe(404);

    expect((await review(contract.id, l.auth, { rating: 5, borrowerProfileId: b1.profile.id })).status).toBe(201);
    const list = (await (await CONTRACT_REVIEWS(req("GET", `http://localhost/api/contracts/${contract.id}/reviews`, l.auth), ctx({ id: contract.id }))).json()).data;
    expect(list.canReview).toBe(true); // falta b2
    expect(list.pendingBorrowerProfileIds).toEqual([b2.profile.id]);

    expect((await review(contract.id, l.auth, { rating: 2, borrowerProfileId: b2.profile.id })).status).toBe(201);
    expect((await review(contract.id, l.auth, { rating: 2, borrowerProfileId: b2.profile.id })).status).toBe(409);
  });

  it("rol dual: el sentido sale del lado del contrato, no de User.role", async () => {
    const other = await lender();
    const dual = await lender(); // usuario LENDER con LenderCompany propia...
    const dualBorrowerProfile = await prisma.borrowerProfile.create({ data: { userId: dual.user.id } }); // ...que además es Borrower
    const b = await borrower();
    // Los roles activos viajan en el token: hay que reemitirlo tras crear el perfil.
    dual.auth = `Bearer ${await issueAccessTokenFor(dual.user, PASSWORD)}`;

    const asLender = await contractBetween(dual.company.id, dual.user.id, [b.profile.id]);
    const asBorrower = await contractBetween(other.company.id, other.user.id, [dualBorrowerProfile.id]);

    const first = await review(asLender.id, dual.auth, { rating: 4, borrowerProfileId: b.profile.id });
    expect((await first.json()).data.direction).toBe("LENDER_TO_BORROWER");
    const second = await review(asBorrower.id, dual.auth, { rating: 3 });
    const secondData = (await second.json()).data;
    expect(secondData.direction).toBe("BORROWER_TO_LENDER");
    expect(secondData.lenderCompanyId).toBe(other.company.id);

    // Autocalificación: ser ambas partes del mismo contrato (no debería
    // pasar, D-P7-2) se rechaza igual.
    const self = await contractBetween(dual.company.id, dual.user.id, [dualBorrowerProfile.id]);
    const blocked = await review(self.id, dual.auth, { rating: 5, borrowerProfileId: dualBorrowerProfile.id });
    expect(blocked.status).toBe(409);
    expect(await errorCode(blocked)).toBe("SELF_REVIEW_NOT_ALLOWED");
  });

  it("validación: rating fuera de 1–5 o no entero, comentario >1000, JSON inválido → 400; comentario vacío se guarda como null", async () => {
    const l = await lender();
    const b = await borrower();
    const contract = await contractBetween(l.company.id, l.user.id, [b.profile.id]);

    for (const rating of [0, 6, 1.5, "5"]) {
      expect((await review(contract.id, b.auth, { rating })).status).toBe(400);
    }
    expect((await review(contract.id, b.auth, { rating: 5, comment: "x".repeat(1001) })).status).toBe(400);
    expect((await CREATE_REVIEW(new Request(`http://localhost/api/contracts/${contract.id}/reviews`, { method: "POST", headers: { authorization: b.auth }, body: "{" }), ctx({ id: contract.id }))).status).toBe(400);

    const ok = await review(contract.id, b.auth, { rating: 5, comment: "   " });
    expect(ok.status).toBe(201);
    expect((await ok.json()).data.comment).toBeNull();
  });

  it("CHECK en la BD: un rating fuera de 1–5 no entra ni saltándose la API", async () => {
    const l = await lender();
    const b = await borrower();
    const contract = await contractBetween(l.company.id, l.user.id, [b.profile.id]);
    await expect(
      prisma.review.create({
        data: { contractId: contract.id, lenderCompanyId: l.company.id, borrowerProfileId: b.profile.id, direction: "BORROWER_TO_LENDER", reviewerUserId: b.user.id, rating: 9 },
      }),
    ).rejects.toThrow();
  });

  it("ratings: LenderCompany inexistente → 404 y sin reseñas → average null", async () => {
    const l = await lender();
    const empty = await LENDER_RATING(req("GET", `http://localhost/api/lenders/${l.company.id}/rating`, l.auth), ctx({ lenderCompanyId: l.company.id }));
    expect((await empty.json()).data).toMatchObject({ average: null, count: 0 });

    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await LENDER_RATING(req("GET", `http://localhost/api/lenders/${missing}/rating`, l.auth), ctx({ lenderCompanyId: missing }))).status).toBe(404);
  });
});
