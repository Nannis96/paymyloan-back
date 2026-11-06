import { afterAll, describe, expect, it, vi } from "vitest";

// S3 en memoria — lo único simulado; Postgres es real (mismo criterio que el
// resto de *.integration.test.ts).
const bucket = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("@/lib/s3", () => ({
  putObject: async (key: string, body: Buffer) => void bucket.set(key, Buffer.from(body)),
  getObject: async (key: string) => bucket.get(key) ?? Promise.reject(new Error("NoSuchKey")),
  deleteObject: async (key: string) => void bucket.delete(key),
}));

import { GET as CONTRACT_GET } from "@/app/api/contracts/[id]/route";
import { GET as CONTRACT_DOCS, POST as CONTRACT_UPLOAD } from "@/app/api/contracts/[id]/documents/route";
import { GET as CONTENT } from "@/app/api/documents/[id]/content/route";
import { DELETE as DELETE_DOC } from "@/app/api/documents/[id]/route";
import { GET as LR_DOCS, POST as LR_UPLOAD } from "@/app/api/loan-requests/[id]/documents/route";
import { prisma } from "@/db/prisma";
import { createTestProperty, createTestUserWithPassword, createTestUserWithTwoFactor, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";

const PASSWORD = "Clave12345!";
let sequence = 0;

const PDF = Buffer.from("%PDF-1.7\nconfidential loan document");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png-bytes")]);

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string, auth?: string) => new Request(url, { headers: auth ? { authorization: auth } : {} });

function upload(url: string, auth: string, files: Array<[Buffer, string]>) {
  const form = new FormData();
  for (const [bytes, name] of files) form.append("files", new File([new Uint8Array(bytes)], name));
  return new Request(url, { method: "POST", headers: { authorization: auth }, body: form });
}

async function lender() {
  sequence += 1;
  // Escrituras de LENDER exigen 2FA (D-P3-1).
  const { user, secret } = await createTestUserWithTwoFactor("LENDER", PASSWORD);
  const profile = await prisma.lenderProfile.create({ data: { userId: user.id } });
  const company = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: profile.id,
      companyName: `Docs Lending ${sequence}`,
      ein: `66-${String(sequence).padStart(7, "0")}`,
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
  const profile = await prisma.borrowerProfile.create({ data: { userId: user.id } });
  return { user, profile, auth: `Bearer ${await issueAccessTokenFor(user, PASSWORD)}` };
}

describe("documentos cifrados (PB-002)", () => {
  afterAll(resetPhase1Tables);

  it("contrato: subida múltiple cifrada, lectura descifrada por ambas partes, borrado solo por quien subió", async () => {
    const l = await lender();
    const b = await borrower();
    const outsider = await lender();
    const property = await createTestProperty(l.company.id, l.user.id);
    const contract = await prisma.contract.create({
      data: {
        lenderCompanyId: l.company.id,
        propertyId: property.id,
        createdByUserId: l.user.id,
        contractNumber: `PML-DOC-${Date.now()}`,
        status: "ACTIVE",
        borrowers: { create: [{ borrowerProfileId: b.profile.id, addedByUserId: l.user.id, isPrimary: true }] },
      },
    });
    const url = `http://localhost/api/contracts/${contract.id}/documents`;

    const created = await CONTRACT_UPLOAD(upload(url, b.auth, [[PDF, "note.pdf"], [PNG, "../front.png"]]), ctx(contract.id));
    expect(created.status).toBe(201);
    const docs = (await created.json()).data;
    expect(docs.map((d: { mimeType: string }) => d.mimeType)).toEqual(["application/pdf", "image/png"]);
    expect(docs[1].originalFileName).toBe(".._front.png");
    expect(docs[0]).not.toHaveProperty("wrappedKey");

    // En S3 solo hay bytes cifrados.
    expect(bucket.size).toBe(2);
    for (const stored of bucket.values()) expect(stored.includes(Buffer.from("confidential"))).toBe(false);

    const listed = (await (await CONTRACT_DOCS(get(url, l.auth), ctx(contract.id))).json()).data;
    expect(listed).toHaveLength(2);

    const content = await CONTENT(get(`http://localhost/api/documents/${docs[0].id}/content`, l.auth), ctx(docs[0].id));
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await content.arrayBuffer())).toEqual(PDF);

    // Ajeno: 404 en todo, sin confirmar que existe.
    expect((await CONTRACT_DOCS(get(url, outsider.auth), ctx(contract.id))).status).toBe(404);
    expect((await CONTENT(get("http://x/c", outsider.auth), ctx(docs[0].id))).status).toBe(404);
    expect((await DELETE_DOC(new Request("http://x", { method: "DELETE", headers: { authorization: outsider.auth } }), ctx(docs[0].id))).status).toBe(404);

    // Lender ve el documento del Borrower pero no puede borrarlo.
    const del = (auth: string) => DELETE_DOC(new Request("http://x", { method: "DELETE", headers: { authorization: auth } }), ctx(docs[0].id));
    expect((await del(l.auth)).status).toBe(403);
    expect((await del(b.auth)).status).toBe(200);
    expect(bucket.size).toBe(1);
    expect(await prisma.document.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "DOCUMENT_DELETED", entityId: docs[0].id } })).toBe(1);
  });

  it("rechaza tipos no permitidos (por contenido, no por nombre) y lotes vacíos sin subir nada", async () => {
    const l = await lender();
    const property = await createTestProperty(l.company.id, l.user.id);
    const contract = await prisma.contract.create({
      data: { lenderCompanyId: l.company.id, propertyId: property.id, createdByUserId: l.user.id, contractNumber: `PML-DOC-BAD-${Date.now()}` },
    });
    const url = `http://localhost/api/contracts/${contract.id}/documents`;
    const before = bucket.size;

    const bad = await CONTRACT_UPLOAD(upload(url, l.auth, [[PDF, "ok.pdf"], [Buffer.from("MZ fake exe"), "virus.pdf"]]), ctx(contract.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect((await CONTRACT_UPLOAD(upload(url, l.auth, []), ctx(contract.id))).status).toBe(400);
    expect(bucket.size).toBe(before);
  });

  it("loan request: el dueño sube; el Lender solo ve si es PUBLIC y sube si va dirigida a él; el contrato expone de qué loan request nació", async () => {
    const l = await lender();
    const b = await borrower();
    const otherBorrower = await borrower();
    const property = await createTestProperty(l.company.id, l.user.id);
    const loanRequest = await prisma.loanRequest.create({
      data: {
        borrowerProfileId: b.profile.id,
        propertyId: property.id,
        projectType: "FIX_AND_FLIP",
        purchasePrice: 100000,
        rehabAmount: 20000,
        totalLoanAmountRequested: 90000,
        requestedClosingDate: new Date("2027-01-01"),
        visibility: "PUBLIC",
        status: "PUBLISHED",
      },
    });
    const url = `http://localhost/api/loan-requests/${loanRequest.id}/documents`;

    expect((await LR_UPLOAD(upload(url, b.auth, [[PNG, "kitchen.png"]]), ctx(loanRequest.id))).status).toBe(201);
    expect((await LR_DOCS(get(url, otherBorrower.auth), ctx(loanRequest.id))).status).toBe(404);

    // PUBLIC: el Lender del marketplace ve, pero no sube.
    const publicUpload = await LR_UPLOAD(upload(url, l.auth, [[PDF, "terms.pdf"]]), ctx(loanRequest.id));
    expect(publicUpload.status).toBe(403);
    expect((await (await LR_DOCS(get(url, l.auth), ctx(loanRequest.id))).json()).data).toHaveLength(1);

    // Dirigida a su empresa: sí sube.
    await prisma.loanRequest.update({ where: { id: loanRequest.id }, data: { visibility: "PRIVATE" } });
    await prisma.loanRequestLenderTarget.create({ data: { loanRequestId: loanRequest.id, lenderCompanyId: l.company.id, invitedByUserId: b.user.id } });
    expect((await LR_UPLOAD(upload(url, l.auth, [[PDF, "terms.pdf"]]), ctx(loanRequest.id))).status).toBe(201);
    expect((await (await LR_DOCS(get(url, l.auth), ctx(loanRequest.id))).json()).data).toHaveLength(2);

    const contract = await prisma.contract.create({
      data: {
        lenderCompanyId: l.company.id,
        propertyId: property.id,
        createdByUserId: l.user.id,
        contractNumber: `PML-DOC-LR-${Date.now()}`,
        originationSource: "MARKETPLACE",
        loanRequestId: loanRequest.id,
      },
    });
    const detail = (await (await CONTRACT_GET(get(`http://localhost/api/contracts/${contract.id}`, l.auth), ctx(contract.id))).json()).data;
    expect(detail.loanRequestId).toBe(loanRequest.id);
    expect(detail.loanRequest).toMatchObject({ id: loanRequest.id, status: "PUBLISHED" });
  });
});
