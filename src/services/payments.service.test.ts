import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculatePaymentAllocation, type AllocationRow } from "./payments.service";
import { isDueSoon } from "@/services/contracts.service";

const { Decimal } = Prisma;

function row(overrides: Partial<AllocationRow> & { scheduledPaymentId: string }): AllocationRow {
  return {
    remainingLateFee: new Decimal(0),
    remainingInterest: new Decimal(0),
    remainingPrincipal: new Decimal(0),
    ...overrides,
  };
}

// BE-068. Funciones puras, sin I/O — mismo patrón que
// amortization.service.test.ts.
describe("payments.service — calculatePaymentAllocation (BE-068, waterfall)", () => {
  it("una sola fila: mora -> interés -> capital, en ese orden", () => {
    const rows = [row({ scheduledPaymentId: "row-1", remainingLateFee: new Decimal(50), remainingInterest: new Decimal(300), remainingPrincipal: new Decimal(650) })];
    const plan = calculatePaymentAllocation(rows, new Decimal(1000));

    expect(plan).toEqual([
      { scheduledPaymentId: "row-1", allocationType: "LATE_FEE", amount: new Decimal(50) },
      { scheduledPaymentId: "row-1", allocationType: "INTEREST", amount: new Decimal(300) },
      { scheduledPaymentId: "row-1", allocationType: "PRINCIPAL", amount: new Decimal(650) },
    ]);
  });

  it("un pago que no alcanza a cubrir la fila más antigua no toca la siguiente", () => {
    const rows = [
      row({ scheduledPaymentId: "row-1", remainingInterest: new Decimal(300), remainingPrincipal: new Decimal(900) }),
      row({ scheduledPaymentId: "row-2", remainingInterest: new Decimal(300), remainingPrincipal: new Decimal(900) }),
    ];
    const plan = calculatePaymentAllocation(rows, new Decimal(200));

    expect(plan).toEqual([{ scheduledPaymentId: "row-1", allocationType: "INTEREST", amount: new Decimal(200) }]);
  });

  it("un pago que cubre la fila más antigua completa continúa en la siguiente (filas más antiguas primero)", () => {
    const rows = [
      row({ scheduledPaymentId: "row-1", remainingInterest: new Decimal(300), remainingPrincipal: new Decimal(900) }),
      row({ scheduledPaymentId: "row-2", remainingInterest: new Decimal(300), remainingPrincipal: new Decimal(900) }),
    ];
    const plan = calculatePaymentAllocation(rows, new Decimal(1300));

    expect(plan).toEqual([
      { scheduledPaymentId: "row-1", allocationType: "INTEREST", amount: new Decimal(300) },
      { scheduledPaymentId: "row-1", allocationType: "PRINCIPAL", amount: new Decimal(900) },
      { scheduledPaymentId: "row-2", allocationType: "INTEREST", amount: new Decimal(100) },
    ]);
  });

  it("filas con todos los baldes en 0 (ya pagadas) se saltean sin generar asignaciones vacías", () => {
    const rows = [row({ scheduledPaymentId: "row-1" }), row({ scheduledPaymentId: "row-2", remainingPrincipal: new Decimal(500) })];
    const plan = calculatePaymentAllocation(rows, new Decimal(500));

    expect(plan).toEqual([{ scheduledPaymentId: "row-2", allocationType: "PRINCIPAL", amount: new Decimal(500) }]);
  });

  it("sin filas candidatas, no genera ninguna asignación", () => {
    expect(calculatePaymentAllocation([], new Decimal(500))).toEqual([]);
  });
});

// Fase 7 (pedido explícito): indicador `dueSoon`, calculado — nunca
// persistido — sobre filas PENDING/PARTIALLY_PAID cuyo dueDate cae dentro de
// los próximos 7 días. Vive en contracts.service.ts (getSchedule lo usa).
describe("isDueSoon (Fase 7)", () => {
  const asOf = new Date("2026-06-01T00:00:00.000Z");

  it("PENDING con dueDate dentro de los próximos 7 días -> true", () => {
    expect(isDueSoon({ status: "PENDING", dueDate: new Date("2026-06-05T00:00:00.000Z") }, asOf)).toBe(true);
  });

  it("PENDING con dueDate más allá de 7 días -> false", () => {
    expect(isDueSoon({ status: "PENDING", dueDate: new Date("2026-06-10T00:00:00.000Z") }, asOf)).toBe(false);
  });

  it("PENDING con dueDate ya vencido -> false (mora es responsabilidad de assessLateFee/recomputeContractDelinquency, no de dueSoon)", () => {
    expect(isDueSoon({ status: "PENDING", dueDate: new Date("2026-05-25T00:00:00.000Z") }, asOf)).toBe(false);
  });

  it("PAID/VOIDED nunca es dueSoon aunque el dueDate caiga en la ventana", () => {
    expect(isDueSoon({ status: "PAID", dueDate: new Date("2026-06-05T00:00:00.000Z") }, asOf)).toBe(false);
    expect(isDueSoon({ status: "VOIDED", dueDate: new Date("2026-06-05T00:00:00.000Z") }, asOf)).toBe(false);
  });
});
