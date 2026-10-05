import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { DEV_PASSWORD, DEV_TOTP_SECRET } from "./seeds/ctx";
import { seedContracts } from "./seeds/contracts";
import { seedExtras } from "./seeds/extras";
import { seedIdentity } from "./seeds/identity";
import { seedMarketplace } from "./seeds/marketplace";
import { seedPayments } from "./seeds/payments";

// Semilla de desarrollo — Docs/plan/10-migraciones-y-seeders.md §10.2. Nunca corre
// en producción; idempotente (si ya existe el admin de desarrollo, no repite nada).
// Orden = dependencias del flujo: identidad → marketplace → contratos (directos y
// convertidos) → pagos → verificaciones/mensajes/reseñas/notificaciones.
async function main() {
  if (env.isProduction) throw new Error("prisma/seed.ts no puede correr con NODE_ENV=production");
  if (await prisma.user.findUnique({ where: { email: "admin@paymyloan.dev" } })) {
    console.log("Seed ya aplicado (admin@paymyloan.dev existe) — no se repite. Nada que hacer.");
    return;
  }

  const ctx = await seedIdentity();
  await seedMarketplace(ctx);
  await seedContracts(ctx);
  await seedPayments(ctx);
  await seedExtras(ctx);

  const counts = {
    users: await prisma.user.count(), contracts: await prisma.contract.count(), loanRequests: await prisma.loanRequest.count(),
    transactions: await prisma.transaction.count(), notifications: await prisma.notification.count(),
  };
  console.log("Seed completo:", counts);
  console.log(`Todos los usuarios @paymyloan.dev usan la contraseña ${DEV_PASSWORD}`);
  console.log("admin | lender1..4 | borrower1..8 | bookkeeper1..2 | insurance1..3");
  console.log(`2FA (TOTP ${DEV_TOTP_SECRET}): admin2fa, lender2fa, borrower2fa — lender4/borrower8/insurance3 están inactivos`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
