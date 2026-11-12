import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestAdmin, createTestBorrower, createTestLenderCompany, linkBorrowerToLenderCompany, resetPhase1Tables } from "@/db/testFixtures";
import { AppError } from "@/errors/AppError";
import * as contractsService from "@/services/contracts.service";
import { importLegacyContractSchema } from "@/validations/contracts.validation";

const NOW = new Date("2026-03-15T12:00:00.000Z");

// 50,000 al 6%, 12 cuotas el día 31 (31 ene .. 31 dic): a 2026-03-15 vencieron
// 2 (31 ene, 28 feb); faltan 10.
function payload(overrides: Record<string, unknown>) {
  return importLegacyContractSchema.parse({
    property: { addressLine1: "1 Test St", city: "Austin", state: "TX", postalCode: "78701", propertyType: "SINGLE_FAMILY" },
    terms: {
      structure: "AMORTIZED",
      principalAmount: 50_000,
      interestRate: 6,
      amortizationTermMonths: 12,
      firstPaymentDate: "2026-01-31",
      maturityDate: "2026-12-31",
      lateFeeType: "FLAT",
      lateFeeAmount: 50,
    },
    loanStartDate: "2025-12-31",
    currentBalance: 41_000,
    borrowerProfileIds: ["00000000-0000-0000-0000-000000000000"],
    ...overrides,
  });
}

describe("importLegacyContract", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
  afterEach(() => vi.useRealTimers());
  afterAll(resetPhase1Tables);

  async function setup() {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const { borrowerProfile } = await createTestBorrower();
    await linkBorrowerToLenderCompany(lenderCompany.id, borrowerProfile.id, lenderUser.id);
    const session = { userId: lenderUser.id, role: "LENDER", roles: ["LENDER"] } as never;
    return { session, lenderCompany, borrowerProfileIds: [borrowerProfile.id] };
  }

  it("cuotas pasadas PAID repartiendo el capital pagado; saldo = currentBalance; día 31 ajustado a fin de mes", async () => {
    const { session, borrowerProfileIds } = await setup();
    const contract = await contractsService.importLegacyContract(session, payload({ borrowerProfileIds }));

    expect(contract.status).toBe("ACTIVE");
    expect(contract.originationSource).toBe("LEGACY_IMPORT");
    expect(contract.loanStartDate?.toISOString()).toBe("2025-12-31T00:00:00.000Z");
    expect(contract.activatedAt?.getTime()).toBe(NOW.getTime());
    expect(contract.currentTerms?.status).toBe("ACCEPTED");
    expect(contract.currentPrincipalBalance?.toString()).toBe("41000");
    expect(contract.nextPaymentDueDate?.toISOString()).toBe("2026-03-31T00:00:00.000Z");

    const rows = await prisma.scheduledPayment.findMany({ where: { contractId: contract.id }, orderBy: { sequenceNumber: "asc" } });
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.dueDate.toISOString().slice(0, 10)).slice(0, 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(rows.slice(0, 2).every((r) => r.status === "PAID" && r.amountPaid.equals(r.totalDue))).toBe(true);
    expect(rows.slice(2).every((r) => r.status === "PENDING")).toBe(true);
    expect(rows[0].principalDue.plus(rows[1].principalDue).toString()).toBe("9000");
    expect(rows[1].projectedRemainingBalance.toString()).toBe("41000");
    expect(rows[11].projectedRemainingBalance.toString()).toBe("0");
    expect(await prisma.transaction.count({ where: { contractId: contract.id } })).toBe(0);
  });

  it("saldo mayor al que permite el cronograma original (contrato atrasado) -> 400", async () => {
    const { session, borrowerProfileIds } = await setup();
    const error = await contractsService.importLegacyContract(session, payload({ borrowerProfileIds, currentBalance: 49_900 })).catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("LEGACY_CONTRACT_IN_ARREARS");
  });

  it("Admin debe indicar lenderCompanyId y puede importar a nombre de cualquier empresa", async () => {
    const { lenderCompany, borrowerProfileIds } = await setup();
    const admin = await createTestAdmin();
    const session = { userId: admin.id, role: "ADMIN", roles: ["ADMIN"] } as never;

    const missing = await contractsService.importLegacyContract(session, payload({ borrowerProfileIds })).catch((e) => e);
    expect((missing as AppError).code).toBe("LENDER_COMPANY_REQUIRED");

    const contract = await contractsService.importLegacyContract(session, payload({ borrowerProfileIds, lenderCompanyId: lenderCompany.id }));
    expect(contract.lenderCompanyId).toBe(lenderCompany.id);
  });
});

describe("terms.paymentDueDay", () => {
  it("se deriva de firstPaymentDate si falta, y se rechaza si no coincide", () => {
    const base = payload({});
    expect(base.terms.paymentDueDay).toBe(31);
    expect(() => payload({ terms: { ...base.terms, paymentDueDay: 15 } })).toThrow();
  });
});
