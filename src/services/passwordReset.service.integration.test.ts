import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestUserWithPassword, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import * as authService from "@/services/auth.service";
import * as passwordResetService from "@/services/passwordReset.service";

const PLAIN_PASSWORD = "SuperSecreta123!";
const NEW_PASSWORD = "OtraSecreta456!";

describe("passwordReset.service (BE-032)", () => {
  afterAll(resetPhase1Tables);

  it("forgot no lanza para un correo inexistente (anti-enumeración, §7.3)", async () => {
    await expect(passwordResetService.forgotPassword("no-existe@test.local")).resolves.toBeUndefined();
  });

  it("reset con el token del correo cambia la contraseña y revoca todos los refresh tokens (BE-032)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);
    const session = await authService.login({ email: user.email, password: PLAIN_PASSWORD });
    if (session.requiresTwoFactor) throw new Error("unreachable");

    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await passwordResetService.forgotPassword(user.email);
    const resetUrl = sendEmailSpy.mock.calls[0][0].data.resetUrl;
    const token = new URL(resetUrl).searchParams.get("token")!;
    sendEmailSpy.mockRestore();

    await passwordResetService.resetPassword(token, NEW_PASSWORD);

    const oldPasswordLogin = await authService.login({ email: user.email, password: PLAIN_PASSWORD }).catch((e) => e);
    expect(oldPasswordLogin).toBeInstanceOf(AppError);

    const newPasswordLogin = await authService.login({ email: user.email, password: NEW_PASSWORD });
    expect(newPasswordLogin.requiresTwoFactor).toBe(false);

    const refreshAttempt = await authService.refresh({ refreshToken: session.refreshToken }).catch((e) => e);
    expect(refreshAttempt).toBeInstanceOf(AppError);
  });

  it("un token usado dos veces falla la segunda; un token inexistente falla también (BE-032)", async () => {
    const user = await createTestUserWithPassword("BORROWER", PLAIN_PASSWORD);
    const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
    await passwordResetService.forgotPassword(user.email);
    const resetUrl = sendEmailSpy.mock.calls[0][0].data.resetUrl;
    const token = new URL(resetUrl).searchParams.get("token")!;
    sendEmailSpy.mockRestore();

    await passwordResetService.resetPassword(token, NEW_PASSWORD);
    const reuse = await passwordResetService.resetPassword(token, "OtraMas789!").catch((e) => e);
    expect(reuse).toBeInstanceOf(AppError);
    expect((reuse as AppError).code).toBe("INVALID_TOKEN");

    const bogus = await passwordResetService.resetPassword("token-que-no-existe", "Cualquiera123!").catch((e) => e);
    expect(bogus).toBeInstanceOf(AppError);
  });
});
