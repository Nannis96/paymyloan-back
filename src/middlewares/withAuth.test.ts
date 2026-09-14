import { describe, expect, it } from "vitest";
import { signAccessToken } from "@/auth/jwt";
import { AppError } from "@/errors/AppError";
import { withAuth } from "@/middlewares/withAuth";

function requestWithAuth(header?: string): Request {
  const headers = new Headers();
  if (header !== undefined) headers.set("authorization", header);
  return new Request("http://localhost/api/whatever", { headers });
}

describe("withAuth (BE-035)", () => {
  it("sin header Authorization lanza 401 UNAUTHENTICATED", async () => {
    const error = await withAuth(requestWithAuth()).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
    expect((error as AppError).code).toBe("UNAUTHENTICATED");
  });

  it("un header que no empieza con 'Bearer ' lanza 401 UNAUTHENTICATED", async () => {
    const error = await withAuth(requestWithAuth("Basic algo")).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("UNAUTHENTICATED");
  });

  it("un token con firma inválida lanza 401 INVALID_TOKEN", async () => {
    const token = await signAccessToken({ sub: "user-1", role: "ADMIN" });
    const tampered = `${token.slice(0, -4)}${token.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;

    const error = await withAuth(requestWithAuth(`Bearer ${tampered}`)).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(401);
    expect((error as AppError).code).toBe("INVALID_TOKEN");
  });

  it("un token válido devuelve la sesión { userId, role }", async () => {
    const token = await signAccessToken({ sub: "user-1", role: "LENDER" });
    await expect(withAuth(requestWithAuth(`Bearer ${token}`))).resolves.toEqual({ userId: "user-1", role: "LENDER" });
  });
});
