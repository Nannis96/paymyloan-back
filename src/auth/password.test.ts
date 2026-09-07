import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, hashPassword, verifyDummyPassword, verifyPassword } from "@/auth/password";

describe("auth/password (BE-024)", () => {
  it("hash + compare hacen round-trip", async () => {
    const hash = await hashPassword("MiClave123!");
    expect(await verifyPassword("MiClave123!", hash)).toBe(true);
    expect(await verifyPassword("OtraClave123!", hash)).toBe(false);
  });

  it("dos hashes de la misma contraseña son distintos (salteo)", async () => {
    const a = await hashPassword("MiClave123!");
    const b = await hashPassword("MiClave123!");
    expect(a).not.toBe(b);
  });

  it("verifyDummyPassword no lanza (usada para igualar timing cuando el usuario no existe)", async () => {
    await expect(verifyDummyPassword("cualquier-cosa")).resolves.toBeUndefined();
  });

  it("generateTemporaryPassword produce valores únicos con la longitud pedida", () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();
    expect(a).not.toBe(b);
    expect(a).toHaveLength(16);
    expect(generateTemporaryPassword(24)).toHaveLength(24);
  });
});
