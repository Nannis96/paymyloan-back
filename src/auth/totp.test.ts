import { describe, expect, it } from "vitest";
import { buildOtpAuthUrl, generateCodeForTesting, generateSecret, verifyCode } from "@/auth/totp";

describe("auth/totp (BE-026)", () => {
  it("un código válido pasa la verificación", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, generateCodeForTesting(secret))).toBe(true);
  });

  it("un código inválido falla", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, "000000")).toBe(false);
  });

  it("un código con drift de 1 step (±30s) todavía pasa — ventana estándar de TOTP", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, generateCodeForTesting(secret, -30))).toBe(true);
    expect(verifyCode(secret, generateCodeForTesting(secret, 30))).toBe(true);
  });

  it("un código con drift de 2 steps (±90s) queda fuera de la ventana", () => {
    const secret = generateSecret();
    expect(verifyCode(secret, generateCodeForTesting(secret, -90))).toBe(false);
    expect(verifyCode(secret, generateCodeForTesting(secret, 90))).toBe(false);
  });

  it("buildOtpAuthUrl arma una URI otpauth:// con el issuer configurado", () => {
    const secret = generateSecret();
    const url = buildOtpAuthUrl("user@example.com", secret);
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain("PayMyLoan");
    expect(url).toContain(secret);
  });
});
