import { SignJWT } from "jose";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as loginTwoFactorRoute } from "@/app/api/auth/login/2fa/route";
import { POST as forgotPasswordRoute } from "@/app/api/auth/password/forgot/route";
import { signAccessToken } from "@/auth/jwt";
import { generateCodeForTesting } from "@/auth/totp";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { createTestUserWithPassword, createTestUserWithTwoFactor, resetPhase1Tables } from "@/db/testFixtures";
import * as twoFactorService from "@/services/twoFactor.service";
import { resetRateLimitStore } from "@/middlewares/rateLimit";

const PASSWORD = "SuperSecreta123!";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// BE-079 — rate limit, JWT manipulado, tokens reusados, todo a nivel HTTP
// real (no solo la función pura de checkRateLimit ni el middleware withAuth
// aislado, ya cubiertos en rateLimit.test.ts / withAuth.test.ts / jwt.test.ts
// / auth.service.integration.test.ts). Esta suite confirma que el wiring
// real de las rutas sostiene esas garantías de punta a punta.
describe("BE-079 — suite de seguridad negativa", () => {
  afterAll(resetPhase1Tables);
  beforeEach(() => resetRateLimitStore());

  it("POST /api/auth/login: al superar RATE_LIMIT_LOGIN_MAX intentos responde 429 RATE_LIMITED", async () => {
    const user = await createTestUserWithPassword("BORROWER", PASSWORD);

    for (let i = 0; i < env.rateLimitLoginMax; i++) {
      const attempt = await loginRoute(jsonRequest("POST", "http://localhost/api/auth/login", { email: user.email, password: "incorrecta" }));
      expect(attempt.status).toBe(401);
    }

    const blocked = await loginRoute(jsonRequest("POST", "http://localhost/x", { email: user.email, password: "incorrecta" }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("RATE_LIMITED");

    // Ni siquiera la contraseña correcta pasa una vez agotado el cupo — el
    // bucket es por IP, no por resultado del intento anterior.
    const correctButBlocked = await loginRoute(jsonRequest("POST", "http://localhost/x", { email: user.email, password: PASSWORD }));
    expect(correctButBlocked.status).toBe(429);
  });

  it("POST /api/auth/login/2fa tiene su propio bucket de rate limit, independiente de /login (BE-028)", async () => {
    const { user, secret } = await createTestUserWithTwoFactor("LENDER", PASSWORD);
    const step1 = await loginRoute(jsonRequest("POST", "http://localhost/api/auth/login", { email: user.email, password: PASSWORD }));
    const pendingToken = (await step1.json()).data.pendingToken as string;

    for (let i = 0; i < env.rateLimitLoginMax; i++) {
      const attempt = await loginTwoFactorRoute(jsonRequest("POST", "http://localhost/x", { pendingToken, code: "000000" }));
      expect(attempt.status).toBe(401);
    }

    const blocked = await loginTwoFactorRoute(jsonRequest("POST", "http://localhost/x", { pendingToken, code: generateCodeForTesting(secret) }));
    expect(blocked.status).toBe(429);

    // El bucket de /login normal sigue intacto — agotar el de 2FA no lo
    // consume (BE-028: buckets separados a propósito).
    const freshLogin = await loginRoute(jsonRequest("POST", "http://localhost/x", { email: user.email, password: PASSWORD }));
    expect(freshLogin.status).toBe(200);
  });

  it("POST /api/auth/password/forgot también respeta su propio rate limit por IP", async () => {
    for (let i = 0; i < env.rateLimitLoginMax; i++) {
      const attempt = await forgotPasswordRoute(jsonRequest("POST", "http://localhost/api/auth/password/forgot", { email: `no-existe-${i}@test.local` }));
      expect(attempt.status).toBe(200);
    }

    const blocked = await forgotPasswordRoute(jsonRequest("POST", "http://localhost/x", { email: "otro-mas@test.local" }));
    expect(blocked.status).toBe(429);
  });

  it("un access token con la firma manipulada es rechazado por una ruta protegida real (GET /api/auth/me)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PASSWORD);
    const token = await signAccessToken({ sub: user.id, role: "BORROWER", roles: ["BORROWER"] });
    const tampered = `${token.slice(0, -4)}${token.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;

    const response = await meRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: `Bearer ${tampered}` }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("INVALID_TOKEN");
  });

  it("un access token expirado es rechazado por una ruta protegida real", async () => {
    const user = await createTestUserWithPassword("BORROWER", PASSWORD);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const signingKey = new TextEncoder().encode(env.jwtAccessSecret);
    const expired = await new SignJWT({ role: "BORROWER" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt(nowSeconds - 120)
      .setExpirationTime(nowSeconds - 60)
      .sign(signingKey);

    const response = await meRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: `Bearer ${expired}` }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("INVALID_TOKEN");
  });

  it("el pendingToken de 2FA nunca sirve como access token en una ruta protegida real", async () => {
    const { user, secret } = await createTestUserWithTwoFactor("LENDER", PASSWORD);
    void secret;
    const step1 = await loginRoute(jsonRequest("POST", "http://localhost/api/auth/login", { email: user.email, password: PASSWORD }));
    const pendingToken = (await step1.json()).data.pendingToken as string;

    const response = await meRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: `Bearer ${pendingToken}` }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("INVALID_TOKEN");
  });

  it("un recovery code de 2FA usado una vez no puede reutilizarse para completar otro login (a nivel HTTP)", async () => {
    const user = await createTestUserWithPassword("LENDER", PASSWORD);
    const setupResult = await twoFactorService.setup(user.id);
    const recoveryCodes = await twoFactorService.verify(user.id, generateCodeForTesting(setupResult.secret));

    const step1 = await loginRoute(jsonRequest("POST", "http://localhost/api/auth/login", { email: user.email, password: PASSWORD }));
    const pendingToken = (await step1.json()).data.pendingToken as string;
    const firstUse = await loginTwoFactorRoute(jsonRequest("POST", "http://localhost/x", { pendingToken, code: recoveryCodes[0] }));
    expect(firstUse.status).toBe(200);

    const step1Again = await loginRoute(jsonRequest("POST", "http://localhost/x", { email: user.email, password: PASSWORD }));
    const pendingTokenAgain = (await step1Again.json()).data.pendingToken as string;
    const reuse = await loginTwoFactorRoute(jsonRequest("POST", "http://localhost/x", { pendingToken: pendingTokenAgain, code: recoveryCodes[0] }));
    expect(reuse.status).toBe(401);
    expect((await reuse.json()).error.code).toBe("INVALID_2FA_CODE");
  });

  it("un usuario borrado con un access token todavía sin expirar es rechazado por la ruta protegida (USER_NOT_FOUND)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PASSWORD);
    const token = await signAccessToken({ sub: user.id, role: "BORROWER", roles: ["BORROWER"] });

    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    const response = await meRoute(jsonRequest("GET", "http://localhost/x", undefined, { authorization: `Bearer ${token}` }));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("USER_NOT_FOUND");
  });
});
