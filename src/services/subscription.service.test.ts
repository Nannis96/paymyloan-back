import { describe, expect, it } from "vitest";
import { addMonths, effectiveStatus, hasAccess, periodBase } from "@/services/subscription.service";

const now = new Date("2026-11-02T12:00:00Z");
const past = new Date("2026-10-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");

describe("subscription.service — aritmética de acceso y periodos (§18.1)", () => {
  it("hasAccess: trial vigente o periodo pagado vigente", () => {
    expect(hasAccess({ trialEndsAt: future, currentPeriodEnd: null }, now)).toBe(true);
    expect(hasAccess({ trialEndsAt: past, currentPeriodEnd: future }, now)).toBe(true);
    expect(hasAccess({ trialEndsAt: past, currentPeriodEnd: past }, now)).toBe(false);
    expect(hasAccess({ trialEndsAt: past, currentPeriodEnd: null }, now)).toBe(false);
  });

  it("effectiveStatus: sin acceso siempre EXPIRED, con acceso el status guardado", () => {
    expect(effectiveStatus({ status: "ACTIVE", trialEndsAt: past, currentPeriodEnd: past }, now)).toBe("EXPIRED");
    expect(effectiveStatus({ status: "CANCELLED", trialEndsAt: past, currentPeriodEnd: future }, now)).toBe("CANCELLED");
  });

  it("periodBase: nunca antes de now, y respeta el fin vigente", () => {
    expect(periodBase({ trialEndsAt: future, currentPeriodEnd: null }, now)).toEqual(future);
    expect(periodBase({ trialEndsAt: past, currentPeriodEnd: null }, now)).toEqual(now);
    expect(periodBase({ trialEndsAt: past, currentPeriodEnd: future }, now)).toEqual(future);
  });

  it("addMonths suma un mes calendario", () => {
    expect(addMonths(new Date("2026-11-02T00:00:00Z"), 1).toISOString()).toBe("2026-12-02T00:00:00.000Z");
  });
});
