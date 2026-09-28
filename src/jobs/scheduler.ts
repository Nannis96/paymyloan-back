import cron from "node-cron";
import { recomputeContractDelinquencyStatus } from "@/jobs/recomputeContractDelinquency";
import { logger } from "@/lib/logger";

// AD-002. Todos los días a las 02:00 UTC: los vencimientos (`dueDate`) caen a
// medianoche UTC, así que a esa hora el día anterior ya cerró completo.
const DELINQUENCY_SCHEDULE = "0 2 * * *";

// Un fallo nunca tumba el proceso ni la próxima corrida: se loguea y el
// siguiente ciclo (o el próximo arranque) vuelve a intentar.
export async function runDelinquencyJob(): Promise<void> {
  try {
    const result = await recomputeContractDelinquencyStatus();
    logger.info("Delinquency job finished", result);
  } catch (error) {
    logger.error("Delinquency job failed", { error: error instanceof Error ? error.message : String(error) });
  }
}

let started = false;

// ponytail: cron dentro del proceso, asume UNA sola instancia de `api` (así
// está docker-compose.yml). Con réplicas cada una correría el job — es
// idempotente, pero duplicaría el audit de un mismo cambio: pasar a un cron
// externo o a un advisory lock de Postgres.
//
// Devuelve la corrida de arranque para poder esperarla en tests; quien la
// llama en producción (src/instrumentation.ts) no la espera.
export function startJobs(schedule: string = DELINQUENCY_SCHEDULE): Promise<void> {
  if (started) return Promise.resolve();
  started = true;

  cron.schedule(schedule, runDelinquencyJob, { timezone: "UTC", name: "delinquency" });
  logger.info("Scheduled jobs registered", { delinquency: schedule });

  // Catch-up: si el contenedor estuvo caído a las 02:00, no espera un día
  // más para converger.
  return runDelinquencyJob();
}
