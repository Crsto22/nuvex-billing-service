ALTER TABLE "tax_document"
ADD COLUMN "sunat_observations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
