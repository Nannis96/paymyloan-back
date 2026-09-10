import { afterAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/lenders/me/companies/route";
import { GET } from "@/app/api/lenders/me/route";
import { prisma } from "@/db/prisma";
import { createTestUserWithPassword, createTestUserWithTwoFactor, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";

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
