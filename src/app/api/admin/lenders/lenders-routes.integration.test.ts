import { afterAll, describe, expect, it } from "vitest";
import { DELETE, GET as GET_ONE } from "@/app/api/admin/lenders/[id]/route";
import { POST as POST_COMPANY } from "@/app/api/admin/lenders/[id]/companies/route";
import { DELETE as DELETE_COMPANY, PATCH as PATCH_COMPANY } from "@/app/api/admin/lenders/[id]/companies/[companyId]/route";
import { GET } from "@/app/api/admin/lenders/route";
import { createTestLenderCompany, createTestLenderWithoutCompany, createTestUserWithPassword, createTestUserWithTwoFactor, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";

const ADMIN_PASSWORD = "AdminClave123!";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// D-P4-5: rescopeo de BE-040 — ya no hay POST /api/admin/lenders (eso era
// crear la persona, ahora autoservicio vía POST /api/auth/register). Este
// archivo cubre GET/DELETE sobre un Lender existente, POST .../companies
// (asociar una empresa, D-P4-5) y PATCH/DELETE .../companies/:companyId
// (editar/borrar una empresa puntual, D-P4-8 — reemplaza al PATCH que antes
// tenía /api/admin/lenders/:id, eliminado por D-P4-8).
describe("rutas HTTP de /api/admin/lenders (BE-041..044, D-P4-5, D-P4-8)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: ADMIN con 2FA asocia una empresa a un Lender existente, la lista, edita, borra, y borra el Lender", async () => {
    const { user: admin, secret } = await createTestUserWithTwoFactor("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD, secret)}`;

    const { lenderProfile } = await createTestLenderWithoutCompany();

    const createResponse = await POST_COMPANY(
      jsonRequest(
        "POST",
        "http://localhost/api/admin/lenders/x/companies",
        {
          companyName: "HTTP Lending LLC",
          ein: "55-5555555",
          addressLine1: "1 HTTP St",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
        },
        { authorization: adminAuth },
      ),
      { params: Promise.resolve({ id: lenderProfile.id }) },
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.data.companyName).toBe("HTTP Lending LLC");
    const companyId = created.data.id as string;

    const listResponse = await GET(jsonRequest("GET", `http://localhost/api/admin/lenders?search=${encodeURIComponent("HTTP Lending")}`, undefined, { authorization: adminAuth }));
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.data.total).toBe(1);

    const detailResponse = await GET_ONE(jsonRequest("GET", "http://localhost/api/admin/lenders/x", undefined, { authorization: adminAuth }), {
      params: Promise.resolve({ id: lenderProfile.id }),
    });
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.data.lenderCompanies).toHaveLength(1);

    const patchCompanyResponse = await PATCH_COMPANY(
      jsonRequest("PATCH", "http://localhost/api/admin/lenders/x/companies/y", { contactPhone: "5512345678", isOpenToDeals: false }, { authorization: adminAuth }),
      { params: Promise.resolve({ id: lenderProfile.id, companyId }) },
    );
    expect(patchCompanyResponse.status).toBe(200);
    const patchedCompany = await patchCompanyResponse.json();
    expect(patchedCompany.data.contactPhone).toBe("5512345678");
    expect(patchedCompany.data.isOpenToDeals).toBe(false);

    const deleteCompanyResponse = await DELETE_COMPANY(
      jsonRequest("DELETE", "http://localhost/api/admin/lenders/x/companies/y", undefined, { authorization: adminAuth }),
      { params: Promise.resolve({ id: lenderProfile.id, companyId }) },
    );
    expect(deleteCompanyResponse.status).toBe(200);

    const deleteResponse = await DELETE(jsonRequest("DELETE", "http://localhost/api/admin/lenders/x", undefined, { authorization: adminAuth }), {
      params: Promise.resolve({ id: lenderProfile.id }),
    });
    expect(deleteResponse.status).toBe(200);
  });

  it("un ADMIN sin 2FA activo no puede asociar una empresa a un Lender (D-P3-1)", async () => {
    const admin = await createTestUserWithPassword("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD)}`;
    const { lenderProfile } = await createTestLenderWithoutCompany();

    const response = await POST_COMPANY(
      jsonRequest(
        "POST",
        "http://localhost/api/admin/lenders/x/companies",
        {
          companyName: "Blocked LLC",
          ein: "66-6666666",
          addressLine1: "1 St",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
        },
        { authorization: adminAuth },
      ),
      { params: Promise.resolve({ id: lenderProfile.id }) },
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("TWO_FACTOR_REQUIRED");
  });

  it("POST /api/admin/lenders/:id/companies acepta el User.id del Lender, el único que GET /api/users expone (D-P4-7)", async () => {
    const { user: admin, secret } = await createTestUserWithTwoFactor("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD, secret)}`;
    const { lenderUser } = await createTestLenderWithoutCompany();

    const response = await POST_COMPANY(
      jsonRequest(
        "POST",
        "http://localhost/api/admin/lenders/x/companies",
        {
          companyName: "Via User Id LLC",
          ein: "88-8888888",
          addressLine1: "1 St",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
        },
        { authorization: adminAuth },
      ),
      { params: Promise.resolve({ id: lenderUser.id }) },
    );
    expect(response.status).toBe(201);
  });

  it("POST /api/admin/lenders/:id/companies con un :id inexistente responde 404 LENDER_NOT_FOUND", async () => {
    const { user: admin, secret } = await createTestUserWithTwoFactor("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD, secret)}`;

    const response = await POST_COMPANY(
      jsonRequest(
        "POST",
        "http://localhost/api/admin/lenders/x/companies",
        {
          companyName: "Nadie LLC",
          ein: "77-7777777",
          addressLine1: "1 St",
          city: "Austin",
          state: "TX",
          postalCode: "78701",
        },
        { authorization: adminAuth },
      ),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("LENDER_NOT_FOUND");
  });

  it("un ADMIN sin 2FA activo no puede editar ni borrar una empresa (D-P3-1)", async () => {
    const admin = await createTestUserWithPassword("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD)}`;
    const { lenderProfile, lenderCompany } = await createTestLenderCompany();

    const patchResponse = await PATCH_COMPANY(
      jsonRequest("PATCH", "http://localhost/api/admin/lenders/x/companies/y", { companyName: "x" }, { authorization: adminAuth }),
      { params: Promise.resolve({ id: lenderProfile.id, companyId: lenderCompany.id }) },
    );
    expect(patchResponse.status).toBe(403);

    const deleteResponse = await DELETE_COMPANY(
      jsonRequest("DELETE", "http://localhost/api/admin/lenders/x/companies/y", undefined, { authorization: adminAuth }),
      { params: Promise.resolve({ id: lenderProfile.id, companyId: lenderCompany.id }) },
    );
    expect(deleteResponse.status).toBe(403);
  });

  it("PATCH .../companies/:companyId con un companyId ajeno responde 404 LENDER_COMPANY_NOT_FOUND", async () => {
    const { user: admin, secret } = await createTestUserWithTwoFactor("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD, secret)}`;
    const { lenderProfile: profileA } = await createTestLenderCompany();
    const { lenderCompany: companyB } = await createTestLenderCompany();

    const response = await PATCH_COMPANY(
      jsonRequest("PATCH", "http://localhost/api/admin/lenders/x/companies/y", { companyName: "x" }, { authorization: adminAuth }),
      { params: Promise.resolve({ id: profileA.id, companyId: companyB.id }) },
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("LENDER_COMPANY_NOT_FOUND");
  });
});
