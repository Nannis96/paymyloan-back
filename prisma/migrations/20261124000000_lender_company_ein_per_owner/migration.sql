-- El EIN deja de ser único global: se valida en la app (único entre usuarios, repetible por el mismo lender).
DROP INDEX "lender_companies_ein_key";
CREATE INDEX "lender_companies_ein_idx" ON "lender_companies"("ein");
