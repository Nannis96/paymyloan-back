import { describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";

// BE-001: todo id nuevo debe ser un UUIDv7 real generado por Postgres
// (uuidv7()), no un cuid ni un uuid v4. El nibble de versión (3er grupo,
// primer carácter) debe ser "7" y el nibble de variante (4to grupo, primer
// carácter) debe caer en 8-b, por RFC 9562.
const UUIDV7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("uuidv7 id strategy (BE-001)", () => {
  it("asigna un UUIDv7 válido a un User recién creado", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Test UUIDv7",
        email: `uuidv7-${Date.now()}@test.local`,
        password: "hash-de-prueba",
        role: "BORROWER",
      },
    });

    try {
      expect(user.id).toMatch(UUIDV7_PATTERN);
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
