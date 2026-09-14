import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";

describe("logger (BE-004)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("escribe una línea JSON con nivel, mensaje y timestamp", () => {
    logger.info("hola");

    const line = logSpy.mock.calls[0]?.[0] as string;
    const entry = JSON.parse(line);
    expect(entry).toMatchObject({ level: "info", message: "hola" });
    expect(typeof entry.timestamp).toBe("string");
  });

  it("dos requests concurrentes no mezclan su requestId", () => {
    logger.info("evento A", { requestId: "req-A" });
    logger.info("evento B", { requestId: "req-B" });

    const entryA = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    const entryB = JSON.parse(logSpy.mock.calls[1]?.[0] as string);

    expect(entryA.requestId).toBe("req-A");
    expect(entryB.requestId).toBe("req-B");
  });
});
