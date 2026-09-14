import { prisma } from "@/db/prisma";
import { logAuditEvent } from "@/lib/audit";

const DEFAULT_GRACE_PERIOD_DAYS = 10;

async function resolveGracePeriodDays(contractId: string): Promise<number> {
  const governingTerms = await prisma.contractTerms.findFirst({ where: { contractId, status: "ACCEPTED" }, select: { gracePeriodDays: true } });
  return governingTerms?.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS;
}

async function hasOverduePayment(contractId: string, gracePeriodDays: number, asOf: Date): Promise<boolean> {
  const cutoff = new Date(asOf);
  cutoff.setUTCDate(cutoff.getUTCDate() - gracePeriodDays);
  const overdue = await prisma.scheduledPayment.count({
    where: { contractId, status: { in: ["PENDING", "PARTIALLY_PAID"] }, dueDate: { lt: cutoff } },
  });
  return overdue > 0;
}

// BE-063. `Contract.status` ACTIVE<->DELINQUENT según mora
// (08-contratos.md §8.1: "ACTIVE -- mora > gracePeriodDays --> DELINQUENT --
// se pone al día --> ACTIVE"). Sin cron real todavía — decisión de
// implementación pendiente (ver src/jobs/README.md); se expone como función
// invocable, que un cron externo o node-cron llama diariamente.
export async function recomputeContractDelinquencyStatus(asOf: Date = new Date()): Promise<{ markedDelinquent: number; resolvedToActive: number }> {
  let markedDelinquent = 0;
  let resolvedToActive = 0;

  const activeContracts = await prisma.contract.findMany({ where: { status: "ACTIVE", deletedAt: null } });
  for (const contract of activeContracts) {
    const gracePeriodDays = await resolveGracePeriodDays(contract.id);
    if (await hasOverduePayment(contract.id, gracePeriodDays, asOf)) {
      await prisma.contract.update({ where: { id: contract.id }, data: { status: "DELINQUENT" } });
      await logAuditEvent({
        action: "CONTRACT_MARKED_DELINQUENT",
        entityType: "Contract",
        entityId: contract.id,
        systemActorLabel: "recomputeContractDelinquencyStatus",
        lenderCompanyId: contract.lenderCompanyId,
        contractId: contract.id,
      });
      markedDelinquent++;
    }
  }

  const delinquentContracts = await prisma.contract.findMany({ where: { status: "DELINQUENT", deletedAt: null } });
  for (const contract of delinquentContracts) {
    const gracePeriodDays = await resolveGracePeriodDays(contract.id);
    if (!(await hasOverduePayment(contract.id, gracePeriodDays, asOf))) {
      await prisma.contract.update({ where: { id: contract.id }, data: { status: "ACTIVE" } });
      await logAuditEvent({
        action: "CONTRACT_DELINQUENCY_RESOLVED",
        entityType: "Contract",
        entityId: contract.id,
        systemActorLabel: "recomputeContractDelinquencyStatus",
        lenderCompanyId: contract.lenderCompanyId,
        contractId: contract.id,
      });
      resolvedToActive++;
    }
  }

  return { markedDelinquent, resolvedToActive };
}
