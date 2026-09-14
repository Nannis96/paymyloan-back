import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/errors/AppError";
import { checkRateLimit, resetRateLimitStore } from "@/middlewares/rateLimit";

describe("checkRateLimit (BE-005)", () => {
  beforeEach(() => {
    resetRateLimitStore();
  });

  it("permite hasta max intentos y bloquea el siguiente con 429", () => {
    const key = "127.0.0.1:test@example.com";
    const options = { max: 5, windowMs: 900_000 };

    for (let i = 0; i < 5; i++) {
      expect(() => checkRateLimit(key, options)).not.toThrow();
    }

    try {
      checkRateLimit(key, options);
      expect.unreachable("el 6º intento debía lanzar");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(429);
      expect((error as AppError).code).toBe("RATE_LIMITED");
    }
  });

  it("se resetea al pasar la ventana", () => {
    const key = "127.0.0.1:reset@example.com";
    checkRateLimit(key, { max: 1, windowMs: 10 });

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(() => checkRateLimit(key, { max: 1, windowMs: 10 })).not.toThrow();
        resolve();
      }, 20);
    });
  });

  it("cuentas independientes por key no se contaminan entre sí", () => {
    const options = { max: 1, windowMs: 900_000 };
    checkRateLimit("key-a", options);
    expect(() => checkRateLimit("key-b", options)).not.toThrow();
  });
});
