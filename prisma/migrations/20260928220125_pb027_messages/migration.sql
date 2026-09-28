-- CreateEnum
CREATE TYPE "MessageSenderRole" AS ENUM ('LENDER', 'BORROWER');

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "lenderCompanyId" UUID NOT NULL,
    "borrowerProfileId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "senderRole" "MessageSenderRole" NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_lenderCompanyId_borrowerProfileId_createdAt_idx" ON "messages"("lenderCompanyId", "borrowerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_borrowerProfileId_readAt_idx" ON "messages"("borrowerProfileId", "readAt");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_lenderCompanyId_fkey" FOREIGN KEY ("lenderCompanyId") REFERENCES "lender_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_borrowerProfileId_fkey" FOREIGN KEY ("borrowerProfileId") REFERENCES "borrower_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
