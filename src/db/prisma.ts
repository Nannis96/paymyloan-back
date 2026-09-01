import { PrismaClient } from "@prisma/client";
import { env } from "@/config/env";

// Reutiliza la misma instancia entre recargas en caliente de `next dev`: sin
// esto, cada recarga crearía un nuevo pool de conexiones a Postgres.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}
