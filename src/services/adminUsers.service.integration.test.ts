import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestAdmin, resetPhase1Tables } from "@/db/testFixtures";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import * as adminUsersService from "@/services/adminUsers.service";
import * as authService from "@/services/auth.service";

describe("adminUsers.service — activate/deactivate (BE-097, D-P2-1/riesgo #20)", () => {
  afterAll(resetPhase1Tables);

  it("activar por primera vez genera y envía una contraseña temporal que sirve para loguear", async () => {
    const admin = await createTestAdmin();
    const email = `activation-${Date.now()}@test.local`;
    await authService.register({ name: "Nuevo Lender", email, role: "LENDER" });
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    const result = await adminUsersService.activateUser(created.id, admin.id);

    expect(result.user.isActive).toBe(true);
    expect(result.emailSent).toBe(true);
    expect(sendEmailSpy).toHaveBeenCalledWith(expect.objectContaining({ to: email, template: "account-activated" }));

    const temporaryPassword = sendEmailSpy.mock.calls[0][0].data.temporaryPassword;
    sendEmailSpy.mockRestore();

    const login = await authService.login({ email, password: temporaryPassword });
    expect(login.requiresTwoFactor).toBe(false);
  });

  it("reactivar a alguien que ya inició sesión no toca la contraseña ni reenvía correo", async () => {
    const admin = await createTestAdmin();
    const email = `reactivate-${Date.now()}@test.local`;
    await authService.register({ name: "Otro Lender", email, role: "LENDER" });
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await adminUsersService.activateUser(created.id, admin.id);
    const temporaryPassword = sendEmailSpy.mock.calls[0][0].data.temporaryPassword;
    await authService.login({ email, password: temporaryPassword }); // marca lastLoginAt

    await adminUsersService.deactivateUser(created.id, admin.id);
    sendEmailSpy.mockClear();
    const second = await adminUsersService.activateUser(created.id, admin.id);
    sendEmailSpy.mockRestore();

    expect(second.emailSent).toBe(false);
    expect(sendEmailSpy).not.toHaveBeenCalled();

    const loginStillWorks = await authService.login({ email, password: temporaryPassword });
    expect(loginStillWorks.requiresTwoFactor).toBe(false);
  });

  it("deactivate revoca los refresh tokens vigentes del usuario", async () => {
    const admin = await createTestAdmin();
    const email = `deactivate-${Date.now()}@test.local`;
    await authService.register({ name: "Lender a desactivar", email, role: "LENDER" });
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await adminUsersService.activateUser(created.id, admin.id);
    const temporaryPassword = sendEmailSpy.mock.calls[0][0].data.temporaryPassword;
    sendEmailSpy.mockRestore();

    const session = await authService.login({ email, password: temporaryPassword });
    if (session.requiresTwoFactor) throw new Error("unreachable");

    await adminUsersService.deactivateUser(created.id, admin.id);

    const refreshAttempt = await authService.refresh({ refreshToken: session.refreshToken }).catch((e) => e);
    expect(refreshAttempt).toBeInstanceOf(AppError);

    const loginAttempt = await authService.login({ email, password: temporaryPassword }).catch((e) => e);
    expect(loginAttempt).toBeInstanceOf(AppError);
    expect((loginAttempt as AppError).code).toBe("ACCOUNT_INACTIVE");
  });

  it("activate/deactivate sobre un id inexistente responde USER_NOT_FOUND", async () => {
    const admin = await createTestAdmin();
    const error = await adminUsersService
      .activateUser("00000000-0000-0000-0000-000000000000", admin.id)
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(404);
  });
});
