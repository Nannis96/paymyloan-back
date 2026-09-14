import { afterAll, describe, expect, it } from "vitest";
import { DELETE, PATCH } from "@/app/api/lenders/me/companies/[companyId]/route";
import { POST } from "@/app/api/lenders/me/companies/route";
import { GET } from "@/app/api/lenders/me/route";
import { prisma } from "@/db/prisma";
import {
  createTestLenderCompany,
  createTestUserWithPassword,
  createTestUserWithTwoFactor,
  issueAccessTokenFor,
  resetPhase1Tables,
} from "@/db/testFixtures";

const LENDER_PASSWORD = "LenderClave123!";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// BE-101, nuevo (D-P4-5): el propio Lender se crea una empresa, sin
// depender de un Admin — cierra el hueco de un Lender auto-registrado
// (D-P2-1) que nace con LenderProfile pero sin ninguna LenderCompany.
describe("rutas HTTP de /api/lenders/me/companies (BE-101, D-P4-5)", () => {
  afterAll(resetPhase1Tables);

  it("un Lender con 2FA se crea su propia empresa, y luego aparece en GET /api/lenders/me", async () => {
    const { user, secret } = await createTestUserWithTwoFactor("LENDER", LENDER_PASSWORD);
    // createTestUserWithTwoFactor no crea LenderProfile — se asegura acá
    // para que el caso probado sea "Lender activo, sin ninguna empresa
    // todavía" (el gap real que motivó este endpoint, igual que un
    // auto-registrado, D-P2-1).
    await prisma.lenderProfile.create({ data: { userId: user.id } });
    const auth = `Bearer ${await issueAccessTokenFor(user, LENDER_PASSWORD, secret)}`;

    const createResponse = await POST(
      jsonRequest(
        "POST",
        "http://localhost/api/lenders/me/companies",
        {
          companyName: "Self-Service Lending LLC",
          ein: "88-8888888",
          addressLine1: "1 Self St",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
        },
        { authorization: auth },
      ),
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.data.companyName).toBe("Self-Service Lending LLC");

    const meResponse = await GET(jsonRequest("GET", "http://localhost/api/lenders/me", undefined, { authorization: auth }));
    expect(meResponse.status).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody.data.lenderCompanies.map((c: { id: string }) => c.id)).toContain(created.data.id);
  });

  it("un Lender sin 2FA activo no puede crearse una empresa (D-P3-1)", async () => {
    const user = await createTestUserWithPassword("LENDER", LENDER_PASSWORD);
    await prisma.lenderProfile.create({ data: { userId: user.id } });
    const auth = `Bearer ${await issueAccessTokenFor(user, LENDER_PASSWORD)}`;

    const response = await POST(
      jsonRequest(
        "POST",
        "http://localhost/api/lenders/me/companies",
        {
          companyName: "Blocked Self-Service LLC",
          ein: "99-9999999",
          addressLine1: "1 St",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
        },
        { authorization: auth },
      ),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("TWO_FACTOR_REQUIRED");
  });
});

// D-P4-9, nuevo: el propio Lender edita/borra una empresa suya (antes solo
// el Admin podía, D-P4-8).
describe("rutas HTTP de PATCH/DELETE /api/lenders/me/companies/:companyId (D-P4-9)", () => {
  afterAll(resetPhase1Tables);

  let einCounter = 0;
  function uniqueEin(): string {
    einCounter += 1;
    return `70-${(Date.now() + einCounter).toString().slice(-7)}`;
  }

  async function ownLenderWithCompany() {
    const { user, secret } = await createTestUserWithTwoFactor("LENDER", LENDER_PASSWORD);
    const lenderProfile = await prisma.lenderProfile.create({ data: { userId: user.id } });
    const lenderCompany = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: "Own Co LLC",
        ein: uniqueEin(),
        addressLine1: "1 Own St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        createdByUserId: user.id,
      },
    });
    const auth = `Bearer ${await issueAccessTokenFor(user, LENDER_PASSWORD, secret)}`;
    return { auth, lenderCompany };
  }

  it("un Lender con 2FA edita una empresa propia", async () => {
    const { auth, lenderCompany } = await ownLenderWithCompany();

    const response = await PATCH(
      jsonRequest("PATCH", `http://localhost/api/lenders/me/companies/${lenderCompany.id}`, { companyName: "Renamed Co LLC" }, { authorization: auth }),
      { params: Promise.resolve({ companyId: lenderCompany.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.companyName).toBe("Renamed Co LLC");
  });

  it("`status` en el body se ignora por esta vía — suspender/reactivar sigue siendo solo del Admin (D-P4-9)", async () => {
    const { auth, lenderCompany } = await ownLenderWithCompany();

    const response = await PATCH(
      jsonRequest("PATCH", `http://localhost/api/lenders/me/companies/${lenderCompany.id}`, { companyName: "Still Active LLC", status: "SUSPENDED" }, { authorization: auth }),
      { params: Promise.resolve({ companyId: lenderCompany.id }) },
    );
    expect(response.status).toBe(200);
    const updated = await prisma.lenderCompany.findUniqueOrThrow({ where: { id: lenderCompany.id } });
    expect(updated.status).toBe("ACTIVE");
  });

  it("un Lender no puede editar/borrar una empresa de otro Lender — 404, no 403 (anti-enumeración)", async () => {
    const { auth } = await ownLenderWithCompany();
    const stranger = await createTestLenderCompany();

    const patchResponse = await PATCH(
      jsonRequest("PATCH", `http://localhost/api/lenders/me/companies/${stranger.lenderCompany.id}`, { companyName: "Hijacked LLC" }, { authorization: auth }),
      { params: Promise.resolve({ companyId: stranger.lenderCompany.id }) },
    );
    expect(patchResponse.status).toBe(404);
    expect((await patchResponse.json()).error.code).toBe("LENDER_COMPANY_NOT_FOUND");

    const deleteResponse = await DELETE(jsonRequest("DELETE", `http://localhost/api/lenders/me/companies/${stranger.lenderCompany.id}`, undefined, { authorization: auth }), {
      params: Promise.resolve({ companyId: stranger.lenderCompany.id }),
    });
    expect(deleteResponse.status).toBe(404);
  });

  it("un Lender con 2FA borra una empresa propia sin contratos activos", async () => {
    const { auth, lenderCompany } = await ownLenderWithCompany();

    const response = await DELETE(jsonRequest("DELETE", `http://localhost/api/lenders/me/companies/${lenderCompany.id}`, undefined, { authorization: auth }), {
      params: Promise.resolve({ companyId: lenderCompany.id }),
    });
    expect(response.status).toBe(200);
    const deleted = await prisma.lenderCompany.findUniqueOrThrow({ where: { id: lenderCompany.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("un Lender sin 2FA activo no puede editar ni borrar una empresa propia (D-P3-1)", async () => {
    const user = await createTestUserWithPassword("LENDER", LENDER_PASSWORD);
    const lenderProfile = await prisma.lenderProfile.create({ data: { userId: user.id } });
    const lenderCompany = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: "No 2FA Co LLC",
        ein: "71-7100000",
        addressLine1: "1 St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        createdByUserId: user.id,
      },
    });
    const auth = `Bearer ${await issueAccessTokenFor(user, LENDER_PASSWORD)}`;

    const patchResponse = await PATCH(
      jsonRequest("PATCH", `http://localhost/api/lenders/me/companies/${lenderCompany.id}`, { companyName: "Blocked LLC" }, { authorization: auth }),
      { params: Promise.resolve({ companyId: lenderCompany.id }) },
    );
    expect(patchResponse.status).toBe(403);
    expect((await patchResponse.json()).error.code).toBe("TWO_FACTOR_REQUIRED");
  });
});
