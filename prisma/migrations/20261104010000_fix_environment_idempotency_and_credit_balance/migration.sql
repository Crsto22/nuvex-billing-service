ALTER TABLE "tax_document" ADD COLUMN "amount_due" DECIMAL(18,2);

DROP INDEX IF EXISTS "tax_document_application_id_external_id_key";
CREATE UNIQUE INDEX "tax_document_application_id_environment_external_id_key"
  ON "tax_document"("application_id", "environment", "external_id");
