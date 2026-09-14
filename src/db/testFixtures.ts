import type { UserRole } from "@prisma/client";
import { hashPassword } from "@/auth/password";
import { generateCodeForTesting, generateSecret } from "@/auth/totp";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import * as authService from "@/services/auth.service";

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

// Fase 2 (auth): a diferencia de createTestUser (hash literal "hash-de-
// prueba", nunca verificable), esta fixture hashea una contraseña real —
// hace falta para probar login/refresh/2FA de punta a punta.
export async function createTestUserWithPassword(role: UserRole, plainPassword: string) {
  const password = await hashPassword(plainPassword);
  return prisma.user.create({
    data: {
      name: `Test ${role} (con password real)`,
      email: `${unique(role.toLowerCase())}@test.local`,
      password,
      role,
    },
  });
}

// Idem, pero con 2FA ya activo — devuelve también el secreto en claro para
// que el test pueda generar códigos válidos con generateCodeForTesting().
export async function createTestUserWithTwoFactor(role: UserRole, plainPassword: string) {
  const password = await hashPassword(plainPassword);
  const secret = generateSecret();
  const user = await prisma.user.create({
    data: {
      name: `Test ${role} (2FA)`,
      email: `${unique(role.toLowerCase())}@test.local`,
      password,
      role,
      isTwoFactorEnabled: true,
      twoFactorSecret: secret,
    },
  });
  return { user, secret };
}

// Fase 3 (BE-036): hace el login real (y el paso 2 de 2FA si `secret` viene)
// contra authService directamente, para que un test HTTP que necesita un
// access token de un ADMIN/LENDER con 2FA activo no repita ese boilerplate.
export async function issueAccessTokenFor(user: { email: string }, password: string, secret?: string): Promise<string> {
  const step1 = await authService.login({ email: user.email, password });
  if (!step1.requiresTwoFactor) {
    return step1.accessToken;
  }
  if (!secret) {
    throw new Error("issueAccessTokenFor: el usuario tiene 2FA activo, hace falta pasar `secret`");
  }
  const step2 = await authService.loginTwoFactor({ pendingToken: step1.pendingToken, code: generateCodeForTesting(secret) });
  return step2.accessToken;
}

// D-P4-5: un Lender auto-registrado (D-P2-1) nace con LenderProfile pero sin
// ninguna LenderCompany — hace falta esta fixture separada de
// createTestLenderCompany (abajo) para probar justo ese caso ("primera
// empresa").
export async function createTestLenderWithoutCompany() {
  const adminUser = await createTestAdmin();
  const lenderUser = await createTestUser("LENDER");

  const lenderProfile = await prisma.lenderProfile.create({
    data: { userId: lenderUser.id, createdByAdminId: adminUser.id },
  });

  return { adminUser, lenderUser, lenderProfile };
}

export async function createTestLenderCompany(overrides: { companyName?: string } = {}) {
  const { adminUser, lenderUser, lenderProfile } = await createTestLenderWithoutCompany();

  const lenderCompany = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lenderProfile.id,
      companyName: overrides.companyName ?? `Test Lending Co ${unique("co")}`,
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

// Fase 6: contracts.service valida borrowerProfileIds contra LenderBorrower
// ACTIVE (07-autenticacion-y-autorizacion.md §7.5 punto 4) — hace falta este
// vínculo antes de poder asociar un deudor a un contrato en los tests.
export function linkBorrowerToLenderCompany(lenderCompanyId: string, borrowerProfileId: string, invitedByUserId: string) {
  return prisma.lenderBorrower.create({ data: { lenderCompanyId, borrowerProfileId, invitedByUserId } });
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
