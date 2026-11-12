-- AlterEnum
ALTER TYPE "ContractOriginationSource" ADD VALUE 'LEGACY_IMPORT';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN "loanStartDate" TIMESTAMP(3);

-- Backfill: los contratos ya activados usan su fecha de activación como inicio.
UPDATE "contracts" SET "loanStartDate" = "activatedAt" WHERE "activatedAt" IS NOT NULL;
