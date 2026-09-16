import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

// BE-081/082: el HEALTHCHECK de Docker depende de este endpoint respondiendo
// 200 sin sesión ni base de datos.
describe("GET /api/health", () => {
  it("responde 200 con status ok, sin requerir autenticación", async () => {
    const response = await GET(new Request("http://localhost/api/health"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("ok");
    expect(body.data.environment).toEqual(expect.any(String));
    expect(body.data.uptime).toEqual(expect.any(Number));
  });
});
