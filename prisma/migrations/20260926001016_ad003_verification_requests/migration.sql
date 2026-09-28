-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('LLC', 'CORPORATION', 'LP', 'TRUST', 'INDIVIDUAL', 'OTHER');

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lenderCompanyId" UUID,
    "borrowerProfileId" UUID,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "entityName" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "ein" TEXT NOT NULL,
    "stateOfFormation" VARCHAR(2) NOT NULL,
    "signatoryName" TEXT,
    "signatoryTitle" TEXT,
    "submittedByUserId" UUID NOT NULL,
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_requests_status_createdAt_idx" ON "verification_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "verification_requests_lenderCompanyId_idx" ON "verification_requests"("lenderCompanyId");

-- CreateIndex
CREATE INDEX "verification_requests_borrowerProfileId_idx" ON "verification_requests"("borrowerProfileId");

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "borrower_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
