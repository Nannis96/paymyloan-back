import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import * as auditLogsService from "@/services/auditLogs.service";
import { prisma } from "@/db/prisma";
import { createTestBorrower, createTestLenderCompany, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import { createTestAdmin } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as emailLib from "@/lib/email";
import * as contractsService from "@/services/contracts.service";
import * as paymentsService from "@/services/payments.service";
import type { ContractTermsInput, PropertyInput } from "@/validations/contracts.validation";

const { Decimal } = Prisma;

function property(overrides: Partial<PropertyInput> = {}): PropertyInput {
  return { addressLine1: "1 Test St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY", ...overrides };
}

function terms(overrides: Partial<ContractTermsInput> = {}): ContractTermsInput {
  return {
    structure: "AMORTIZED",
    principalAmount: 10_000,
    interestRate: 12,
    dayCountConvention: "THIRTY_360",
    amortizationTermMonths: 3,
    firstPaymentDate: new Date("2026-01-01T00:00:00.000Z"),
    paymentDueDay: 1,
    maturityDate: new Date("2026-03-01T00:00:00.000Z"),
    lateFeeType: "FLAT",
    lateFeeAmount: 25,
    gracePeriodDays: 10,
    ...overrides,
  };
}

// Crea Contract+ContractTerms, lo activa (un único deudor acepta) y devuelve
// el calendario generado — mismo camino que
// contracts.service.integration.test.ts, extraído acá porque payments lo
// necesita en casi todos los tests.
async function activateContract(termsOverrides: Partial<ContractTermsInput> = {}) {
  const { lenderUser, lenderCompany } = await createTestLenderCompany();
  const { user: borrowerUser, borrowerProfile } = await createTestBorrower();
  await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);

  const contract = await contractsService.createContract(lenderUser.id, {
    property: property(),
    terms: terms(termsOverrides),
    borrowerProfileIds: [borrowerProfile.id],
  });
  const termsId = contract.currentTerms!.id;

  const sendEmailSpy = vi.spyOn(emailLib, "sendEmail").mockResolvedValue(undefined);
  await contractsService.submitContractTerms(lenderUser.id, contract.id, termsId);
  const activated = await contractsService.acceptContractTerms(borrowerUser.id, contract.id, termsId, {});
  sendEmailSpy.mockRestore();

  const schedule = await prisma.scheduledPayment.findMany({ where: { contractId: contract.id }, orderBy: { sequenceNumber: "asc" } });
  return { lenderUser, lenderCompany, borrowerUser, borrowerProfile, contract: activated, schedule };
}

// BE-067/068/069/071 (Fase 7). Contra Postgres real, nunca mocks.
describe("payments.service (Fase 7)", () => {
  afterAll(resetPhase1Tables);

  it("BE-067: rechaza un pago manual sobre un contrato sin calendario activo (DRAFT)", async () => {
    const { lenderUser } = await createTestLenderCompany();
    const contract = await contractsService.createContract(lenderUser.id, { property: property(), terms: terms() });

    const result = await paymentsService.recordManualPayment(lenderUser.id, contract.id, { amount: 100, method: "MANUAL" }).catch((e) => e);
    expect(result).toBeInstanceOf(AppError);
    expect((result as AppError).code).toBe("CONTRACT_NOT_ACTIVE");
  });

  it("BE-067/068: un pago exacto a la primera cuota la marca PAID (interés+capital) y descuenta el capital del Contract", async () => {
    const { lenderUser, contract, schedule } = await activateContract();
    const firstRow = schedule[0];
    const initialBalance = contract.currentPrincipalBalance!;

    const transaction = await paymentsService.recordManualPayment(lenderUser.id, contract.id, {
      amount: firstRow.totalDue.toNumber(),
      method: "WIRE",
      notes: "Wire ref #123",
    });

    expect(transaction.status).toBe("SUCCEEDED");
    expect(transaction.allocations).toHaveLength(2); // INTEREST + PRINCIPAL, sin mora asignada
    expect(transaction.allocations.map((a) => a.allocationType).sort()).toEqual(["INTEREST", "PRINCIPAL"]);

    const updatedRow = await prisma.scheduledPayment.findUniqueOrThrow({ where: { id: firstRow.id } });
    expect(updatedRow.status).toBe("PAID");
    expect(updatedRow.amountPaid.toFixed(2)).toBe(firstRow.totalDue.toFixed(2));
    expect(updatedRow.paidInFullAt).not.toBeNull();

    const updatedContract = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(updatedContract.currentPrincipalBalance!.toFixed(2)).toBe(initialBalance.minus(firstRow.principalDue).toFixed(2));
    expect(updatedContract.nextPaymentDueDate?.toISOString()).toBe(schedule[1].dueDate.toISOString());
  });

  it("BE-067/068: un pago parcial deja la fila PARTIALLY_PAID sin tocar la siguiente", async () => {
    const { lenderUser, contract, schedule } = await activateContract();
    const firstRow = schedule[0];
    const partialAmount = firstRow.totalDue.minus(10);

    await paymentsService.recordManualPayment(lenderUser.id, contract.id, { amount: partialAmount.toNumber(), method: "MANUAL" });

    const updatedRow = await prisma.scheduledPayment.findUniqueOrThrow({ where: { id: firstRow.id } });
    expect(updatedRow.status).toBe("PARTIALLY_PAID");
    expect(updatedRow.amountPaid.toFixed(2)).toBe(partialAmount.toFixed(2));

    const secondRow = await prisma.scheduledPayment.findUniqueOrThrow({ where: { id: schedule[1].id } });
    expect(secondRow.status).toBe("PENDING");
    expect(secondRow.amountPaid.toFixed(2)).toBe("0.00");
  });

  it("BE-068: la mora se cobra antes que el interés — un pago que cubre mora + interés no toca el capital", async () => {
    const { lenderUser, contract, schedule } = await activateContract();
    const firstRow = schedule[0];
    // Simula el cargo de mora que assessLateFee (BE-064) habría aplicado
    // tras el período de gracia — no hace falta esperar el vencimiento real.
    await prisma.scheduledPayment.update({ where: { id: firstRow.id }, data: { lateFeeAssessed: new Decimal(25), lateFeeAssessedAt: new Date() } });

    const amount = new Decimal(25).plus(firstRow.interestDue);
    const transaction = await paymentsService.recordManualPayment(lenderUser.id, contract.id, { amount: amount.toNumber(), method: "MANUAL" });

    const byType = Object.fromEntries(transaction.allocations.map((a) => [a.allocationType, a.amount.toFixed(2)]));
    expect(byType.LATE_FEE).toBe("25.00");
    expect(byType.INTEREST).toBe(firstRow.interestDue.toFixed(2));
    expect(byType.PRINCIPAL).toBeUndefined();

    const updatedRow = await prisma.scheduledPayment.findUniqueOrThrow({ where: { id: firstRow.id } });
    // amountPaid/status solo reflejan interés+capital (totalDue), la mora se
    // trackea aparte vía TransactionAllocation.
    expect(updatedRow.amountPaid.toFixed(2)).toBe(firstRow.interestDue.toFixed(2));
    expect(updatedRow.status).toBe("PARTIALLY_PAID");
  });

  it("BE-068: un pago que excede el saldo total pendiente del contrato se rechaza (400 AMOUNT_EXCEEDS_BALANCE)", async () => {
    const { lenderUser, contract, schedule } = await activateContract();
    const totalOutstanding = schedule.reduce((sum, row) => sum.plus(row.totalDue), new Decimal(0));

    const result = await paymentsService
      .recordManualPayment(lenderUser.id, contract.id, { amount: totalOutstanding.plus(1).toNumber(), method: "MANUAL" })
      .catch((e) => e);
    expect(result).toBeInstanceOf(AppError);
    expect((result as AppError).code).toBe("AMOUNT_EXCEEDS_BALANCE");

    // Nada quedó a medio aplicar: la Transaction ni siquiera se creó.
    const count = await prisma.transaction.count({ where: { contractId: contract.id } });
    expect(count).toBe(0);
  });

  it("BE-069: listTransactions/getTransaction respetan el acceso por tenant (404 para un tercero)", async () => {
    const { lenderUser, contract, schedule } = await activateContract();
    const transaction = await paymentsService.recordManualPayment(lenderUser.id, contract.id, { amount: schedule[0].totalDue.toNumber(), method: "MANUAL" });

    const page = await paymentsService.listTransactions({ userId: lenderUser.id, role: "LENDER" }, contract.id, { page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(transaction.id);

    const fetched = await paymentsService.getTransaction({ userId: lenderUser.id, role: "LENDER" }, transaction.id);
    expect(fetched.id).toBe(transaction.id);

    const stranger = await createTestLenderCompany();
    const denied = await paymentsService.getTransaction({ userId: stranger.lenderUser.id, role: "LENDER" }, transaction.id).catch((e) => e);
    expect(denied).toBeInstanceOf(AppError);
    expect((denied as AppError).statusCode).toBe(404);
  });

  it("BE-071: ADMIN reversa una transacción SUCCEEDED — restaura amountPaid/status y el capital del Contract", async () => {
    const { lenderUser, contract, schedule } = await activateContract();
    const firstRow = schedule[0];
    const admin = await createTestAdmin();

    const beforeBalance = (await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).currentPrincipalBalance!;
    const transaction = await paymentsService.recordManualPayment(lenderUser.id, contract.id, { amount: firstRow.totalDue.toNumber(), method: "MANUAL" });

    const reversed = await paymentsService.reverseTransaction(admin.id, transaction.id, { reason: "Wire bounced" });
    expect(reversed.status).toBe("RETURNED");
    expect(reversed.returnedAt).not.toBeNull();

    const rowAfterReversal = await prisma.scheduledPayment.findUniqueOrThrow({ where: { id: firstRow.id } });
    expect(rowAfterReversal.status).toBe("PENDING");
    expect(rowAfterReversal.amountPaid.toFixed(2)).toBe("0.00");
    expect(rowAfterReversal.paidInFullAt).toBeNull();

    const contractAfterReversal = await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } });
    expect(contractAfterReversal.currentPrincipalBalance!.toFixed(2)).toBe(beforeBalance.toFixed(2));

    // No se puede reversar dos veces.
    const doubleReverse = await paymentsService.reverseTransaction(admin.id, transaction.id, { reason: "again" }).catch((e) => e);
    expect(doubleReverse).toBeInstanceOf(AppError);
    expect((doubleReverse as AppError).code).toBe("TRANSACTION_NOT_REVERSIBLE");

    // Tras la reversión, ese mismo monto se puede volver a aplicar (la
    // asignación original quedó excluida del waterfall al no pertenecer a
    // una Transaction SUCCEEDED).
    const reapplied = await paymentsService.recordManualPayment(lenderUser.id, contract.id, { amount: firstRow.totalDue.toNumber(), method: "MANUAL" });
    expect(reapplied.status).toBe("SUCCEEDED");
    const rowAfterReapply = await prisma.scheduledPayment.findUniqueOrThrow({ where: { id: firstRow.id } });
    expect(rowAfterReapply.status).toBe("PAID");
  });

  it("Fase 7 (pedido explícito): el Admin ve y edita cualquier contrato, sin restricción de tenant", async () => {
    const { contract } = await activateContract();
    const admin = await createTestAdmin();

    const viaAdmin = await contractsService.getContract({ userId: admin.id, role: "ADMIN" }, contract.id);
    expect(viaAdmin.id).toBe(contract.id);

    const list = await contractsService.listContracts({ userId: admin.id, role: "ADMIN" }, { page: 1, pageSize: 50 });
    expect(list.items.some((c) => c.id === contract.id)).toBe(true);

    const updated = await contractsService.updateContract({ userId: admin.id, role: "ADMIN" }, contract.id, { property: { city: "Dallas" } });
    expect(updated.property.city).toBe("Dallas");
  });

  it("Fase 7 (pedido explícito): getSchedule marca dueSoon en las filas que vencen dentro de los próximos 7 días", async () => {
    const now = new Date();
    const soon = new Date(now);
    soon.setUTCDate(soon.getUTCDate() + 3);
    const far = new Date(now);
    far.setUTCDate(far.getUTCDate() + 90);

    const { contract } = await activateContract({
      firstPaymentDate: soon,
      maturityDate: new Date(Date.UTC(far.getUTCFullYear(), far.getUTCMonth() + 1, far.getUTCDate())),
      amortizationTermMonths: 3,
    });

    const schedule = await contractsService.getSchedule({ userId: contract.createdByUserId, role: "LENDER" }, contract.id);
    expect(schedule[0].dueSoon).toBe(true);
    expect(schedule[schedule.length - 1].dueSoon).toBe(false);
  });

  it("BE-072: ADMIN ve auditoría de todos los Lenders; un LENDER solo ve la de sus propias empresas", async () => {
    const first = await activateContract();
    const second = await activateContract();
    const admin = await createTestAdmin();

    const adminLogs = await auditLogsService.listAuditLogs({ userId: admin.id, role: "ADMIN" }, { page: 1, pageSize: 100 });
    expect(adminLogs.items.some((log) => log.contractId === first.contract.id)).toBe(true);
    expect(adminLogs.items.some((log) => log.contractId === second.contract.id)).toBe(true);

    const lenderLogs = await auditLogsService.listAuditLogs({ userId: first.lenderUser.id, role: "LENDER" }, { page: 1, pageSize: 100 });
    expect(lenderLogs.items.every((log) => log.lenderCompanyId === first.lenderCompany.id)).toBe(true);
    expect(lenderLogs.items.some((log) => log.contractId === second.contract.id)).toBe(false);

    const borrowerDenied = await auditLogsService.listAuditLogs({ userId: first.borrowerUser.id, role: "BORROWER" }, { page: 1, pageSize: 20 }).catch((e) => e);
    expect(borrowerDenied).toBeInstanceOf(AppError);
    expect((borrowerDenied as AppError).code).toBe("FORBIDDEN");
  });
});
