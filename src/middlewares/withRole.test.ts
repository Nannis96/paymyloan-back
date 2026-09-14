import { afterEach, describe, expect, it, vi } from "vitest";

// D-P4-4: con REQUIRE_TWO_FACTOR=false, withRole ni siquiera debería
// consultar la base — por eso esto es un test unitario (sin DB configurada
// en este entorno) y no uno de integración: si el corto-circuito se
// rompiera y el código intentara `prisma.user.findUnique`, este test
// fallaría por falta de conexión en vez de pasar en falso.
describe("withRole — interruptor REQUIRE_TWO_FACTOR (D-P4-4)", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/config/env");
  });

  it("con REQUIRE_TWO_FACTOR=false, un ADMIN/LENDER sin 2FA pasa igual (no consulta la DB)", async () => {
    vi.doMock("@/config/env", () => ({ env: { requireTwoFactorForWrites: false } }));
    vi.resetModules();

    const { withRole } = await import("@/middlewares/withRole");
    await expect(withRole({ userId: "no-existe-en-ningun-lado", role: "ADMIN" }, ["ADMIN"])).resolves.toBeUndefined();
  });

  it("requirePasswordChanged sigue funcionando independientemente del interruptor (si se pide, igual consulta)", async () => {
    vi.doMock("@/config/env", () => ({ env: { requireTwoFactorForWrites: false } }));
    vi.resetModules();

    const { withRole } = await import("@/middlewares/withRole");
    const error = await withRole({ userId: "no-existe-en-ningun-lado", role: "BORROWER" }, ["BORROWER"], { requirePasswordChanged: true }).catch(
      (e) => e,
    );
    // No hay DB en este entorno unitario — lo importante es que SÍ intentó
    // resolverlo (no volvió temprano como en el caso de arriba).
    expect(error).toBeDefined();
  });
});
