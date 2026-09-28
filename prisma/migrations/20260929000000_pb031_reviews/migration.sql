-- CreateEnum
CREATE TYPE "ReviewDirection" AS ENUM ('LENDER_TO_BORROWER', 'BORROWER_TO_LENDER');

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "contractId" UUID NOT NULL,
    "lenderCompanyId" UUID NOT NULL,
    "borrowerProfileId" UUID NOT NULL,
    "direction" "ReviewDirection" NOT NULL,
    "reviewerUserId" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_lenderCompanyId_direction_idx" ON "reviews"("lenderCompanyId", "direction");

-- CreateIndex
CREATE INDEX "reviews_borrowerProfileId_direction_idx" ON "reviews"("borrowerProfileId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_contractId_borrowerProfileId_direction_key" ON "reviews"("contractId", "borrowerProfileId", "direction");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "borrower_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- rating 1..5 en la BD, no solo en Zod (Fase 18, R-modelo).
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
