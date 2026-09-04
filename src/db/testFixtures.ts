import type { UserRole } from "@prisma/client";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";

// Fixtures compartidas por los tests de integración de Fase 1 (ver
// Docs/plan/16-fase-1-actualizada.md). Construyen la cadena mínima
// User -> LenderProfile -> LenderCompany -> ... contra Postgres real, nunca
// contra mocks de Prisma (ver plan de backend §11).

let sequence = 0;
function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

export async function createTestUser(role: UserRole) {
  return prisma.user.create({
    data: {
      name: `Test ${role}`,
      email: `${unique(role.toLowerCase())}@test.local`,
      password: "hash-de-prueba",
      role,
    },
  });
}

export function createTestAdmin() {
  return createTestUser("ADMIN");
}

export async function createTestLenderCompany() {
  const adminUser = await createTestAdmin();
  const lenderUser = await createTestUser("LENDER");

  const lenderProfile = await prisma.lenderProfile.create({
    data: { userId: lenderUser.id, createdByAdminId: adminUser.id },
  });

  const lenderCompany = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lenderProfile.id,
      companyName: `Test Lending Co ${unique("co")}`,
      ein: unique("ein"),
      addressLine1: "123 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: lenderUser.id,
    },
  });

  return { adminUser, lenderUser, lenderProfile, lenderCompany };
}

export async function createTestBorrower() {
  const user = await createTestUser("BORROWER");
  const borrowerProfile = await prisma.borrowerProfile.create({
    data: { userId: user.id },
  });
  return { user, borrowerProfile };
}

export function createTestProperty(lenderCompanyId: string, createdByUserId: string) {
  return prisma.property.create({
    data: {
      addressLine1: "456 Oak Ave",
      city: "Austin",
      state: "TX",
      postalCode: "78702",
      propertyType: "SINGLE_FAMILY",
      lenderCompanyId,
      createdByUserId,
    },
  });
}

export function createTestContract(params: { lenderCompanyId: string; propertyId: string; createdByUserId: string }) {
  return prisma.contract.create({
    data: {
      lenderCompanyId: params.lenderCompanyId,
      propertyId: params.propertyId,
      createdByUserId: params.createdByUserId,
      contractNumber: unique("PML-TEST"),
    },
  });
}

// Guardado defensivo: nunca se ejecuta fuera de NODE_ENV=test, para que un
// error de configuración no pueda vaciar por accidente la base de
// desarrollo. `db-test` es tmpfs (sin volumen, se descarta al bajar el
// stack) — este truncate solo evita que crezca sin límite entre corridas
// repetidas de la suite mientras el contenedor sigue arriba.
export async function resetPhase1Tables(): Promise<void> {
  if (!env.isTest) {
    throw new Error("resetPhase1Tables() solo puede correr con NODE_ENV=test");
  }
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "users" CASCADE');
}
