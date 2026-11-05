-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "contractId" UUID,
    "loanRequestId" UUID,
    "originalFileName" VARCHAR(255) NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "wrappedKey" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "uploadedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_s3Key_key" ON "documents"("s3Key");

-- CreateIndex
CREATE INDEX "documents_contractId_createdAt_idx" ON "documents"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "documents_loanRequestId_createdAt_idx" ON "documents"("loanRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_loanRequestId_fkey" FOREIGN KEY ("loanRequestId") REFERENCES "loan_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Exactamente uno de contractId/loanRequestId (D-S2-8). Prisma no expresa CHECK.
ALTER TABLE "documents" ADD CONSTRAINT "documents_exactly_one_parent" CHECK (num_nonnulls("contractId", "loanRequestId") = 1);
