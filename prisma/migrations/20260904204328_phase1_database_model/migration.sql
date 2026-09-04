/*
  Warnings:

  - Added the required column `role` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'LENDER', 'BORROWER', 'BOOKKEEPER', 'INSURANCE_COMPANY');

-- CreateEnum
CREATE TYPE "LenderCompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TenantLinkStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('SINGLE_FAMILY', 'MULTI_FAMILY', 'CONDO', 'TOWNHOUSE', 'LAND', 'COMMERCIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'PENDING_ACCEPTANCE', 'ACTIVE', 'DELINQUENT', 'PAID_OFF', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractTermsStatus" AS ENUM ('DRAFT', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AcceptanceDecision" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LoanStructure" AS ENUM ('INTEREST_ONLY', 'AMORTIZED', 'BALLOON');

-- CreateEnum
CREATE TYPE "DayCountConvention" AS ENUM ('THIRTY_360', 'ACTUAL_365');

-- CreateEnum
CREATE TYPE "LateFeeType" AS ENUM ('FLAT', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "ScheduledPaymentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'VOIDED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('SCHEDULED_PAYMENT', 'PRINCIPAL_PREPAYMENT', 'PAYOFF_PAYMENT', 'LATE_FEE_PAYMENT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RETURNED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethodChannel" AS ENUM ('ACH', 'WIRE', 'CHECK', 'CARD', 'MANUAL');

-- CreateEnum
CREATE TYPE "AllocationType" AS ENUM ('LATE_FEE', 'INTEREST', 'PRINCIPAL');

-- CreateEnum
CREATE TYPE "PaymentMethodStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PaymentMethodVerificationStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AutopayStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutopayAmountType" AS ENUM ('SCHEDULED_AMOUNT_DUE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "WebhookProvider" AS ENUM ('STRIPE');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "role" "UserRole" NOT NULL;

-- CreateTable
CREATE TABLE "lender_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "contactPhone" TEXT,
    "createdByAdminId" UUID NOT NULL,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lender_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_companies" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lenderProfileId" UUID NOT NULL,
    "companyName" TEXT NOT NULL,
    "ein" TEXT NOT NULL,
    "contactPhone" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "postalCode" TEXT NOT NULL,
    "isOpenToDeals" BOOLEAN NOT NULL DEFAULT true,
    "status" "LenderCompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeConnectedAccountId" TEXT,
    "createdByUserId" UUID NOT NULL,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lender_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "borrower_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "phone" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "state" VARCHAR(2),
    "postalCode" TEXT,
    "createdByUserId" UUID,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "borrower_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_borrowers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lenderCompanyId" UUID NOT NULL,
    "borrowerProfileId" UUID NOT NULL,
    "status" "TenantLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "invitedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "lender_borrowers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeper_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "phone" TEXT,
    "createdByUserId" UUID NOT NULL,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookkeeper_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_company_bookkeepers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lenderCompanyId" UUID NOT NULL,
    "bookkeeperProfileId" UUID NOT NULL,
    "status" "TenantLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "lender_company_bookkeepers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_company_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactPhone" TEXT,
    "licenseNumber" TEXT,
    "createdByAdminId" UUID NOT NULL,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "postalCode" TEXT NOT NULL,
    "county" TEXT,
    "parcelNumber" TEXT,
    "propertyType" "PropertyType" NOT NULL,
    "bedrooms" INTEGER,
    "bathrooms" DECIMAL(3,1),
    "squareFootage" INTEGER,
    "lotSize" INTEGER,
    "yearBuilt" INTEGER,
    "conditionScale" INTEGER,
    "estimatedRepairCost" DECIMAL(14,2),
    "estimatedMarketValue" DECIMAL(14,2),
    "afterRepairValue" DECIMAL(14,2),
    "lastSalePrice" DECIMAL(14,2),
    "lastSaleDate" TIMESTAMP(3),
    "annualPropertyTax" DECIMAL(14,2),
    "annualInsuranceEstimate" DECIMAL(14,2),
    "createdByUserId" UUID NOT NULL,
    "lenderCompanyId" UUID NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lenderCompanyId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "insuranceCompanyId" UUID,
    "contractNumber" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "currentTermsId" UUID,
    "currentPrincipalBalance" DECIMAL(14,2),
    "nextPaymentDueDate" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "activatedAt" TIMESTAMP(3),
    "paidOffAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_terms" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "contractId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "structure" "LoanStructure" NOT NULL,
    "principalAmount" DECIMAL(14,2) NOT NULL,
    "interestRate" DECIMAL(6,3) NOT NULL,
    "dayCountConvention" "DayCountConvention" NOT NULL DEFAULT 'THIRTY_360',
    "amortizationTermMonths" INTEGER NOT NULL,
    "firstPaymentDate" TIMESTAMP(3) NOT NULL,
    "paymentDueDay" INTEGER NOT NULL,
    "maturityDate" TIMESTAMP(3) NOT NULL,
    "lateFeeType" "LateFeeType" NOT NULL,
    "lateFeeAmount" DECIMAL(14,2) NOT NULL,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 10,
    "calculatedMonthlyPayment" DECIMAL(14,2),
    "status" "ContractTermsStatus" NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" UUID NOT NULL,
    "changeSummary" TEXT,
    "supersedesId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_terms_acceptances" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "contractTermsId" UUID NOT NULL,
    "borrowerProfileId" UUID NOT NULL,
    "decision" "AcceptanceDecision" NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_terms_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_borrowers" (
    "contractId" UUID NOT NULL,
    "borrowerProfileId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "addedByUserId" UUID NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "contract_borrowers_pkey" PRIMARY KEY ("contractId","borrowerProfileId")
);

-- CreateTable
CREATE TABLE "scheduled_payments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "contractId" UUID NOT NULL,
    "contractTermsId" UUID NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "principalDue" DECIMAL(14,2) NOT NULL,
    "interestDue" DECIMAL(14,2) NOT NULL,
    "totalDue" DECIMAL(14,2) NOT NULL,
    "projectedRemainingBalance" DECIMAL(14,2) NOT NULL,
    "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "ScheduledPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidInFullAt" TIMESTAMP(3),
    "lateFeeAssessed" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lateFeeAssessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "contractId" UUID NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethodChannel" NOT NULL DEFAULT 'ACH',
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
    "stripePaymentIntentId" TEXT,
    "stripeChargeId" TEXT,
    "stripePaymentMethodId" TEXT,
    "last4" TEXT,
    "failureReason" TEXT,
    "returnCode" TEXT,
    "initiatedByUserId" UUID,
    "initiatedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_allocations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "transactionId" UUID NOT NULL,
    "scheduledPaymentId" UUID,
    "allocationType" "AllocationType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "status" "PaymentMethodStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT NOT NULL,
    "stripePaymentMethodId" TEXT NOT NULL,
    "bankName" TEXT,
    "last4" TEXT NOT NULL,
    "verificationStatus" "PaymentMethodVerificationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autopays" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "contractId" UUID NOT NULL,
    "borrowerProfileId" UUID NOT NULL,
    "paymentMethodId" UUID NOT NULL,
    "status" "AutopayStatus" NOT NULL DEFAULT 'ACTIVE',
    "amountType" "AutopayAmountType" NOT NULL,
    "fixedAmount" DECIMAL(14,2),
    "nextAttemptScheduledFor" TIMESTAMP(3),
    "cancelledByUserId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autopays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "provider" "WebhookProvider" NOT NULL DEFAULT 'STRIPE',
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actorUserId" UUID,
    "isSystemActor" BOOLEAN NOT NULL DEFAULT false,
    "systemActorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "lenderCompanyId" UUID,
    "contractId" UUID,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenId" UUID,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lender_profiles_userId_key" ON "lender_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "lender_companies_ein_key" ON "lender_companies"("ein");

-- CreateIndex
CREATE INDEX "lender_companies_lenderProfileId_idx" ON "lender_companies"("lenderProfileId");

-- CreateIndex
CREATE INDEX "lender_companies_status_idx" ON "lender_companies"("status");

-- CreateIndex
CREATE UNIQUE INDEX "borrower_profiles_userId_key" ON "borrower_profiles"("userId");

-- CreateIndex
CREATE INDEX "lender_borrowers_borrowerProfileId_idx" ON "lender_borrowers"("borrowerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "lender_borrowers_lenderCompanyId_borrowerProfileId_key" ON "lender_borrowers"("lenderCompanyId", "borrowerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeper_profiles_userId_key" ON "bookkeeper_profiles"("userId");

-- CreateIndex
CREATE INDEX "lender_company_bookkeepers_bookkeeperProfileId_idx" ON "lender_company_bookkeepers"("bookkeeperProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "lender_company_bookkeepers_lenderCompanyId_bookkeeperProfil_key" ON "lender_company_bookkeepers"("lenderCompanyId", "bookkeeperProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_company_profiles_userId_key" ON "insurance_company_profiles"("userId");

-- CreateIndex
CREATE INDEX "properties_lenderCompanyId_idx" ON "properties"("lenderCompanyId");

-- CreateIndex
CREATE INDEX "properties_createdByUserId_idx" ON "properties"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contractNumber_key" ON "contracts"("contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_currentTermsId_key" ON "contracts"("currentTermsId");

-- CreateIndex
CREATE INDEX "contracts_lenderCompanyId_status_idx" ON "contracts"("lenderCompanyId", "status");

-- CreateIndex
CREATE INDEX "contracts_lenderCompanyId_createdAt_idx" ON "contracts"("lenderCompanyId", "createdAt");

-- CreateIndex
CREATE INDEX "contracts_propertyId_idx" ON "contracts"("propertyId");

-- CreateIndex
CREATE INDEX "contracts_insuranceCompanyId_idx" ON "contracts"("insuranceCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_terms_supersedesId_key" ON "contract_terms"("supersedesId");

-- CreateIndex
CREATE INDEX "contract_terms_contractId_status_idx" ON "contract_terms"("contractId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_terms_contractId_versionNumber_key" ON "contract_terms"("contractId", "versionNumber");

-- CreateIndex
CREATE INDEX "contract_terms_acceptances_borrowerProfileId_idx" ON "contract_terms_acceptances"("borrowerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_terms_acceptances_contractTermsId_borrowerProfileI_key" ON "contract_terms_acceptances"("contractTermsId", "borrowerProfileId");

-- CreateIndex
CREATE INDEX "contract_borrowers_borrowerProfileId_idx" ON "contract_borrowers"("borrowerProfileId");

-- CreateIndex
CREATE INDEX "scheduled_payments_contractId_dueDate_idx" ON "scheduled_payments"("contractId", "dueDate");

-- CreateIndex
CREATE INDEX "scheduled_payments_contractId_status_idx" ON "scheduled_payments"("contractId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_payments_contractTermsId_sequenceNumber_key" ON "scheduled_payments"("contractTermsId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_stripePaymentIntentId_key" ON "transactions"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "transactions_contractId_status_idx" ON "transactions"("contractId", "status");

-- CreateIndex
CREATE INDEX "transactions_contractId_createdAt_idx" ON "transactions"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "transaction_allocations_transactionId_idx" ON "transaction_allocations"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_allocations_scheduledPaymentId_idx" ON "transaction_allocations"("scheduledPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_stripePaymentMethodId_key" ON "payment_methods"("stripePaymentMethodId");

-- CreateIndex
CREATE INDEX "payment_methods_userId_idx" ON "payment_methods"("userId");

-- CreateIndex
CREATE INDEX "autopays_status_nextAttemptScheduledFor_idx" ON "autopays"("status", "nextAttemptScheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "autopays_contractId_borrowerProfileId_key" ON "autopays"("contractId", "borrowerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_externalEventId_key" ON "webhook_events"("externalEventId");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE INDEX "audit_logs_lenderCompanyId_createdAt_idx" ON "audit_logs"("lenderCompanyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_contractId_createdAt_idx" ON "audit_logs"("contractId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replacedByTokenId_key" ON "refresh_tokens"("replacedByTokenId");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_recovery_codes_codeHash_key" ON "two_factor_recovery_codes"("codeHash");

-- AddForeignKey
ALTER TABLE "lender_profiles" ADD CONSTRAINT "lender_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_profiles" ADD CONSTRAINT "lender_profiles_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_companies" ADD CONSTRAINT "lender_companies_lenderProfileId_fkey" FOREIGN KEY ("lenderProfileId") REFERENCES "lender_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_companies" ADD CONSTRAINT "lender_companies_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrower_profiles" ADD CONSTRAINT "borrower_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borrower_profiles" ADD CONSTRAINT "borrower_profiles_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_borrowers" ADD CONSTRAINT "lender_borrowers_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_borrowers" ADD CONSTRAINT "lender_borrowers_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "borrower_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_borrowers" ADD CONSTRAINT "lender_borrowers_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeper_profiles" ADD CONSTRAINT "bookkeeper_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeper_profiles" ADD CONSTRAINT "bookkeeper_profiles_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_company_bookkeepers" ADD CONSTRAINT "lender_company_bookkeepers_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_company_bookkeepers" ADD CONSTRAINT "lender_company_bookkeepers_bookkeeperProfileId_fkey" FOREIGN KEY ("bookkeeperProfileId") REFERENCES "bookkeeper_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_company_bookkeepers" ADD CONSTRAINT "lender_company_bookkeepers_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_company_profiles" ADD CONSTRAINT "insurance_company_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_company_profiles" ADD CONSTRAINT "insurance_company_profiles_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_insuranceCompanyId_fkey" FOREIGN KEY ("insuranceCompanyId") REFERENCES "insurance_company_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_currentTermsId_fkey" FOREIGN KEY ("currentTermsId") REFERENCES "contract_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms" ADD CONSTRAINT "contract_terms_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms" ADD CONSTRAINT "contract_terms_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms" ADD CONSTRAINT "contract_terms_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "contract_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms_acceptances" ADD CONSTRAINT "contract_terms_acceptances_contractTermsId_fkey" FOREIGN KEY ("contractTermsId") REFERENCES "contract_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms_acceptances" ADD CONSTRAINT "contract_terms_acceptances_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "borrower_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_borrowers" ADD CONSTRAINT "contract_borrowers_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_borrowers" ADD CONSTRAINT "contract_borrowers_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "borrower_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_borrowers" ADD CONSTRAINT "contract_borrowers_addedByUserId_fkey" FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_payments" ADD CONSTRAINT "scheduled_payments_contractTermsId_fkey" FOREIGN KEY ("contractTermsId") REFERENCES "contract_terms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_allocations" ADD CONSTRAINT "transaction_allocations_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_allocations" ADD CONSTRAINT "transaction_allocations_scheduledPaymentId_fkey" FOREIGN KEY ("scheduledPaymentId") REFERENCES "scheduled_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopays" ADD CONSTRAINT "autopays_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopays" ADD CONSTRAINT "autopays_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "borrower_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopays" ADD CONSTRAINT "autopays_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autopays" ADD CONSTRAINT "autopays_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
