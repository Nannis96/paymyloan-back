-- DropForeignKey
ALTER TABLE "lender_profiles" DROP CONSTRAINT "lender_profiles_createdByAdminId_fkey";

-- AlterTable
ALTER TABLE "lender_profiles" ALTER COLUMN "createdByAdminId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "lender_profiles" ADD CONSTRAINT "lender_profiles_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
