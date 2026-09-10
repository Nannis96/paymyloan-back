-- D-P4-8: LenderProfile.contactPhone quedó duplicado con User.phone
-- (agregado después, en D-P2-4, como teléfono de cuenta genérico para todos
-- los roles) — era el único campo editable de LenderProfile. Se elimina.
ALTER TABLE "lender_profiles" DROP COLUMN "contactPhone";
