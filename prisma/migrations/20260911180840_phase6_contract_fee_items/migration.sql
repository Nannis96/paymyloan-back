-- CreateEnum
CREATE TYPE "ContractFeeCategory" AS ENUM ('LENDER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "ContractFeeCode" AS ENUM ('ORIGINATION_POINTS', 'PROCESSING', 'UNDERWRITING', 'DOC_PREP', 'CUSTOM', 'MARKETPLACE_CONNECTION');

-- CreateEnum
CREATE TYPE "FeeAmountType" AS ENUM ('FLAT', 'PERCENTAGE');

-- AlterTable
ALTER TABLE "contract_terms" ADD COLUMN     "prePayPenaltyAmount" DECIMAL(14,2),
ADD COLUMN     "prePayPenaltyType" "LateFeeType";

-- CreateTable
CREATE TABLE "contract_fee_items" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "contractTermsId" UUID NOT NULL,
    "category" "ContractFeeCategory" NOT NULL,
    "code" "ContractFeeCode" NOT NULL,
    "label" TEXT NOT NULL,
    "amountType" "FeeAmountType" NOT NULL,
    "amountValue" DECIMAL(14,2) NOT NULL,
    "computedAmount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_fee_items_contractTermsId_idx" ON "contract_fee_items"("contractTermsId");

-- AddForeignKey
ALTER TABLE "contract_fee_items" ADD CONSTRAINT "contract_fee_items_contractTermsId_fkey" FOREIGN KEY ("contractTermsId") REFERENCES "contract_terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
