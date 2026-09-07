import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  durationToMs,
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  signPendingToken,
  verifyAccessToken,
  verifyPendingToken,
} from "@/auth/jwt";
import { env } from "@/config/env";

const signingKey = new TextEncoder().encode(env.jwtAccessSecret);

describe("auth/jwt (BE-025)", () => {
  it("signAccessToken/verifyAccessToken hacen round-trip con sub y role", async () => {
    const token = await signAccessToken({ sub: "user-1", role: "ADMIN" });
    await expect(verifyAccessToken(token)).resolves.toEqual({ sub: "user-1", role: "ADMIN" });
  });

  it("un token expirado falla la verificación", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ role: "ADMIN" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuedAt(nowSeconds - 120)
      .setExpirationTime(nowSeconds - 60)
      .sign(signingKey);

    await expect(verifyAccessToken(expired)).rejects.toThrow();
  });

  it("un token con la firma manipulada falla la verificación", async () => {
    const token = await signAccessToken({ sub: "user-1", role: "ADMIN" });
    const tampered = `${token.slice(0, -4)}${token.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;

    await expect(verifyAccessToken(tampered)).rejects.toThrow();
  });

  it("verifyPendingToken acepta un pending token propio y devuelve el sub", async () => {
    const pending = await signPendingToken("user-1");
    await expect(verifyPendingToken(pending)).resolves.toEqual({ sub: "user-1" });
  });

  it("un pending token nunca es aceptado como access token, y viceversa", async () => {
    const pending = await signPendingToken("user-1");
    const access = await signAccessToken({ sub: "user-1", role: "LENDER" });

    await expect(verifyAccessToken(pending)).rejects.toThrow();
    await expect(verifyPendingToken(access)).rejects.toThrow();
  });

  it("generateOpaqueToken produce valores únicos; hashOpaqueToken es determinista", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(hashOpaqueToken(a)).toBe(hashOpaqueToken(a));
    expect(hashOpaqueToken(a)).not.toBe(hashOpaqueToken(b));
  });

  it("durationToMs interpreta s/m/h/d", () => {
    expect(durationToMs("30s")).toBe(30_000);
    expect(durationToMs("15m")).toBe(15 * 60_000);
    expect(durationToMs("2h")).toBe(2 * 3_600_000);
    expect(durationToMs("30d")).toBe(30 * 86_400_000);
  });
});
