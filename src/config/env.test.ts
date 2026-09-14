import { describe, expect, it } from "vitest";
import { assertRequiredInProduction } from "@/config/env";

describe("assertRequiredInProduction (BE-002)", () => {
  it("no lanza fuera de producción aunque falten todas las variables", () => {
    expect(() => assertRequiredInProduction({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertRequiredInProduction({ NODE_ENV: "test" })).not.toThrow();
  });

  it("lanza en producción si falta alguna variable obligatoria", () => {
    expect(() =>
      assertRequiredInProduction({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: "x",
        // JWT_REFRESH_SECRET y DATABASE_URL faltan
      }),
    ).toThrow(/JWT_REFRESH_SECRET/);
  });

  it("no lanza en producción si están las tres obligatorias", () => {
    expect(() =>
      assertRequiredInProduction({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: "x",
        JWT_REFRESH_SECRET: "y",
        DATABASE_URL: "postgresql://...",
      }),
    ).not.toThrow();
  });
});
