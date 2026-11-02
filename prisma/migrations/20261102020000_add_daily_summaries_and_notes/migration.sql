ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE';

CREATE TYPE "DailySummaryStatus" AS ENUM (
  'BUILDING',
  'SUBMITTED',
  'PROCESSING',
  'ACCEPTED',
  'REJECTED',
  'FAILED'
);

CREATE TYPE "DailySummaryItemStatus" AS ENUM (
  'PENDING',
  'ACCEPTED',
  'REJECTED'
);

ALTER TABLE "tax_document"
  ADD COLUMN "reason_code" VARCHAR(2),
  ADD COLUMN "reason_description" VARCHAR(500);

CREATE TABLE "tax_document_reference" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "referenced_document_id" UUID NOT NULL,
  "referenced_type" "DocumentType" NOT NULL,
  "referenced_series" VARCHAR(4) NOT NULL,
  "referenced_number" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_document_reference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_document_reference_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "tax_document"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tax_document_reference_referenced_document_id_fkey"
    FOREIGN KEY ("referenced_document_id") REFERENCES "tax_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tax_document_reference_document_id_referenced_document_id_key"
  ON "tax_document_reference"("document_id", "referenced_document_id");
CREATE INDEX "tax_document_reference_referenced_document_id_created_at_idx"
  ON "tax_document_reference"("referenced_document_id", "created_at");

CREATE TABLE "daily_summary" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "environment" "Environment" NOT NULL,
  "reference_date" DATE NOT NULL,
  "generation_date" DATE NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "DailySummaryStatus" NOT NULL DEFAULT 'BUILDING',
  "file_name" VARCHAR(180),
  "xml_object_key" VARCHAR(600),
  "zip_object_key" VARCHAR(600),
  "cdr_object_key" VARCHAR(600),
  "ticket" VARCHAR(100),
  "sunat_code" VARCHAR(40),
  "sunat_message" VARCHAR(1000),
  "submitted_at" TIMESTAMPTZ(6),
  "responded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "daily_summary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_summary_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "daily_summary_tenant_id_environment_generation_date_sequence_key"
  ON "daily_summary"("tenant_id", "environment", "generation_date", "sequence");
CREATE INDEX "daily_summary_status_created_at_idx" ON "daily_summary"("status", "created_at");
CREATE INDEX "daily_summary_tenant_id_environment_reference_date_idx"
  ON "daily_summary"("tenant_id", "environment", "reference_date");

CREATE TABLE "daily_summary_item" (
  "id" UUID NOT NULL,
  "summary_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "line_id" INTEGER NOT NULL,
  "condition_code" VARCHAR(1) NOT NULL DEFAULT '1',
  "status" "DailySummaryItemStatus" NOT NULL DEFAULT 'PENDING',
  "sunat_code" VARCHAR(40),
  "sunat_message" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "daily_summary_item_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_summary_item_summary_id_fkey"
    FOREIGN KEY ("summary_id") REFERENCES "daily_summary"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_summary_item_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "tax_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "daily_summary_item_document_id_key" ON "daily_summary_item"("document_id");
CREATE UNIQUE INDEX "daily_summary_item_summary_id_line_id_key" ON "daily_summary_item"("summary_id", "line_id");
CREATE INDEX "daily_summary_item_summary_id_status_idx" ON "daily_summary_item"("summary_id", "status");
