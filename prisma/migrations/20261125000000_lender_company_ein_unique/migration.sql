-- El EIN vuelve a ser único global, aunque las entidades sean del mismo dueño.
-- Si falla, hay EIN duplicados que corregir a mano antes de reintentar.
DROP INDEX "lender_companies_ein_idx";
CREATE UNIQUE INDEX "lender_companies_ein_key" ON "lender_companies"("ein");
