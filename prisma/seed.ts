import bcrypt from "bcryptjs";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { logAuditEvent } from "@/lib/audit";

// BE-023. Semilla de desarrollo de la Fase 1 — ver
// Docs/plan/16-fase-1-actualizada.md y Docs/plan/10-migraciones-y-seeders.md
// §10.2. Nunca corre en producción; idempotente (si ya existe el admin de
// desarrollo, no repite el resto).
const DEV_PASSWORD = "DevPass!2026";

async function main() {
  if (env.isProduction) {
    throw new Error("prisma/seed.ts no puede correr con NODE_ENV=production");
  }

  const existingAdmin = await prisma.user.findUnique({ where: { email: "admin@paymyloan.dev" } });
  if (existingAdmin) {
    console.log("Seed ya aplicado (admin@paymyloan.dev existe) — no se repite. Nada que hacer.");
    return;
  }

  const password = await bcrypt.hash(DEV_PASSWORD, env.bcryptCost);

  // --- Admin ---------------------------------------------------------------
  const admin = await prisma.user.create({
    data: { name: "Dev Admin", email: "admin@paymyloan.dev", password, role: "ADMIN" },
  });

  // --- Lender 1: dos empresas (prueba el selector multi-empresa, D-P1-3) ---
  const lender1User = await prisma.user.create({
    data: { name: "Lender One", email: "lender1@paymyloan.dev", password, role: "LENDER" },
  });
  const lender1Profile = await prisma.lenderProfile.create({
    data: { userId: lender1User.id, createdByAdminId: admin.id },
  });
  const lender1CompanyA = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lender1Profile.id,
      companyName: "Lone Star Capital LLC",
      ein: "12-3456789",
      addressLine1: "100 Congress Ave",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: lender1User.id,
      isOpenToDeals: true,
    },
  });
  const lender1CompanyB = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lender1Profile.id,
      companyName: "Lone Star Capital II LLC",
      ein: "12-3456790",
      addressLine1: "100 Congress Ave, Suite 200",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
      createdByUserId: lender1User.id,
      isOpenToDeals: false, // "Not Taking Loans" — Product Board
    },
  });

  // --- Lender 2: una sola empresa -------------------------------------------
  const lender2User = await prisma.user.create({
    data: { name: "Lender Two", email: "lender2@paymyloan.dev", password, role: "LENDER" },
  });
  const lender2Profile = await prisma.lenderProfile.create({
    data: { userId: lender2User.id, createdByAdminId: admin.id },
  });
  const lender2Company = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lender2Profile.id,
      companyName: "Hill Country Lending LLC",
      ein: "98-7654321",
      addressLine1: "500 Barton Springs Rd",
      city: "Austin",
      state: "TX",
      postalCode: "78704",
      createdByUserId: lender2User.id,
    },
  });

  // --- Lender 3: auto-registrado, sin Admin (D-P1-10) -----------------------
  const lender3User = await prisma.user.create({
    data: { name: "Lender Three (self-registered)", email: "lender3@paymyloan.dev", password, role: "LENDER" },
  });
  const lender3Profile = await prisma.lenderProfile.create({
    data: { userId: lender3User.id, createdByAdminId: null },
  });
  const lender3Company = await prisma.lenderCompany.create({
    data: {
      lenderProfileId: lender3Profile.id,
      companyName: "Blue Bonnet Bridge Loans LLC",
      ein: "45-1122334",
      addressLine1: "900 South Lamar Blvd",
      city: "Austin",
      state: "TX",
      postalCode: "78704",
      createdByUserId: lender3User.id,
    },
  });

  // --- Borrowers: 3, uno vinculado a las 2 empresas (D-P1-4 / M-1) ---------
  // Los 3 nacen sin createdByUserId (self-registrados, D-P1-10) — a
  // diferencia de las empresas, acá no hay un flujo "Lender crea Borrower
  // desde cero" en este seed, solo el vínculo LenderBorrower de abajo.
  const borrower1User = await prisma.user.create({
    // phone vive en User (D-P2-4), no en BorrowerProfile (D-P5-2, ya eliminado).
    data: { name: "Borrower One", email: "borrower1@paymyloan.dev", password, role: "BORROWER", phone: "5125550201" },
  });
  const borrower1Profile = await prisma.borrowerProfile.create({
    data: { userId: borrower1User.id },
  });

  const borrower2User = await prisma.user.create({
    data: { name: "Borrower Two", email: "borrower2@paymyloan.dev", password, role: "BORROWER" },
  });
  const borrower2Profile = await prisma.borrowerProfile.create({ data: { userId: borrower2User.id } });

  const borrower3User = await prisma.user.create({
    data: { name: "Borrower Three (multi-lender)", email: "borrower3@paymyloan.dev", password, role: "BORROWER" },
  });
  const borrower3Profile = await prisma.borrowerProfile.create({ data: { userId: borrower3User.id } });

  await prisma.lenderBorrower.create({
    data: { lenderCompanyId: lender1CompanyA.id, borrowerProfileId: borrower1Profile.id, invitedByUserId: lender1User.id },
  });
  await prisma.lenderBorrower.create({
    data: { lenderCompanyId: lender2Company.id, borrowerProfileId: borrower2Profile.id, invitedByUserId: lender2User.id },
  });
  await prisma.lenderBorrower.create({
    data: {
      lenderCompanyId: lender1CompanyA.id,
      borrowerProfileId: borrower3Profile.id,
      invitedByUserId: lender1User.id,
      notes: "Deudor recurrente, buen historial con Lone Star.",
    },
  });
  await prisma.lenderBorrower.create({
    data: { lenderCompanyId: lender2Company.id, borrowerProfileId: borrower3Profile.id, invitedByUserId: lender2User.id },
  });

  // --- Bookkeeper (D-P1-6) ---------------------------------------------------
  const bookkeeperUser = await prisma.user.create({
    data: { name: "Dev Bookkeeper", email: "bookkeeper1@paymyloan.dev", password, role: "BOOKKEEPER" },
  });
  const bookkeeperProfile = await prisma.bookkeeperProfile.create({
    data: { userId: bookkeeperUser.id, createdByUserId: lender1User.id },
  });
  await prisma.lenderCompanyBookkeeper.create({
    data: { lenderCompanyId: lender1CompanyA.id, bookkeeperProfileId: bookkeeperProfile.id, invitedByUserId: lender1User.id },
  });

  // --- Insurance Company, directorio de plataforma (D-P1-7) -----------------
  const insuranceUser = await prisma.user.create({
    data: { name: "Dev Insurance Co", email: "insurance1@paymyloan.dev", password, role: "INSURANCE_COMPANY" },
  });
  const insuranceProfile = await prisma.insuranceCompanyProfile.create({
    data: { userId: insuranceUser.id, companyName: "Capitol Title & Insurance", createdByAdminId: admin.id },
  });

  // --- Properties (D-P1-5), valuation/ARV/taxes cargados a mano -------------
  const propertyDraft = await prisma.property.create({
    data: {
      addressLine1: "742 Evergreen Terrace",
      city: "Austin",
      state: "TX",
      postalCode: "78745",
      county: "Travis",
      propertyType: "SINGLE_FAMILY",
      bedrooms: 3,
      bathrooms: "2.0",
      squareFootage: 1650,
      yearBuilt: 1998,
      conditionScale: 2,
      estimatedRepairCost: "12000.00",
      estimatedMarketValue: "310000.00",
      afterRepairValue: "345000.00",
      annualPropertyTax: "6200.00",
      annualInsuranceEstimate: "1450.00",
      lenderCompanyId: lender1CompanyA.id,
      createdByUserId: lender1User.id,
    },
  });

  const propertyActive = await prisma.property.create({
    data: {
      addressLine1: "1600 Riverside Dr",
      addressLine2: "Unit 4",
      city: "Austin",
      state: "TX",
      postalCode: "78704",
      county: "Travis",
      propertyType: "CONDO",
      bedrooms: 2,
      bathrooms: "2.0",
      squareFootage: 980,
      yearBuilt: 2015,
      conditionScale: 0,
      estimatedMarketValue: "425000.00",
      afterRepairValue: "425000.00",
      annualPropertyTax: "8900.00",
      annualInsuranceEstimate: "1800.00",
      lenderCompanyId: lender2Company.id,
      createdByUserId: lender2User.id,
    },
  });

  await prisma.property.create({
    data: {
      addressLine1: "88 Barton Skyway",
      city: "Austin",
      state: "TX",
      postalCode: "78746",
      propertyType: "MULTI_FAMILY",
      lenderCompanyId: lender1CompanyA.id,
      createdByUserId: lender1User.id,
    },
  });

  // --- Contrato de ejemplo en DRAFT -----------------------------------------
  const draftContract = await prisma.contract.create({
    data: {
      lenderCompanyId: lender1CompanyA.id,
      propertyId: propertyDraft.id,
      createdByUserId: lender1User.id,
      contractNumber: "PML-2026-000001",
    },
  });
  await prisma.contractTerms.create({
    data: {
      contractId: draftContract.id,
      versionNumber: 1,
      structure: "AMORTIZED",
      principalAmount: "250000.00",
      interestRate: "9.500",
      amortizationTermMonths: 360,
      firstPaymentDate: new Date("2026-11-01"),
      paymentDueDay: 1,
      maturityDate: new Date("2029-10-01"),
      lateFeeType: "FLAT",
      lateFeeAmount: "75.00",
      createdByUserId: lender1User.id,
    },
  });
  await prisma.contractBorrower.create({
    data: { contractId: draftContract.id, borrowerProfileId: borrower1Profile.id, addedByUserId: lender1User.id },
  });

  // --- Contrato de ejemplo ACTIVE, con calendario simplificado --------------
  // La generación real del calendario (PMT, interest-only, balloon) llega en
  // Fase 6 (BE-058/BE-059) — acá se insertan 3 filas a mano solo para tener
  // datos de ejemplo navegables por API/Prisma Studio.
  const activeContract = await prisma.contract.create({
    data: {
      lenderCompanyId: lender2Company.id,
      propertyId: propertyActive.id,
      insuranceCompanyId: insuranceProfile.id,
      createdByUserId: lender2User.id,
      contractNumber: "PML-2026-000002",
      status: "ACTIVE",
      activatedAt: new Date("2026-08-01"),
      currentPrincipalBalance: "180000.00",
      nextPaymentDueDate: new Date("2026-10-01"),
    },
  });
  const activeTerms = await prisma.contractTerms.create({
    data: {
      contractId: activeContract.id,
      versionNumber: 1,
      structure: "INTEREST_ONLY",
      principalAmount: "180000.00",
      interestRate: "10.000",
      amortizationTermMonths: 360,
      firstPaymentDate: new Date("2026-09-01"),
      paymentDueDay: 1,
      maturityDate: new Date("2027-08-01"),
      lateFeeType: "PERCENTAGE",
      lateFeeAmount: "5.00",
      status: "ACCEPTED",
      createdByUserId: lender2User.id,
    },
  });
  await prisma.contract.update({ where: { id: activeContract.id }, data: { currentTermsId: activeTerms.id } });
  await prisma.contractBorrower.create({
    data: { contractId: activeContract.id, borrowerProfileId: borrower2Profile.id, addedByUserId: lender2User.id },
  });
  await prisma.contractTermsAcceptance.create({
    data: {
      contractTermsId: activeTerms.id,
      borrowerProfileId: borrower2Profile.id,
      decision: "ACCEPTED",
      decidedAt: new Date("2026-08-01"),
    },
  });

  const scheduleDates = [new Date("2026-09-01"), new Date("2026-10-01"), new Date("2026-11-01")];
  const scheduledPayments = await Promise.all(
    scheduleDates.map((dueDate, index) =>
      prisma.scheduledPayment.create({
        data: {
          contractId: activeContract.id,
          contractTermsId: activeTerms.id,
          sequenceNumber: index + 1,
          dueDate,
          principalDue: "0.00",
          interestDue: "1500.00",
          totalDue: "1500.00",
          projectedRemainingBalance: "180000.00",
          status: index === 0 ? "PAID" : "PENDING",
          amountPaid: index === 0 ? "1500.00" : "0.00",
          paidInFullAt: index === 0 ? new Date("2026-09-02") : null,
        },
      }),
    ),
  );

  // Demuestra la separación ScheduledPayment (lo que se debe) / Transaction
  // (lo que ocurrió) / TransactionAllocation (el reparto) — la corrección
  // central sobre el `Payment` monolítico de Owner.
  const firstPaymentTransaction = await prisma.transaction.create({
    data: {
      contractId: activeContract.id,
      type: "SCHEDULED_PAYMENT",
      status: "SUCCEEDED",
      method: "ACH",
      amount: "1500.00",
      initiatedByUserId: borrower2User.id,
      processedAt: new Date("2026-09-02"),
      settledAt: new Date("2026-09-02"),
    },
  });
  await prisma.transactionAllocation.create({
    data: {
      transactionId: firstPaymentTransaction.id,
      scheduledPaymentId: scheduledPayments[0].id,
      allocationType: "INTEREST",
      amount: "1500.00",
    },
  });

  await logAuditEvent({
    action: "CONTRACT_ACTIVATED",
    entityType: "Contract",
    entityId: activeContract.id,
    actorUserId: lender2User.id,
    lenderCompanyId: lender2Company.id,
    contractId: activeContract.id,
    metadata: { seed: true },
  });

  console.log("Seed completo.");
  console.log(`Admin:      admin@paymyloan.dev / ${DEV_PASSWORD}`);
  console.log(`Lender 1:   lender1@paymyloan.dev / ${DEV_PASSWORD} (empresas: "${lender1CompanyA.companyName}", "${lender1CompanyB.companyName}")`);
  console.log(`Lender 2:   lender2@paymyloan.dev / ${DEV_PASSWORD} (empresa: "${lender2Company.companyName}")`);
  console.log(`Lender 3:   lender3@paymyloan.dev / ${DEV_PASSWORD} (auto-registrado, sin Admin — empresa: "${lender3Company.companyName}")`);
  console.log(`Borrowers:  borrower1..3@paymyloan.dev / ${DEV_PASSWORD} (los 3 auto-registrados; borrower3 vinculado a 2 lenders)`);
  console.log(`Bookkeeper: bookkeeper1@paymyloan.dev / ${DEV_PASSWORD}`);
  console.log(`Insurance:  insurance1@paymyloan.dev / ${DEV_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
