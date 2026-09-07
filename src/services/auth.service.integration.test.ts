import { afterAll, describe, expect, it } from "vitest";
import { generateCodeForTesting } from "@/auth/totp";
import { prisma } from "@/db/prisma";
import {
  createTestLenderCompany,
  createTestUserWithPassword,
  createTestUserWithTwoFactor,
  resetPhase1Tables,
} from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as authService from "@/services/auth.service";
import * as twoFactorService from "@/services/twoFactor.service";

const PLAIN_PASSWORD = "SuperSecreta123!";

describe("auth.service — login/refresh/logout/me/register (BE-027..031, PB-013/D-P2-1)", () => {
  afterAll(resetPhase1Tables);

  it("login con credenciales válidas y sin 2FA emite access+refresh (BE-027)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);
    const result = await authService.login({ email: user.email, password: PLAIN_PASSWORD });

    if (result.requiresTwoFactor) throw new Error("no debía pedir 2FA");
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.email).toBe(user.email);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.lastLoginAt).not.toBeNull();
  });

  it("correo inexistente y contraseña incorrecta devuelven el mismo 401 (BE-027)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);

    const notFound = await authService.login({ email: "no-existe@test.local", password: "cualquiera1" }).catch((e) => e);
    const badPassword = await authService.login({ email: user.email, password: "incorrecta1" }).catch((e) => e);

    expect(notFound).toBeInstanceOf(AppError);
    expect(badPassword).toBeInstanceOf(AppError);
    expect((notFound as AppError).statusCode).toBe(401);
    expect((badPassword as AppError).statusCode).toBe(401);
    expect((notFound as AppError).code).toBe("INVALID_CREDENTIALS");
    expect((notFound as AppError).message).toBe((badPassword as AppError).message);
  });

  it("una cuenta inactiva no puede iniciar sesión aunque la contraseña sea correcta (D-P1-2)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    const error = await authService.login({ email: user.email, password: PLAIN_PASSWORD }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(403);
    expect((error as AppError).code).toBe("ACCOUNT_INACTIVE");
  });

  it("con 2FA activo, login devuelve pendingToken y loginTwoFactor con el código correcto emite tokens (BE-027/028)", async () => {
    const { user, secret } = await createTestUserWithTwoFactor("LENDER", PLAIN_PASSWORD);

    const step1 = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    if (!step1.requiresTwoFactor) throw new Error("debía pedir 2FA");

    const step2 = await authService.loginTwoFactor({ pendingToken: step1.pendingToken, code: generateCodeForTesting(secret) });
    expect(step2.accessToken).toEqual(expect.any(String));
    expect(step2.user.email).toBe(user.email);
  });

  it("un código de 2FA incorrecto falla y no consume el rate limit de login (BE-028)", async () => {
    const { user, secret } = await createTestUserWithTwoFactor("LENDER", PLAIN_PASSWORD);
    void secret;

    const step1 = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    if (!step1.requiresTwoFactor) throw new Error("debía pedir 2FA");

    const error = await authService.loginTwoFactor({ pendingToken: step1.pendingToken, code: "000000" }).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("INVALID_2FA_CODE");
  });

  it("un recovery code funciona una sola vez para completar el login (BE-028)", async () => {
    const user = await createTestUserWithPassword("LENDER", PLAIN_PASSWORD);
    const setupResult = await twoFactorService.setup(user.id);
    const recoveryCodes = await twoFactorService.verify(user.id, generateCodeForTesting(setupResult.secret));

    const step1 = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    if (!step1.requiresTwoFactor) throw new Error("debía pedir 2FA");
    const success = await authService.loginTwoFactor({ pendingToken: step1.pendingToken, code: recoveryCodes[0] });
    expect(success.accessToken).toEqual(expect.any(String));

    const step1Again = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    if (!step1Again.requiresTwoFactor) throw new Error("debía pedir 2FA");
    const reuse = await authService
      .loginTwoFactor({ pendingToken: step1Again.pendingToken, code: recoveryCodes[0] })
      .catch((e) => e);
    expect(reuse).toBeInstanceOf(AppError);
    expect((reuse as AppError).code).toBe("INVALID_2FA_CODE");
  });

  it("refresh rota el token; reusar uno ya rotado revoca toda la cadena (BE-029)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);
    const initial = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    if (initial.requiresTwoFactor) throw new Error("unreachable");

    const rotated = await authService.refresh({ refreshToken: initial.refreshToken });
    expect(rotated.refreshToken).not.toBe(initial.refreshToken);

    const reuseOriginal = await authService.refresh({ refreshToken: initial.refreshToken }).catch((e) => e);
    expect(reuseOriginal).toBeInstanceOf(AppError);
    expect((reuseOriginal as AppError).code).toBe("INVALID_TOKEN");

    // La cadena completa quedó revocada — incluso el token recién rotado.
    const reuseRotated = await authService.refresh({ refreshToken: rotated.refreshToken }).catch((e) => e);
    expect(reuseRotated).toBeInstanceOf(AppError);
  });

  it("logout revoca solo el refresh token indicado; logoutAll revoca todos (BE-030)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);
    const sessionA = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    const sessionB = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    if (sessionA.requiresTwoFactor || sessionB.requiresTwoFactor) throw new Error("unreachable");

    await authService.logout(sessionA.refreshToken);
    const afterLogoutA = await authService.refresh({ refreshToken: sessionA.refreshToken }).catch((e) => e);
    expect(afterLogoutA).toBeInstanceOf(AppError);

    const stillValidB = await authService.refresh({ refreshToken: sessionB.refreshToken });
    expect(stillValidB.accessToken).toEqual(expect.any(String));

    await authService.logoutAll(user.id);
    const afterLogoutAll = await authService.refresh({ refreshToken: stillValidB.refreshToken }).catch((e) => e);
    expect(afterLogoutAll).toBeInstanceOf(AppError);
  });

  it("getMe devuelve las LenderCompany asociadas al Lender (BE-031, D-P2-2)", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const me = await authService.getMe(lenderUser.id);
    expect(me.lenderProfile?.lenderCompanies.map((c) => c.id)).toContain(lenderCompany.id);
  });

  it("register crea un usuario inactivo sin contraseña utilizable, y responde igual si el correo ya existe (PB-013/D-P2-1)", async () => {
    const email = `self-register-${Date.now()}@test.local`;
    const first = await authService.register({ name: "Nueva Lender", email, role: "LENDER" });
    const second = await authService.register({ name: "Nueva Lender", email, role: "LENDER" });
    expect(first.message).toBe(second.message);

    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(created.isActive).toBe(false);

    const loginAttempt = await authService.login({ email, password: "cualquiera1" }).catch((e) => e);
    expect(loginAttempt).toBeInstanceOf(AppError);

    const lenderProfile = await prisma.lenderProfile.findUnique({ where: { userId: created.id } });
    expect(lenderProfile?.createdByAdminId).toBeNull();

    // No se creó un segundo LenderProfile aunque register() se llamó dos
    // veces para el mismo correo — la segunda llamada fue un no-op.
    const count = await prisma.lenderProfile.count({ where: { userId: created.id } });
    expect(count).toBe(1);
  });

  it("register con rol BORROWER crea un BorrowerProfile sin createdByUserId (D-P1-10)", async () => {
    const email = `self-register-borrower-${Date.now()}@test.local`;
    await authService.register({ name: "Nuevo Borrower", email, role: "BORROWER" });

    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(created.isActive).toBe(false);
    const borrowerProfile = await prisma.borrowerProfile.findUnique({ where: { userId: created.id } });
    expect(borrowerProfile?.createdByUserId).toBeNull();
  });
});
