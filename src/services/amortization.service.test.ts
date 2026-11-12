import { describe, expect, it } from "vitest";
import { dueDateAt, isFirstPaymentOnDueDay } from "@/lib/dueDate";
import {
  addMonths,
  calculateAccruedInterest,
  calculateAmortizedPayment,
  calculateBalloonPayment,
  calculateInterestOnlyPayment,
} from "@/services/amortization.service";

// BE-058. Funciones puras, sin I/O — casos contra referencia externa
// (calculadora de amortización estándar), ver Docs/plan/11-testing.md.
describe("amortization.service (BE-058)", () => {
  it("calculateAmortizedPayment: $200,000 a 6% anual / 360 meses ~= $1,199.10 (referencia estándar)", () => {
    const payment = calculateAmortizedPayment(200_000, 6, 360);
    expect(payment.toFixed(2)).toBe("1199.10");
  });

  it("calculateAmortizedPayment: tasa 0% reparte el principal en partes iguales", () => {
    const payment = calculateAmortizedPayment(12_000, 0, 12);
    expect(payment.toFixed(2)).toBe("1000.00");
  });

  it("calculateInterestOnlyPayment: $100,000 al 12% anual = $1,000/mes", () => {
    const payment = calculateInterestOnlyPayment(100_000, 12);
    expect(payment.toFixed(2)).toBe("1000.00");
  });

  it("calculateBalloonPayment usa el PMT del plazo de amortización teórico, ignora las fechas", () => {
    const balloon = calculateBalloonPayment(200_000, 6, 360, new Date("2027-01-01"), new Date("2026-10-01"));
    const amortized = calculateAmortizedPayment(200_000, 6, 360);
    expect(balloon.toFixed(2)).toBe(amortized.toFixed(2));
  });

  it("calculateAccruedInterest (THIRTY_360): 30 días a 12% anual sobre $100,000 = $1,000", () => {
    const interest = calculateAccruedInterest(100_000, 12, "THIRTY_360", new Date("2026-01-01"), new Date("2026-02-01"));
    expect(interest.toFixed(2)).toBe("1000.00");
  });

  it("calculateAccruedInterest (ACTUAL_365): 365 días a 10% anual sobre $10,000 = $1,000", () => {
    const interest = calculateAccruedInterest(10_000, 10, "ACTUAL_365", new Date("2026-01-01"), new Date("2027-01-01"));
    expect(interest.toFixed(2)).toBe("1000.00");
  });

  it("calculateAccruedInterest con rango invertido o vacío devuelve 0, nunca negativo", () => {
    const interest = calculateAccruedInterest(10_000, 10, "ACTUAL_365", new Date("2026-02-01"), new Date("2026-01-01"));
    expect(interest.toFixed(2)).toBe("0.00");
  });
});

describe("dueDateAt / addMonths: día de pago ajustado al fin de mes", () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it("día 31 cae en el último día de cada mes corto y vuelve a 31 después", () => {
    const first = new Date("2026-01-31T00:00:00.000Z");
    expect([0, 1, 2, 3].map((i) => iso(dueDateAt(first, 31, i)))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(iso(dueDateAt(new Date("2028-01-30T00:00:00.000Z"), 30, 1))).toBe("2028-02-29"); // bisiesto
  });

  it("addMonths no desborda al mes siguiente (31 mar - 1 mes = 28 feb)", () => {
    expect(iso(addMonths(new Date("2026-03-31T00:00:00.000Z"), -1))).toBe("2026-02-28");
  });

  it("isFirstPaymentOnDueDay acepta el fin de mes y rechaza un día distinto", () => {
    expect(isFirstPaymentOnDueDay(new Date("2026-02-28T00:00:00.000Z"), 31)).toBe(true);
    expect(isFirstPaymentOnDueDay(new Date("2026-02-15T00:00:00.000Z"), 31)).toBe(false);
  });
});
