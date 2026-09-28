import type { ContractStatus } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin/overview/route";
import { prisma } from "@/db/prisma";
import {
  createTestContract,
  createTestLenderCompany,
  createTestProperty,
  createTestUserWithPassword,
  issueAccessTokenFor,
  resetPhase1Tables,
} from "@/db/testFixtures";

const PASSWORD = "AdminClave123!";

function get(authorization?: string) {
  return new Request("http://localhost/api/admin/overview", { headers: authorization ? { authorization } : {} });
}

async function overviewAs(role: "ADMIN" | "LENDER") {
  const user = await createTestUserWithPassword(role, PASSWORD);
  return GET(get(`Bearer ${await issueAccessTokenFor(user, PASSWORD)}`));
}

// AD-001 (Fase 16). Contra Postgres real — se compara contra una línea base
// tomada antes de sembrar, así el test no depende de que la base esté vacía.
describe("GET /api/admin/overview (AD-001)", () => {
  afterAll(resetPhase1Tables);

  it("sin token responde 401 y un LENDER 403", async () => {
    expect((await GET(get())).status).toBe(401);
    expect((await overviewAs("LENDER")).status).toBe(403);
  });

  it("agrega KPIs, closing fees, deals, mora y signups a partir de los contratos reales", async () => {
    const before = (await (await overviewAs("ADMIN")).json()).data;

    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const day = 86_400_000;

    async function seedContract(status: ContractStatus, principal: number, activatedAt: Date | null) {
      const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });
      const terms = await prisma.contractTerms.create({
        data: {
          contractId: contract.id,
          versionNumber: 1,
          structure: "AMORTIZED",
          principalAmount: principal,
          interestRate: 8,
          amortizationTermMonths: 12,
          firstPaymentDate: new Date(),
          paymentDueDay: 1,
          maturityDate: new Date(Date.now() + 365 * day),
          lateFeeType: "FLAT",
          lateFeeAmount: 50,
          status: "ACCEPTED",
          createdByUserId: lenderUser.id,
        },
      });
      await prisma.contract.update({ where: { id: contract.id }, data: { status, activatedAt, currentTermsId: terms.id } });
      return { contract, terms };
    }

    const active = await seedContract("ACTIVE", 100_000, new Date());
    const late = await seedContract("DELINQUENT", 50_000, new Date(Date.now() - 60 * day));
    await seedContract("PENDING_ACCEPTANCE", 80_000, null);
    await seedContract("DRAFT", 999_999, null); // no debe contar en ningún lado

    await prisma.contractFeeItem.create({
      data: {
        contractTermsId: active.terms.id,
        category: "PLATFORM",
        code: "MARKETPLACE_CONNECTION",
        label: "Marketplace connection",
        amountType: "PERCENTAGE",
        amountValue: 1,
        computedAmount: 1_000,
      },
    });
    await prisma.scheduledPayment.create({
      data: {
        contractId: late.contract.id,
        contractTermsId: late.terms.id,
        sequenceNumber: 1,
        dueDate: new Date(Date.now() - 15 * day),
        principalDue: 4_000,
        interestDue: 333,
        totalDue: 4_333,
        projectedRemainingBalance: 46_000,
      },
    });

    const response = await overviewAs("ADMIN");
    expect(response.status).toBe(200);
    const { data } = await response.json();

    expect(data.kpis.activeDeals.count - before.kpis.activeDeals.count).toBe(2);
    expect(data.kpis.activeDeals.addedLast7d - before.kpis.activeDeals.addedLast7d).toBe(1);
    expect(Number(data.kpis.totalFunded) - Number(before.kpis.totalFunded)).toBe(150_000);
    expect(data.kpis.lateContracts - before.kpis.lateContracts).toBe(1);
    expect(data.kpis.pendingVerifications).toBe(before.kpis.pendingVerifications); // sin solicitudes nuevas

    expect(Number(data.revenue.closingFees) - Number(before.revenue.closingFees)).toBe(1_000);
    expect(data.revenue.last6Months).toHaveLength(6);
    expect(data.revenue.last6Months[5].month).toBe(data.revenue.month);
    expect(data.revenue.subscriptions).toBeNull();
    expect(data.revenue.net).toBeNull();

    const lateDeal = data.activeDeals.find((deal: { contractId: string }) => deal.contractId === late.contract.id);
    expect(lateDeal.daysPastDue).toBe(15);
    expect(data.activeDeals.map((deal: { status: string }) => deal.status)).not.toContain("DRAFT");

    const alert = data.needsAttention.find((item: { entityId: string }) => item.entityId === late.contract.id);
    expect(alert).toMatchObject({ type: "LATE_PAYMENT", severity: "red", detail: "15 days past due" });

    const signup = data.recentSignups.find((user: { userId: string }) => user.userId === lenderUser.id);
    expect(signup.verification).toBeNull(); // nunca envió una solicitud
    expect(signup.dealsCount).toBe(3); // ACTIVE + DELINQUENT + PENDING_ACCEPTANCE; el DRAFT no cuenta
  });
});
