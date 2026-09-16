import { afterAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/lenders/me/borrowers/route";
import { GET as getBorrowerByIdRoute, DELETE as removeBorrowerRoute } from "@/app/api/lenders/me/borrowers/[id]/route";
import { POST as changePasswordRoute } from "@/app/api/borrowers/me/password/route";
import { GET as getOwnBorrowerRoute, PATCH as patchOwnBorrowerRoute } from "@/app/api/borrowers/me/route";
import { createTestUserWithTwoFactor, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";
import * as emailLib from "@/lib/email";
import * as authService from "@/services/auth.service";
import * as lenderBorrowersService from "@/services/lenderBorrowers.service";
import { prisma } from "@/db/prisma";

const LENDER_PASSWORD = "LenderClave123!";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("rutas HTTP de /api/lenders/me/borrowers y /api/borrowers/me (BE-045..050)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: Borrower creado (BE-045, hoy vía service — POST /api/lenders/me/borrowers deshabilitado 2026-09-11) loguea → PATCH bloqueado hasta cambiar la contraseña → cambia → ahora puede editar", async () => {
    const { user: lenderUser, secret } = await createTestUserWithTwoFactor("LENDER", LENDER_PASSWORD);
    const lenderProfile = await prisma.lenderProfile.create({ data: { userId: lenderUser.id, createdByAdminId: null } });
    const lenderCompany = await prisma.lenderCompany.create({
      data: {
        lenderProfileId: lenderProfile.id,
        companyName: `HTTP Lender Co ${Date.now()}`,
        ein: `77-${Date.now().toString().slice(-7)}`,
        addressLine1: "1 St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        createdByUserId: lenderUser.id,
      },
    });
    const lenderAuth = `Bearer ${await issueAccessTokenFor(lenderUser, LENDER_PASSWORD, secret)}`;

    // POST /api/lenders/me/borrowers está comentado (deshabilitado a pedido
    // explícito 2026-09-11) — el resto de este test (BE-050, el gate de
    // mustChangePassword) no depende de cómo nace el Borrower, así que se
    // arma directo por el service en vez de perder esta cobertura.
    const borrowerEmail = `http-borrower-${Date.now()}@test.local`;
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(lenderUser.id, { name: "HTTP Borrower", email: borrowerEmail });
    expect(created).not.toHaveProperty("temporaryPassword");
    expect(created.borrower.lenderCompanies.map((c) => c.id)).toEqual([lenderCompany.id]);

    const temporaryPassword = sendEmailSpy.mock.calls[0][0].data.temporaryPassword as string;
    sendEmailSpy.mockRestore();

    const listResponse = await GET(jsonRequest("GET", "http://localhost/api/lenders/me/borrowers", undefined, { authorization: lenderAuth }));
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody.data.total).toBe(1);

    const borrowerLogin = await authService.login({ email: borrowerEmail, password: temporaryPassword });
    if (borrowerLogin.requiresTwoFactor) throw new Error("unreachable");
    const borrowerAuth = `Bearer ${borrowerLogin.accessToken}`;

    const meResponse = await getOwnBorrowerRoute(new Request("http://localhost/api/borrowers/me", { headers: { authorization: borrowerAuth } }));
    expect(meResponse.status).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody.data.user.mustChangePassword).toBe(true);

    const blockedPatch = await patchOwnBorrowerRoute(
      new Request("http://localhost/api/borrowers/me", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: borrowerAuth },
        body: JSON.stringify({ phone: "5512345678" }),
      }),
    );
    expect(blockedPatch.status).toBe(403);
    const blockedBody = await blockedPatch.json();
    expect(blockedBody.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changePasswordResponse = await changePasswordRoute(
      new Request("http://localhost/api/borrowers/me/password", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: borrowerAuth },
        body: JSON.stringify({ currentPassword: temporaryPassword, newPassword: "NuevaClave123!" }),
      }),
    );
    expect(changePasswordResponse.status).toBe(200);

    const newLogin = await authService.login({ email: borrowerEmail, password: "NuevaClave123!" });
    if (newLogin.requiresTwoFactor) throw new Error("unreachable");
    const newBorrowerAuth = `Bearer ${newLogin.accessToken}`;

    const allowedPatch = await patchOwnBorrowerRoute(
      new Request("http://localhost/api/borrowers/me", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: newBorrowerAuth },
        body: JSON.stringify({ addressLine1: "1 Main St" }),
      }),
    );
    expect(allowedPatch.status).toBe(200);
    const allowedBody = await allowedPatch.json();
    expect(allowedBody.data.borrowerProfile.addressLine1).toBe("1 Main St");
  });

  it("GET /api/lenders/me/borrowers/:id: el dueño lo ve, un Lender ajeno recibe 404 (BE-047); DELETE lo desvincula (BE-049)", async () => {
    const { user: ownerLenderUser, secret: ownerSecret } = await createTestUserWithTwoFactor("LENDER", LENDER_PASSWORD);
    const ownerLenderProfile = await prisma.lenderProfile.create({ data: { userId: ownerLenderUser.id, createdByAdminId: null } });
    await prisma.lenderCompany.create({
      data: {
        lenderProfileId: ownerLenderProfile.id,
        companyName: `Detail Owner Co ${Date.now()}`,
        ein: `78-${Date.now().toString().slice(-7)}`,
        addressLine1: "1 St",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
        createdByUserId: ownerLenderUser.id,
      },
    });
    const ownerAuth = `Bearer ${await issueAccessTokenFor(ownerLenderUser, LENDER_PASSWORD, ownerSecret)}`;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const created = await lenderBorrowersService.createBorrower(ownerLenderUser.id, {
      name: "Detail Borrower",
      email: `detail-borrower-${Date.now()}@test.local`,
    });
    sendEmailSpy.mockRestore();
    const borrowerId = created.borrower.id;

    const ownerGetResponse = await getBorrowerByIdRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ownerAuth }), {
      params: Promise.resolve({ id: borrowerId }),
    });
    expect(ownerGetResponse.status).toBe(200);

    const { user: strangerLenderUser, secret: strangerSecret } = await createTestUserWithTwoFactor("LENDER", LENDER_PASSWORD);
    await prisma.lenderProfile.create({ data: { userId: strangerLenderUser.id, createdByAdminId: null } });
    const strangerAuth = `Bearer ${await issueAccessTokenFor(strangerLenderUser, LENDER_PASSWORD, strangerSecret)}`;

    const strangerGetResponse = await getBorrowerByIdRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: strangerAuth }), {
      params: Promise.resolve({ id: borrowerId }),
    });
    expect(strangerGetResponse.status).toBe(404);

    const removeResponse = await removeBorrowerRoute(jsonRequest("DELETE", "http://localhost/x", undefined, { authorization: ownerAuth }), {
      params: Promise.resolve({ id: borrowerId }),
    });
    expect(removeResponse.status).toBe(200);

    const getAfterRemoveResponse = await getBorrowerByIdRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: ownerAuth }), {
      params: Promise.resolve({ id: borrowerId }),
    });
    expect(getAfterRemoveResponse.status).toBe(404);
  });
});
