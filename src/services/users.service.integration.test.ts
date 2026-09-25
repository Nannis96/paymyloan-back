import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestAdmin, createTestUserWithPassword, resetPhase1Tables } from "@/db/testFixtures";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import * as authService from "@/services/auth.service";
import * as usersService from "@/services/users.service";

describe("users.service — CRUD de Fase 0 con phone/isActive/sin password (D-P2-4/D-P2-5)", () => {
  afterAll(resetPhase1Tables);

  it("createUser con isActive:false explícito no pide ni genera contraseña", async () => {
    const admin = await createTestAdmin();
    const email = `create-inactive-${Date.now()}@test.local`;
    const user = await usersService.createUser({ name: "Con Teléfono", email, phone: "5512345678", role: "BORROWER", isActive: false }, admin.id);

    expect(user.phone).toBe("5512345678");
    expect(user.isActive).toBe(false);
    expect(user.temporaryPassword).toBeUndefined();

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.password).toEqual(expect.any(String));
    // La contraseña placeholder es un valor aleatorio inutilizable — nadie
    // puede loguear con ella (D-P2-5, mismo patrón que el auto-registro).
    const attempt = await authService.login({ email, password: "cualquier-cosa" }).catch((e) => e);
    expect(attempt).toBeInstanceOf(AppError);
  });

  it("createUser sin isActive (o con isActive:true) genera y devuelve una contraseña temporal de 8 dígitos que sirve para loguear (D-P2-5)", async () => {
    const admin = await createTestAdmin();
    const email = `create-default-${Date.now()}@test.local`;

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const user = await usersService.createUser({ name: "Default Activo", email, role: "BORROWER" }, admin.id);
    sendEmailSpy.mockRestore();

    expect(user.isActive).toBe(true);
    expect(user.temporaryPassword).toMatch(/^\d{8}$/);
    expect(user.emailSent).toBe(true);

    const login = await authService.login({ email, password: user.temporaryPassword! });
    expect(login.requiresTwoFactor).toBe(false);
  });

  it("updateUser transiciona isActive false→true como una primera activación: genera y devuelve una contraseña temporal, y esa contraseña sirve para loguear", async () => {
    const admin = await createTestAdmin();
    const email = `patch-activate-${Date.now()}@test.local`;
    const user = await usersService.createUser({ name: "Inactivo Fase 0", email, role: "BORROWER", isActive: false }, admin.id);

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const result = await usersService.updateUser(user.id, { isActive: true }, admin.id);
    sendEmailSpy.mockRestore();

    expect(result.isActive).toBe(true);
    expect(result.temporaryPassword).toMatch(/^\d{8}$/);
    expect(result.emailSent).toBe(true);

    const login = await authService.login({ email, password: result.temporaryPassword! });
    expect(login.requiresTwoFactor).toBe(false);
  });

  it("un password explícito junto con isActive:true (primera activación) se ignora — gana la contraseña generada", async () => {
    const admin = await createTestAdmin();
    const email = `patch-activate-ignore-password-${Date.now()}@test.local`;
    const user = await usersService.createUser({ name: "Inactivo con password explícito", email, role: "BORROWER", isActive: false }, admin.id);

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const result = await usersService.updateUser(user.id, { isActive: true, password: "IntentoExplicito123!" }, admin.id);
    sendEmailSpy.mockRestore();

    const explicitAttempt = await authService.login({ email, password: "IntentoExplicito123!" }).catch((e) => e);
    expect(explicitAttempt).toBeInstanceOf(AppError);

    const login = await authService.login({ email, password: result.temporaryPassword! });
    expect(login.requiresTwoFactor).toBe(false);
  });

  it("updateUser transiciona isActive true→false y revoca los refresh tokens vigentes", async () => {
    const admin = await createTestAdmin();
    const user = await createTestUserWithPassword("BORROWER", "ClaveValida123!");
    const session = await authService.login({ email: user.email, password: "ClaveValida123!" });
    if (session.requiresTwoFactor) throw new Error("unreachable");

    await usersService.updateUser(user.id, { isActive: false }, admin.id);

    const refreshAttempt = await authService.refresh({ refreshToken: session.refreshToken }).catch((e) => e);
    expect(refreshAttempt).toBeInstanceOf(AppError);
  });

  it("updateUser sin cambio real de isActive no dispara una nueva generación de contraseña", async () => {
    const admin = await createTestAdmin();
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const user = await usersService.createUser(
      { name: "Ya Activo", email: `patch-noop-${Date.now()}@test.local`, role: "BORROWER", isActive: true },
      admin.id,
    );
    sendEmailSpy.mockRestore();
    expect(user.temporaryPassword).toEqual(expect.any(String));

    const result = await usersService.updateUser(user.id, { isActive: true, name: "Ya Activo (editado)" }, admin.id);
    expect(result.temporaryPassword).toBeUndefined();
    expect(result.name).toBe("Ya Activo (editado)");
  });

  it("updateOwnProfile solo toca name/phone si no se manda email — nunca password/role/isActive (D-P2-4)", async () => {
    const admin = await createTestAdmin();
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const user = await usersService.createUser(
      { name: "Perfil Propio", email: `own-profile-${Date.now()}@test.local`, phone: "5500000000", role: "BORROWER" },
      admin.id,
    );
    sendEmailSpy.mockRestore();

    const updated = await usersService.updateOwnProfile(user.id, { name: "Nombre Actualizado", phone: "5511111111" });
    expect(updated.name).toBe("Nombre Actualizado");
    expect(updated.phone).toBe("5511111111");
    expect(updated.email).toBe(user.email);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.role).toBe("BORROWER");
    expect(stored.isActive).toBe(true);
  });

  it("updateOwnProfile cambia el email con currentPassword correcta, revoca los refresh tokens vigentes y audita (D-P2-7)", async () => {
    const PLAIN_PASSWORD = "ClaveOriginal123!";
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);
    const session = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    if (session.requiresTwoFactor) throw new Error("unreachable");

    const newEmail = `nuevo-correo-${Date.now()}@test.local`;
    const updated = await usersService.updateOwnProfile(user.id, { email: newEmail, currentPassword: PLAIN_PASSWORD });
    expect(updated.email).toBe(newEmail);

    // La sesión previa a cambiar el correo queda revocada — no solo el
    // acceso, la posibilidad de renovarlo (D-P2-7, mismo criterio que
    // changeOwnPassword/resetPassword).
    const refreshAttempt = await authService.refresh({ refreshToken: session.refreshToken }).catch((e) => e);
    expect(refreshAttempt).toBeInstanceOf(AppError);

    const loginWithNewEmail = await authService.login({ email: newEmail, password: PLAIN_PASSWORD });
    expect(loginWithNewEmail.requiresTwoFactor).toBe(false);

    const auditEntry = await prisma.auditLog.findFirst({ where: { entityId: user.id, action: "USER_EMAIL_CHANGED" } });
    expect(auditEntry?.metadata).toMatchObject({ oldEmail: user.email, newEmail });
  });

  it("updateOwnProfile con currentPassword incorrecta al cambiar el email responde 401 y no toca nada", async () => {
    const PLAIN_PASSWORD = "ClaveOriginal123!";
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);

    const attempt = await usersService
      .updateOwnProfile(user.id, { email: `otro-${Date.now()}@test.local`, currentPassword: "incorrecta1" })
      .catch((e) => e);
    expect(attempt).toBeInstanceOf(AppError);
    expect((attempt as AppError).statusCode).toBe(401);
    expect((attempt as AppError).code).toBe("INVALID_CREDENTIALS");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.email).toBe(user.email);
  });

  it("updateOwnProfile sin currentPassword al mandar email responde 400 (defensa aparte de la validación de Zod)", async () => {
    const PLAIN_PASSWORD = "ClaveOriginal123!";
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);

    const attempt = await usersService.updateOwnProfile(user.id, { email: `sin-password-${Date.now()}@test.local` }).catch((e) => e);
    expect(attempt).toBeInstanceOf(AppError);
    expect((attempt as AppError).statusCode).toBe(400);
  });

  it("updateOwnProfile rechaza un email ya tomado por otro usuario (409 EMAIL_TAKEN)", async () => {
    const PLAIN_PASSWORD = "ClaveOriginal123!";
    const taken = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);

    const attempt = await usersService
      .updateOwnProfile(user.id, { email: taken.email, currentPassword: PLAIN_PASSWORD })
      .catch((e) => e);
    expect(attempt).toBeInstanceOf(AppError);
    expect((attempt as AppError).code).toBe("EMAIL_TAKEN");
  });
});
