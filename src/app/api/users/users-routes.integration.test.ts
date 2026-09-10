import { afterAll, describe, expect, it } from "vitest";
import { DELETE, PATCH } from "@/app/api/users/[id]/route";
import { GET, POST } from "@/app/api/users/route";
import { createTestUserWithPassword, createTestUserWithTwoFactor, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";
import { prisma } from "@/db/prisma";
import * as authService from "@/services/auth.service";

// D-P2-4: el CRUD de Fase 0 (antes público) ahora requiere sesión de ADMIN.
// D-P3-1: las escrituras (POST/PATCH/DELETE) además exigen 2FA activo en el
// Admin — por eso estos tests usan `createTestUserWithTwoFactor` +
// `issueAccessTokenFor` en vez de un ADMIN "pelado". `GET` (lectura) sigue
// exento, así que ese test puede seguir usando un ADMIN sin 2FA.
const ADMIN_PASSWORD = "AdminClave123!";
const LENDER_PASSWORD = "LenderClave123!";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("rutas HTTP de /api/users (D-P2-4 — restringidas a ADMIN, D-P3-1 — 2FA obligatorio en escrituras)", () => {
  afterAll(resetPhase1Tables);

  it("GET /api/users sin sesión responde 401; con sesión no-ADMIN responde 403", async () => {
    const lender = await createTestUserWithPassword("LENDER", LENDER_PASSWORD);
    const lenderAuth = `Bearer ${await issueAccessTokenFor(lender, LENDER_PASSWORD)}`;

    const withoutAuth = await GET(jsonRequest("GET", "http://localhost/api/users"));
    expect(withoutAuth.status).toBe(401);

    const asLender = await GET(jsonRequest("GET", "http://localhost/api/users", undefined, { authorization: lenderAuth }));
    expect(asLender.status).toBe(403);
  });

  it("un ADMIN sin 2FA activo puede listar (lectura, exenta) pero no crear (escritura, D-P3-1)", async () => {
    const admin = await createTestUserWithPassword("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD)}`;

    const listResponse = await GET(jsonRequest("GET", "http://localhost/api/users", undefined, { authorization: adminAuth }));
    expect(listResponse.status).toBe(200);

    const createResponse = await POST(
      jsonRequest(
        "POST",
        "http://localhost/api/users",
        { name: "Bloqueado sin 2FA", email: `blocked-${Date.now()}@test.local`, role: "BORROWER" },
        { authorization: adminAuth },
      ),
    );
    expect(createResponse.status).toBe(403);
    const body = await createResponse.json();
    expect(body.error.code).toBe("TWO_FACTOR_REQUIRED");
  });

  it("ADMIN con 2FA activo puede listar, crear (con phone, sin password) y la cuenta nace activa con una contraseña generada", async () => {
    const { user: admin, secret } = await createTestUserWithTwoFactor("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD, secret)}`;

    const listResponse = await GET(jsonRequest("GET", "http://localhost/api/users", undefined, { authorization: adminAuth }));
    expect(listResponse.status).toBe(200);

    const email = `http-users-${Date.now()}@test.local`;
    const createResponse = await POST(
      jsonRequest("POST", "http://localhost/api/users", { name: "HTTP User", email, phone: "5512345678", role: "BORROWER" }, { authorization: adminAuth }),
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.data.phone).toBe("5512345678");
    expect(created.data.isActive).toBe(true);
    expect(created.data.temporaryPassword).toMatch(/^\d{8}$/);

    const login = await authService.login({ email, password: created.data.temporaryPassword });
    expect(login.requiresTwoFactor).toBe(false);

    const patchResponse = await PATCH(
      jsonRequest("PATCH", "http://localhost/api/users/x", { name: "HTTP User Editado" }, { authorization: adminAuth }),
      { params: Promise.resolve({ id: created.data.id }) },
    );
    expect(patchResponse.status).toBe(200);
    const patched = await patchResponse.json();
    expect(patched.data.name).toBe("HTTP User Editado");

    const deleteResponse = await DELETE(
      jsonRequest("DELETE", "http://localhost/api/users/x", undefined, { authorization: adminAuth }),
      { params: Promise.resolve({ id: created.data.id }) },
    );
    expect(deleteResponse.status).toBe(200);
    const deleted = await prisma.user.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("POST /api/users rechaza un teléfono que no tiene exactamente 10 dígitos", async () => {
    const { user: admin, secret } = await createTestUserWithTwoFactor("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD, secret)}`;

    const response = await POST(
      jsonRequest(
        "POST",
        "http://localhost/api/users",
        { name: "Teléfono Malo", email: `bad-phone-${Date.now()}@test.local`, phone: "12345", role: "BORROWER" },
        { authorization: adminAuth },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("PATCH /api/users/:id con isActive:true en un usuario recién creado inactivo devuelve una contraseña temporal utilizable para loguear", async () => {
    const { user: admin, secret } = await createTestUserWithTwoFactor("ADMIN", ADMIN_PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(admin, ADMIN_PASSWORD, secret)}`;

    const email = `http-activate-${Date.now()}@test.local`;
    const createResponse = await POST(
      jsonRequest(
        "POST",
        "http://localhost/api/users",
        { name: "Para Activar", email, role: "BORROWER", isActive: false },
        { authorization: adminAuth },
      ),
    );
    const created = await createResponse.json();
    expect(created.data.temporaryPassword).toBeUndefined();

    const activateResponse = await PATCH(
      jsonRequest("PATCH", "http://localhost/api/users/x", { isActive: true }, { authorization: adminAuth }),
      { params: Promise.resolve({ id: created.data.id }) },
    );
    expect(activateResponse.status).toBe(200);
    const activated = await activateResponse.json();
    expect(activated.data.isActive).toBe(true);
    expect(activated.data.temporaryPassword).toMatch(/^\d{8}$/);

    const login = await authService.login({ email, password: activated.data.temporaryPassword });
    expect(login.requiresTwoFactor).toBe(false);
  });
});
