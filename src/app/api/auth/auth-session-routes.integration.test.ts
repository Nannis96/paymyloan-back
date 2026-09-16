import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as refreshRoute } from "@/app/api/auth/refresh/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { POST as logoutAllRoute } from "@/app/api/auth/logout-all/route";
import { POST as forgotPasswordRoute } from "@/app/api/auth/password/forgot/route";
import { POST as resetPasswordRoute } from "@/app/api/auth/password/reset/route";
import { POST as deactivateRoute } from "@/app/api/admin/users/[id]/deactivate/route";
import { createTestAdmin, createTestUserWithPassword, createTestUserWithTwoFactor, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";
import * as emailLib from "@/lib/email";
import { resetRateLimitStore } from "@/middlewares/rateLimit";

const PASSWORD = "SuperSecreta123!";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function loginViaHttp(email: string, password: string) {
  const response = await loginRoute(jsonRequest("POST", "http://localhost/api/auth/login", { email, password }));
  return response.json();
}

// BE-029/030/032/097 a nivel HTTP — el service ya está probado a fondo en
// auth.service.integration.test.ts y passwordReset.service.integration.test.ts;
// acá se prueba que las rutas reales (parseo de body, wiring a getRequestMeta,
// status codes) se comportan igual que el service.
describe("rutas HTTP de /api/auth/refresh, logout(-all), password/*, admin deactivate", () => {
  afterAll(resetPhase1Tables);
  beforeEach(() => resetRateLimitStore());

  it("refresh por HTTP rota el token; reusar el original devuelve 401 y revoca la cadena", async () => {
    const user = await createTestUserWithPassword("BORROWER", PASSWORD);
    const loginBody = await loginViaHttp(user.email, PASSWORD);
    const originalRefreshToken = loginBody.data.refreshToken as string;

    const rotateResponse = await refreshRoute(jsonRequest("POST", "http://localhost/api/auth/refresh", { refreshToken: originalRefreshToken }));
    expect(rotateResponse.status).toBe(200);
    const rotated = await rotateResponse.json();
    expect(rotated.data.refreshToken).not.toBe(originalRefreshToken);

    const reuseResponse = await refreshRoute(jsonRequest("POST", "http://localhost/x", { refreshToken: originalRefreshToken }));
    expect(reuseResponse.status).toBe(401);
    expect((await reuseResponse.json()).error.code).toBe("INVALID_TOKEN");

    const reuseRotatedResponse = await refreshRoute(jsonRequest("POST", "http://localhost/x", { refreshToken: rotated.data.refreshToken }));
    expect(reuseRotatedResponse.status).toBe(401);
  });

  it("logout por HTTP revoca solo ese refresh token; logout-all revoca todos los del usuario", async () => {
    const user = await createTestUserWithPassword("BORROWER", PASSWORD);
    const auth = `Bearer ${await issueAccessTokenFor(user, PASSWORD)}`;
    const sessionA = await loginViaHttp(user.email, PASSWORD);
    const sessionB = await loginViaHttp(user.email, PASSWORD);

    const logoutResponse = await logoutRoute(
      jsonRequest("POST", "http://localhost/api/auth/logout", { refreshToken: sessionA.data.refreshToken }, { authorization: auth }),
    );
    expect(logoutResponse.status).toBe(200);
    expect((await logoutResponse.json()).data.loggedOut).toBe(true);

    const refreshAfterLogout = await refreshRoute(jsonRequest("POST", "http://localhost/x", { refreshToken: sessionA.data.refreshToken }));
    expect(refreshAfterLogout.status).toBe(401);

    const stillValid = await refreshRoute(jsonRequest("POST", "http://localhost/x", { refreshToken: sessionB.data.refreshToken }));
    expect(stillValid.status).toBe(200);
    const rotatedB = await stillValid.json();

    const logoutAllResponse = await logoutAllRoute(jsonRequest("POST", "http://localhost/api/auth/logout-all", undefined, { authorization: auth }));
    expect(logoutAllResponse.status).toBe(200);

    const refreshAfterLogoutAll = await refreshRoute(jsonRequest("POST", "http://localhost/x", { refreshToken: rotatedB.data.refreshToken }));
    expect(refreshAfterLogoutAll.status).toBe(401);
  });

  it("logout sin sesión responde 401 (no basta con mandar el refreshToken)", async () => {
    const response = await logoutRoute(jsonRequest("POST", "http://localhost/x", { refreshToken: "cualquiera" }));
    expect(response.status).toBe(401);
  });

  it("password forgot/reset por HTTP: siempre 200 (anti-enumeración), y el token del correo cambia la contraseña", async () => {
    const user = await createTestUserWithPassword("BORROWER", PASSWORD);

    const forgotUnknown = await forgotPasswordRoute(jsonRequest("POST", "http://localhost/api/auth/password/forgot", { email: "no-existe@test.local" }));
    expect(forgotUnknown.status).toBe(200);

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const forgotResponse = await forgotPasswordRoute(jsonRequest("POST", "http://localhost/x", { email: user.email }));
    expect(forgotResponse.status).toBe(200);
    const resetUrl = sendEmailSpy.mock.calls[0][0].data.resetUrl as string;
    const token = new URL(resetUrl).searchParams.get("token")!;
    sendEmailSpy.mockRestore();

    const NEW_PASSWORD = "OtraSecreta456!";
    const resetResponse = await resetPasswordRoute(jsonRequest("POST", "http://localhost/api/auth/password/reset", { token, newPassword: NEW_PASSWORD }));
    expect(resetResponse.status).toBe(200);

    const oldLogin = await loginRoute(jsonRequest("POST", "http://localhost/x", { email: user.email, password: PASSWORD }));
    expect(oldLogin.status).toBe(401);

    const newLogin = await loginRoute(jsonRequest("POST", "http://localhost/x", { email: user.email, password: NEW_PASSWORD }));
    expect(newLogin.status).toBe(200);

    const reuseTokenResponse = await resetPasswordRoute(jsonRequest("POST", "http://localhost/x", { token, newPassword: "Otra789!" }));
    expect(reuseTokenResponse.status).toBe(400);
    expect((await reuseTokenResponse.json()).error.code).toBe("INVALID_TOKEN");
  });

  it("admin deactivate por HTTP revoca los refresh tokens vigentes del usuario", async () => {
    const { user: adminUser, secret } = await createTestUserWithTwoFactor("ADMIN", PASSWORD);
    const adminAuth = `Bearer ${await issueAccessTokenFor(adminUser, PASSWORD, secret)}`;

    const target = await createTestUserWithPassword("LENDER", PASSWORD);
    const targetLogin = await loginViaHttp(target.email, PASSWORD);

    const deactivateResponse = await deactivateRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: adminAuth }), {
      params: Promise.resolve({ id: target.id }),
    });
    expect(deactivateResponse.status).toBe(200);

    const refreshAfterDeactivate = await refreshRoute(jsonRequest("POST", "http://localhost/x", { refreshToken: targetLogin.data.refreshToken }));
    expect(refreshAfterDeactivate.status).toBe(401);

    const loginAfterDeactivate = await loginRoute(jsonRequest("POST", "http://localhost/x", { email: target.email, password: PASSWORD }));
    expect(loginAfterDeactivate.status).toBe(403);
    expect((await loginAfterDeactivate.json()).error.code).toBe("ACCOUNT_INACTIVE");
  });

  it("un LENDER no puede desactivar usuarios (403 FORBIDDEN)", async () => {
    const lender = await createTestUserWithPassword("LENDER", PASSWORD);
    const lenderAuth = `Bearer ${await issueAccessTokenFor(lender, PASSWORD)}`;
    const target = await createTestAdmin();

    const response = await deactivateRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: lenderAuth }), {
      params: Promise.resolve({ id: target.id }),
    });
    expect(response.status).toBe(403);
  });
});
