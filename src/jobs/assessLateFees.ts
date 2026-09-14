import { prisma } from "@/db/prisma";
import { logAuditEvent } from "@/lib/audit";

// BE-064. Aplica el cargo de mora una sola vez por fila vencida
// (`lateFeeAssessedAt` como guard de idempotencia) tras `gracePeriodDays`
// (BE-059/BE-063), usando `lateFeeType`/`lateFeeAmount` de la versión de
// ContractTerms que generó esa fila. Sin cron real todavía (ver
// src/jobs/README.md), se expone como función invocable.
export async function assessLateFee(asOf: Date = new Date()): Promise<{ assessed: number }> {
  const candidates = await prisma.scheduledPayment.findMany({
    where: { status: { in: ["PENDING", "PARTIALLY_PAID"] }, lateFeeAssessedAt: null },
    include: { contractTerms: true },
  });

  let assessed = 0;
  for (const row of candidates) {
    const cutoff = new Date(row.dueDate);
    cutoff.setUTCDate(cutoff.getUTCDate() + row.contractTerms.gracePeriodDays);
    if (asOf < cutoff) continue;

    const remainingDue = row.totalDue.minus(row.amountPaid);
    const lateFee =
      row.contractTerms.lateFeeType === "FLAT" ? row.contractTerms.lateFeeAmount : remainingDue.times(row.contractTerms.lateFeeAmount).div(100);

    await prisma.scheduledPayment.update({ where: { id: row.id }, data: { lateFeeAssessed: lateFee, lateFeeAssessedAt: asOf } });
    await logAuditEvent({
      action: "LATE_FEE_ASSESSED",
      entityType: "ScheduledPayment",
      entityId: row.id,
      systemActorLabel: "assessLateFee",
      contractId: row.contractId,
      metadata: { amount: lateFee.toString() },
    });
    assessed++;
  }

  return { assessed };
}
