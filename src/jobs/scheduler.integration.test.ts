import cron from "node-cron";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/db/prisma";
import { createTestContract, createTestLenderCompany, createTestProperty, resetPhase1Tables } from "@/db/testFixtures";
import { runDelinquencyJob, startJobs } from "@/jobs/scheduler";

// AD-002. La lógica de mora en sí ya está cubierta por
// recomputeContractDelinquency.integration.test.ts (BE-063): acá solo se
// prueba el cableado — que la corrida programada efectivamente la ejecuta y
// que el registro del cron ocurre una sola vez.
describe("scheduler de jobs (AD-002)", () => {
  afterAll(async () => {
    await cron.shutdown();
    await resetPhase1Tables();
  });

  it("runDelinquencyJob marca DELINQUENT un contrato ACTIVE con una cuota vencida más allá de la gracia", async () => {
    const { lenderUser, lenderCompany } = await createTestLenderCompany();
    const property = await createTestProperty(lenderCompany.id, lenderUser.id);
    const contract = await createTestContract({ lenderCompanyId: lenderCompany.id, propertyId: property.id, createdByUserId: lenderUser.id });
    const terms = await prisma.contractTerms.create({
      data: {
        contractId: contract.id,
        versionNumber: 1,
        structure: "AMORTIZED",
        principalAmount: 12_000,
        interestRate: 6,
        amortizationTermMonths: 12,
        firstPaymentDate: new Date(),
        paymentDueDay: 1,
        maturityDate: new Date(Date.now() + 365 * 86_400_000),
        lateFeeType: "FLAT",
        lateFeeAmount: 50,
        gracePeriodDays: 10,
        status: "ACCEPTED",
        createdByUserId: lenderUser.id,
      },
    });
    await prisma.contract.update({ where: { id: contract.id }, data: { status: "ACTIVE", activatedAt: new Date(), currentTermsId: terms.id } });
    await prisma.scheduledPayment.create({
      data: {
        contractId: contract.id,
        contractTermsId: terms.id,
        sequenceNumber: 1,
        dueDate: new Date(Date.now() - 30 * 86_400_000),
        principalDue: 900,
        interestDue: 60,
        totalDue: 960,
        projectedRemainingBalance: 11_100,
      },
    });

    await runDelinquencyJob();

    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("DELINQUENT");
  });

  it("startJobs registra la tarea una sola vez, aunque se llame de nuevo", async () => {
    await startJobs();
    await startJobs();

    const tasks = [...cron.getTasks().values()].filter((task) => task.name === "delinquency");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].getPattern()).toBe("0 2 * * *");
  });
});
