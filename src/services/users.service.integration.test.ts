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

  it("updateOwnProfile solo toca name/phone, nunca email/password/role/isActive", async () => {
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
});
