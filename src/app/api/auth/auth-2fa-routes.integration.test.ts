import { afterAll, describe, expect, it } from "vitest";
import { POST as setupRoute } from "@/app/api/auth/2fa/setup/route";
import { POST as verifyRoute } from "@/app/api/auth/2fa/verify/route";
import { POST as disableRoute } from "@/app/api/auth/2fa/disable/route";
import { POST as recoveryCodesRoute } from "@/app/api/auth/2fa/recovery-codes/route";
import { generateCodeForTesting } from "@/auth/totp";
import { createTestUserWithPassword, issueAccessTokenFor, resetPhase1Tables } from "@/db/testFixtures";
import { signAccessToken } from "@/auth/jwt";

const LENDER_PASSWORD = "LenderClave123!";

function jsonRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// BE-033/034 a nivel HTTP — el service ya está cubierto a fondo en
// twoFactor.service.integration.test.ts; acá se prueba el wiring real de
// las 4 rutas (auth/rol, parseo, status codes) que ese archivo no toca.
describe("rutas HTTP de /api/auth/2fa/* (BE-033/034)", () => {
  afterAll(resetPhase1Tables);

  it("camino dorado: setup -> verify (8 recovery codes) -> disable -> recovery-codes falla porque ya no hay 2FA", async () => {
    const user = await createTestUserWithPassword("LENDER", LENDER_PASSWORD);
    const auth = `Bearer ${await issueAccessTokenFor(user, LENDER_PASSWORD)}`;

    const setupResponse = await setupRoute(jsonRequest("POST", "http://localhost/api/auth/2fa/setup", undefined, { authorization: auth }));
    expect(setupResponse.status).toBe(200);
    const setupBody = await setupResponse.json();
    const secret = setupBody.data.secret as string;
    expect(setupBody.data.otpAuthUrl).toContain("otpauth://totp/");

    const badVerify = await verifyRoute(jsonRequest("POST", "http://localhost/x", { code: "000000" }, { authorization: auth }));
    expect(badVerify.status).toBe(401);
    const badVerifyBody = await badVerify.json();
    expect(badVerifyBody.error.code).toBe("INVALID_2FA_CODE");

    const verifyResponse = await verifyRoute(jsonRequest("POST", "http://localhost/x", { code: generateCodeForTesting(secret) }, { authorization: auth }));
    expect(verifyResponse.status).toBe(200);
    const verifyBody = await verifyResponse.json();
    expect(verifyBody.data.recoveryCodes).toHaveLength(8);

    const disableWrongPassword = await disableRoute(
      jsonRequest("POST", "http://localhost/x", { password: "incorrecta", code: generateCodeForTesting(secret) }, { authorization: auth }),
    );
    expect(disableWrongPassword.status).toBe(401);

    const disableResponse = await disableRoute(
      jsonRequest("POST", "http://localhost/x", { password: LENDER_PASSWORD, code: generateCodeForTesting(secret) }, { authorization: auth }),
    );
    expect(disableResponse.status).toBe(200);
    expect((await disableResponse.json()).data.disabled).toBe(true);

    const recoveryAfterDisable = await recoveryCodesRoute(
      jsonRequest("POST", "http://localhost/x", { password: LENDER_PASSWORD, code: generateCodeForTesting(secret) }, { authorization: auth }),
    );
    expect(recoveryAfterDisable.status).toBe(409);
    expect((await recoveryAfterDisable.json()).error.code).toBe("TWO_FACTOR_NOT_ENABLED");
  });

  it("regenerateRecoveryCodes por HTTP invalida los códigos anteriores", async () => {
    const user = await createTestUserWithPassword("LENDER", LENDER_PASSWORD);
    const auth = `Bearer ${await issueAccessTokenFor(user, LENDER_PASSWORD)}`;

    const setupResponse = await setupRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: auth }));
    const secret = (await setupResponse.json()).data.secret as string;
    await verifyRoute(jsonRequest("POST", "http://localhost/x", { code: generateCodeForTesting(secret) }, { authorization: auth }));

    const regenerateResponse = await recoveryCodesRoute(
      jsonRequest("POST", "http://localhost/x", { password: LENDER_PASSWORD, code: generateCodeForTesting(secret) }, { authorization: auth }),
    );
    expect(regenerateResponse.status).toBe(200);
    expect((await regenerateResponse.json()).data.recoveryCodes).toHaveLength(8);
  });

  it("sin sesión responde 401; un BORROWER responde 403 (2FA es solo ADMIN/LENDER)", async () => {
    const noAuthResponse = await setupRoute(jsonRequest("POST", "http://localhost/x"));
    expect(noAuthResponse.status).toBe(401);

    const borrowerAuth = `Bearer ${await signAccessToken({ sub: "00000000-0000-0000-0000-000000000000", role: "BORROWER" })}`;
    const forbiddenResponse = await setupRoute(jsonRequest("POST", "http://localhost/x", undefined, { authorization: borrowerAuth }));
    expect(forbiddenResponse.status).toBe(403);
  });

  it("un body que no es JSON válido responde 400 INVALID_JSON", async () => {
    const user = await createTestUserWithPassword("LENDER", LENDER_PASSWORD);
    const auth = `Bearer ${await issueAccessTokenFor(user, LENDER_PASSWORD)}`;

    const response = await verifyRoute(
      new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: "{not-json" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
  });
});
