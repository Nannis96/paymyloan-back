import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as activateRoute } from "@/app/api/admin/users/[id]/activate/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { prisma } from "@/db/prisma";
import { createTestUserWithPassword, resetPhase1Tables } from "@/db/testFixtures";
import * as emailLib from "@/lib/email";
import { resetRateLimitStore } from "@/middlewares/rateLimit";

// Primeras pruebas de este repo que invocan los route handlers de verdad
// (no el service ni Prisma directo) — cierran la brecha que señalaba
// Docs/plan/11-testing.md: hoy no había ningún test a nivel HTTP.
const PLAIN_PASSWORD = "SuperSecreta123!";

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("rutas HTTP de /api/auth y /api/admin/users (BE-027..032, BE-097)", () => {
  beforeEach(() => resetRateLimitStore());
  afterAll(resetPhase1Tables);

  it("POST /api/auth/register responde 202 con un mensaje genérico", async () => {
    const email = `http-register-${Date.now()}@test.local`;
    const response = await registerRoute(
      jsonRequest("http://localhost/api/auth/register", { name: "HTTP Lender", email, role: "LENDER" }),
    );
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toEqual(expect.any(String));
  });

  it("POST /api/auth/register con un rol no auto-registrable falla la validación", async () => {
    const response = await registerRoute(
      jsonRequest("http://localhost/api/auth/register", {
        name: "Admin Falso",
        email: `http-register-admin-${Date.now()}@test.local`,
        role: "ADMIN",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("POST /api/auth/login responde 401 idéntico para correo inexistente y contraseña incorrecta (BE-027)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);

    const notFound = await loginRoute(
      jsonRequest(
        "http://localhost/api/auth/login",
        { email: "nadie@test.local", password: "cualquiera1" },
        { "x-forwarded-for": "10.0.0.1" },
      ),
    );
    const badPassword = await loginRoute(
      jsonRequest(
        "http://localhost/api/auth/login",
        { email: user.email, password: "incorrecta1" },
        { "x-forwarded-for": "10.0.0.2" },
      ),
    );

    expect(notFound.status).toBe(401);
    expect(badPassword.status).toBe(401);
    const notFoundBody = await notFound.json();
    const badPasswordBody = await badPassword.json();
    expect(notFoundBody.error.code).toBe("INVALID_CREDENTIALS");
    expect(notFoundBody.error.message).toBe(badPasswordBody.error.message);
  });

  it("el 6º intento de login desde la misma IP responde 429 (BE-005/027)", async () => {
    const ip = "10.0.0.99";
    for (let i = 0; i < 5; i++) {
      const response = await loginRoute(
        jsonRequest(
          "http://localhost/api/auth/login",
          { email: "nadie@test.local", password: "cualquiera1" },
          { "x-forwarded-for": ip },
        ),
      );
      expect(response.status).toBe(401);
    }

    const sixth = await loginRoute(
      jsonRequest(
        "http://localhost/api/auth/login",
        { email: "nadie@test.local", password: "cualquiera1" },
        { "x-forwarded-for": ip },
      ),
    );
    expect(sixth.status).toBe(429);
    const body = await sixth.json();
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("camino dorado: registro → activación por Admin → login con la contraseña emitida por correo → /me (D-P2-1)", async () => {
    const admin = await createTestUserWithPassword("ADMIN", PLAIN_PASSWORD);
    const adminLoginResponse = await loginRoute(
      jsonRequest(
        "http://localhost/api/auth/login",
        { email: admin.email, password: PLAIN_PASSWORD },
        { "x-forwarded-for": "10.0.2.1" },
      ),
    );
    expect(adminLoginResponse.status).toBe(200);
    const adminLoginBody = await adminLoginResponse.json();
    const adminAccessToken = adminLoginBody.data.accessToken as string;

    const lenderEmail = `http-golden-${Date.now()}@test.local`;
    const registerResponse = await registerRoute(
      jsonRequest("http://localhost/api/auth/register", { name: "Golden Lender", email: lenderEmail, role: "LENDER" }),
    );
    expect(registerResponse.status).toBe(202);
    const created = await prisma.user.findUniqueOrThrow({ where: { email: lenderEmail } });
    expect(created.isActive).toBe(false);

    // Antes de activar, el login debe fallar — la cuenta nace inactiva
    // (riesgo #20 resuelto por D-P2-1).
    const loginBeforeActivation = await loginRoute(
      jsonRequest(
        "http://localhost/api/auth/login",
        { email: lenderEmail, password: "cualquiera1" },
        { "x-forwarded-for": "10.0.2.9" },
      ),
    );
    expect(loginBeforeActivation.status).toBe(401);

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const activateResponse = await activateRoute(
      new Request(`http://localhost/api/admin/users/${created.id}/activate`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminAccessToken}` },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(activateResponse.status).toBe(200);
    const activateBody = await activateResponse.json();
    expect(activateBody.data.emailSent).toBe(true);

    const temporaryPassword = sendEmailSpy.mock.calls[0][0].data.temporaryPassword as string;
    sendEmailSpy.mockRestore();

    const lenderLoginResponse = await loginRoute(
      jsonRequest(
        "http://localhost/api/auth/login",
        { email: lenderEmail, password: temporaryPassword },
        { "x-forwarded-for": "10.0.2.2" },
      ),
    );
    expect(lenderLoginResponse.status).toBe(200);
    const lenderLoginBody = await lenderLoginResponse.json();

    const meResponse = await meRoute(
      new Request("http://localhost/api/auth/me", {
        headers: { authorization: `Bearer ${lenderLoginBody.data.accessToken}` },
      }),
    );
    expect(meResponse.status).toBe(200);
    const meBody = await meResponse.json();
    expect(meBody.data.user.email).toBe(lenderEmail);
  });

  it("/api/admin/users/:id/activate requiere sesión de ADMIN", async () => {
    const lender = await createTestUserWithPassword("LENDER", PLAIN_PASSWORD);
    const lenderLoginResponse = await loginRoute(
      jsonRequest(
        "http://localhost/api/auth/login",
        { email: lender.email, password: PLAIN_PASSWORD },
        { "x-forwarded-for": "10.0.3.1" },
      ),
    );
    const lenderLoginBody = await lenderLoginResponse.json();

    const response = await activateRoute(
      new Request(`http://localhost/api/admin/users/${lender.id}/activate`, {
        method: "POST",
        headers: { authorization: `Bearer ${lenderLoginBody.data.accessToken}` },
      }),
      { params: Promise.resolve({ id: lender.id }) },
    );
    expect(response.status).toBe(403);

    const withoutAuth = await activateRoute(
      new Request(`http://localhost/api/admin/users/${lender.id}/activate`, { method: "POST" }),
      { params: Promise.resolve({ id: lender.id }) },
    );
    expect(withoutAuth.status).toBe(401);
  });
});
