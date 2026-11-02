import { describe, expect, it } from "vitest";
import { computeCommissionCents, computePayableAt, resolveTerms } from "@/services/affiliates.service";

describe("affiliates.service — cálculo de comisión y tarifa (§19.1)", () => {
  it("PERCENT sobre el pago; FIXED en dólares → centavos; redondea", () => {
    expect(computeCommissionCents("PERCENT", 10, 900)).toBe(90);
    expect(computeCommissionCents("PERCENT", 12.5, 999)).toBe(125);
    expect(computeCommissionCents("FIXED", 5, 900)).toBe(500);
    expect(computeCommissionCents("PERCENT", 0, 900)).toBe(0);
  });

  it("resolveTerms usa la tarifa propia o, si no hay, los defaults de env (0 ⇒ sin comisión)", () => {
    expect(resolveTerms({ commissionType: "FIXED", commissionValue: 7 as never, payoutDelayDays: 3 })).toEqual({ commissionType: "FIXED", commissionValue: 7, payoutDelayDays: 3 });
    expect(resolveTerms({ commissionType: null, commissionValue: null, payoutDelayDays: null })).toMatchObject({ commissionValue: 0, payoutDelayDays: null });
  });

  it("computePayableAt: sin retraso es ahora; con retraso suma días", () => {
    const now = new Date("2026-11-02T00:00:00Z");
    expect(computePayableAt(null, now)).toEqual(now);
    expect(computePayableAt(0, now)).toEqual(now);
    expect(computePayableAt(5, now).toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });
});
