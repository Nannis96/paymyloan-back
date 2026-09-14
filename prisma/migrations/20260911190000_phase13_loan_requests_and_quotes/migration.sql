-- CreateEnum
CREATE TYPE "ContractOriginationSource" AS ENUM ('DIRECT', 'MARKETPLACE', 'PRIVATE_INVITE');

-- CreateEnum
CREATE TYPE "LoanRequestVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "LoanRequestStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'MATCHED', 'WITHDRAWN', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('RENTAL', 'FIX_AND_FLIP', 'SLOW_FLIP', 'COMMERCIAL', 'NEW_CONSTRUCTION');

-- CreateEnum
CREATE TYPE "LoanQuoteStatus" AS ENUM ('SUBMITTED', 'WITHDRAWN', 'DECLINED', 'SELECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "loanRequestId" UUID,
ADD COLUMN     "originationSource" "ContractOriginationSource" NOT NULL DEFAULT 'DIRECT';

-- AlterTable
ALTER TABLE "properties" ALTER COLUMN "lenderCompanyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "loan_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "borrowerProfileId" UUID NOT NULL,
    "propertyId" UUID NOT NULL,
    "projectType" "ProjectType" NOT NULL,
    "purchasePrice" DECIMAL(14,2) NOT NULL,
    "rehabAmount" DECIMAL(14,2) NOT NULL,
    "totalLoanAmountRequested" DECIMAL(14,2) NOT NULL,
    "requestedClosingDate" TIMESTAMP(3) NOT NULL,
    "requestedTimelineNotes" TEXT,
    "visibility" "LoanRequestVisibility" NOT NULL,
    "status" "LoanRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "matchedLenderCompanyId" UUID,
    "matchedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_request_lender_targets" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "loanRequestId" UUID NOT NULL,
    "lenderCompanyId" UUID NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "loan_request_lender_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_quotes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "loanRequestId" UUID NOT NULL,
    "lenderCompanyId" UUID NOT NULL,
    "structure" "LoanStructure" NOT NULL,
    "principalAmount" DECIMAL(14,2) NOT NULL,
    "interestRate" DECIMAL(6,3) NOT NULL,
    "amortizationTermMonths" INTEGER NOT NULL,
    "estimatedClosingCostsAmount" DECIMAL(14,2),
    "message" TEXT,
    "status" "LoanQuoteStatus" NOT NULL DEFAULT 'SUBMITTED',
    "expiresAt" TIMESTAMP(3),
    "submittedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_requests_borrowerProfileId_idx" ON "loan_requests"("borrowerProfileId");

-- CreateIndex
CREATE INDEX "loan_requests_visibility_status_idx" ON "loan_requests"("visibility", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_request_lender_targets_loanRequestId_lenderCompanyId_key" ON "loan_request_lender_targets"("loanRequestId", "lenderCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "loan_quotes_loanRequestId_lenderCompanyId_key" ON "loan_quotes"("loanRequestId", "lenderCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_loanRequestId_key" ON "contracts"("loanRequestId");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "loan_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "borrower_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_matchedLenderCompanyId_fkey" FOREIGN KEY ("matchedLenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_request_lender_targets" ADD CONSTRAINT "loan_request_lender_targets_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "loan_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_request_lender_targets" ADD CONSTRAINT "loan_request_lender_targets_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_request_lender_targets" ADD CONSTRAINT "loan_request_lender_targets_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_quotes" ADD CONSTRAINT "loan_quotes_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "loan_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_quotes" ADD CONSTRAINT "loan_quotes_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_quotes" ADD CONSTRAINT "loan_quotes_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

