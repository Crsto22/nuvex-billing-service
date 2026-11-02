DROP INDEX "daily_summary_item_document_id_key";

ALTER TABLE "daily_summary_item"
ADD COLUMN "void_request_id" UUID;

CREATE UNIQUE INDEX "daily_summary_item_void_request_id_key"
ON "daily_summary_item"("void_request_id");

CREATE UNIQUE INDEX "daily_summary_item_summary_id_document_id_key"
ON "daily_summary_item"("summary_id", "document_id");

CREATE INDEX "daily_summary_item_document_id_condition_code_created_at_idx"
ON "daily_summary_item"("document_id", "condition_code", "created_at");

ALTER TABLE "daily_summary_item"
ADD CONSTRAINT "daily_summary_item_void_request_id_fkey"
FOREIGN KEY ("void_request_id") REFERENCES "sunat_void_request"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
