import { afterAll, describe, expect, it } from "vitest";
import { createTestUser, createTestUserWithTwoFactor, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import { prisma } from "@/db/prisma";
import { withRole } from "@/middlewares/withRole";

describe("withRole (BE-036) — 2FA obligatorio para ADMIN/LENDER en escrituras de negocio (D-P3-1)", () => {
  afterAll(resetPhase1Tables);

  it("rol no permitido responde 403 FORBIDDEN", async () => {
    const borrower = await createTestUser("BORROWER");
    const error = await withRole({ userId: borrower.id, role: "BORROWER" }, ["ADMIN"]).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(403);
    expect((error as AppError).code).toBe("FORBIDDEN");
  });

  it("ADMIN sin 2FA activo responde 403 TWO_FACTOR_REQUIRED por default", async () => {
    const admin = await createTestUser("ADMIN");
    const error = await withRole({ userId: admin.id, role: "ADMIN" }, ["ADMIN"]).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(403);
    expect((error as AppError).code).toBe("TWO_FACTOR_REQUIRED");
  });

  it("LENDER sin 2FA activo también responde 403 TWO_FACTOR_REQUIRED", async () => {
    const lender = await createTestUser("LENDER");
    const error = await withRole({ userId: lender.id, role: "LENDER" }, ["LENDER"]).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("TWO_FACTOR_REQUIRED");
  });

  it("ADMIN con 2FA activo pasa sin error", async () => {
    const { user: admin } = await createTestUserWithTwoFactor("ADMIN", "ClaveValida123!");
    await expect(withRole({ userId: admin.id, role: "ADMIN" }, ["ADMIN"])).resolves.toBeUndefined();
  });

  it("BORROWER nunca dispara el chequeo de 2FA, aunque esté en la lista de roles permitidos", async () => {
    const borrower = await createTestUser("BORROWER");
    await expect(withRole({ userId: borrower.id, role: "BORROWER" }, ["BORROWER"])).resolves.toBeUndefined();
  });

  it("requireTwoFactor:false saltea el chequeo para ADMIN/LENDER (rutas exentas, p.ej. /2fa/*)", async () => {
    const admin = await createTestUser("ADMIN");
    await expect(withRole({ userId: admin.id, role: "ADMIN" }, ["ADMIN"], { requireTwoFactor: false })).resolves.toBeUndefined();
  });

  it("ADMIN con 2FA activo pero cuenta desactivada responde 403 ACCOUNT_INACTIVE", async () => {
    const { user: admin } = await createTestUserWithTwoFactor("ADMIN", "ClaveValida123!");
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });

    const error = await withRole({ userId: admin.id, role: "ADMIN" }, ["ADMIN"]).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("ACCOUNT_INACTIVE");
  });
});
