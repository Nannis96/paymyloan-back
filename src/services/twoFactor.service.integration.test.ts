import { afterAll, describe, expect, it } from "vitest";
import { generateCodeForTesting } from "@/auth/totp";
import { prisma } from "@/db/prisma";
import { createTestUserWithPassword, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as twoFactorService from "@/services/twoFactor.service";

const PLAIN_PASSWORD = "SuperSecreta123!";

describe("twoFactor.service (BE-033/034)", () => {
  afterAll(resetPhase1Tables);

  it("setup guarda el secreto sin activar 2FA todavía", async () => {
    const user = await createTestUserWithPassword("LENDER", PLAIN_PASSWORD);
    const result = await twoFactorService.setup(user.id);
    expect(result.otpAuthUrl).toContain("otpauth://totp/");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.isTwoFactorEnabled).toBe(false);
    expect(updated.twoFactorSecret).toBe(result.secret);
  });

  it("verify con código incorrecto no activa 2FA (BE-033)", async () => {
    const user = await createTestUserWithPassword("LENDER", PLAIN_PASSWORD);
    await twoFactorService.setup(user.id);

    const attempt = await twoFactorService.verify(user.id, "000000").catch((e) => e);
    expect(attempt).toBeInstanceOf(AppError);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.isTwoFactorEnabled).toBe(false);
  });

  it("verify exitoso activa 2FA y devuelve exactamente 8 recovery codes, guardados solo como hash (BE-033)", async () => {
    const user = await createTestUserWithPassword("LENDER", PLAIN_PASSWORD);
    const { secret } = await twoFactorService.setup(user.id);

    const codes = await twoFactorService.verify(user.id, generateCodeForTesting(secret));
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.isTwoFactorEnabled).toBe(true);

    const storedCodes = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: user.id } });
    expect(storedCodes).toHaveLength(8);
    for (const stored of storedCodes) {
      expect(codes).not.toContain(stored.codeHash);
    }
  });

  it("disable exige contraseña + código vigente, no solo la sesión (BE-034)", async () => {
    const user = await createTestUserWithPassword("LENDER", PLAIN_PASSWORD);
    const { secret } = await twoFactorService.setup(user.id);
    await twoFactorService.verify(user.id, generateCodeForTesting(secret));

    const withBadPassword = await twoFactorService
      .disable(user.id, "incorrecta", generateCodeForTesting(secret))
      .catch((e) => e);
    expect(withBadPassword).toBeInstanceOf(AppError);

    await twoFactorService.disable(user.id, PLAIN_PASSWORD, generateCodeForTesting(secret));
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.isTwoFactorEnabled).toBe(false);
    expect(updated.twoFactorSecret).toBeNull();

    const remainingCodes = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: user.id } });
    expect(remainingCodes).toHaveLength(0);
  });

  it("regenerateRecoveryCodes invalida los códigos anteriores (BE-034)", async () => {
    const user = await createTestUserWithPassword("LENDER", PLAIN_PASSWORD);
    const { secret } = await twoFactorService.setup(user.id);
    const originalCodes = await twoFactorService.verify(user.id, generateCodeForTesting(secret));

    const regenerated = await twoFactorService.regenerateRecoveryCodes(
      user.id,
      PLAIN_PASSWORD,
      generateCodeForTesting(secret),
    );
    expect(regenerated).toHaveLength(8);
    expect(regenerated).not.toEqual(originalCodes);

    const storedCodes = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: user.id } });
    expect(storedCodes).toHaveLength(8);
  });
});
