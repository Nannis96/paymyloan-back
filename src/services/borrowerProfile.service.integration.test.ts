import { afterAll, describe, expect, it, vi } from "vitest";
import { createTestLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import * as authService from "@/services/auth.service";
import * as borrowerProfileService from "@/services/borrowerProfile.service";
import * as lenderBorrowersService from "@/services/lenderBorrowers.service";

async function createActiveBorrowerWithPassword() {
  const { lenderUser, lenderCompany } = await createTestLenderCompany();
  const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
  const created = await lenderBorrowersService.createBorrower(lenderUser.id, {
    name: "Self Service Borrower",
    email: `self-service-${Date.now()}@test.local`,
  });
  const temporaryPassword = sendEmailSpy.mock.calls[0][0].data.temporaryPassword as string;
  sendEmailSpy.mockRestore();
  return { userId: created.borrower.user.id, email: created.borrower.user.email, temporaryPassword, lenderCompany };
}

describe("borrowerProfile.service (BE-050, D-P4-2)", () => {
  afterAll(resetPhase1Tables);

  it("un deudor recién creado tiene mustChangePassword:true", async () => {
    const { userId } = await createActiveBorrowerWithPassword();
    const profile = await borrowerProfileService.getOwnProfile(userId);
    expect(profile.user.mustChangePassword).toBe(true);
  });

  it("getOwnProfile/updateOwnProfile editan los campos de contacto propios", async () => {
    const { userId, lenderCompany } = await createActiveBorrowerWithPassword();

    const own = await borrowerProfileService.getOwnProfile(userId);
    expect(own.lenderCompanies.map((c) => c.id)).toContain(lenderCompany.id);

    const updated = await borrowerProfileService.updateOwnProfile(userId, { phone: "5512345678", city: "Austin" });
    expect(updated.borrowerProfile.phone).toBe("5512345678");
    expect(updated.borrowerProfile.city).toBe("Austin");
  });

  it("changeOwnPassword con currentPassword incorrecta responde 401", async () => {
    const { userId } = await createActiveBorrowerWithPassword();
    const error = await borrowerProfileService
      .changeOwnPassword(userId, { currentPassword: "incorrecta", newPassword: "NuevaClave123!" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
  });

  it("changeOwnPassword exitoso apaga mustChangePassword, revoca refresh tokens y permite loguear con la nueva", async () => {
    const { userId, email, temporaryPassword } = await createActiveBorrowerWithPassword();

    const session = await authService.login({ email, password: temporaryPassword });
    if (session.requiresTwoFactor) throw new Error("unreachable");

    await borrowerProfileService.changeOwnPassword(userId, { currentPassword: temporaryPassword, newPassword: "NuevaClave123!" });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.mustChangePassword).toBe(false);

    const refreshAttempt = await authService.refresh({ refreshToken: session.refreshToken }).catch((e) => e);
    expect(refreshAttempt).toBeInstanceOf(AppError);

    const newLogin = await authService.login({ email, password: "NuevaClave123!" });
    expect(newLogin.requiresTwoFactor).toBe(false);

    const oldPasswordAttempt = await authService.login({ email, password: temporaryPassword }).catch((e) => e);
    expect(oldPasswordAttempt).toBeInstanceOf(AppError);
  });
});
