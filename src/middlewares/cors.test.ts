import { describe, expect, it } from "vitest";
import { buildCorsHeaders, isOriginAllowed } from "@/middlewares/cors";

// env.corsOrigin toma su default de CORS_ORIGIN (http://localhost:3000)
// cuando la variable no está seteada — ver src/config/env.ts.
describe("CORS (BE-003)", () => {
  it("permite el origen configurado", () => {
    expect(isOriginAllowed("http://localhost:3000")).toBe(true);
  });

  it("rechaza cualquier otro origen", () => {
    expect(isOriginAllowed("https://evil.example.com")).toBe(false);
    expect(isOriginAllowed(null)).toBe(false);
  });

  it("agrega Access-Control-Allow-Origin solo si el origen es válido", () => {
    const allowed = buildCorsHeaders("http://localhost:3000");
    expect(allowed["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");

    const rejected = buildCorsHeaders("https://evil.example.com");
    expect(rejected["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
