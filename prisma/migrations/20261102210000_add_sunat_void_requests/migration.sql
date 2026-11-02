CREATE TYPE "SunatVoidProcedure" AS ENUM (
  'VOIDED_DOCUMENTS',
  'DAILY_SUMMARY',
  'GRE_SOL'
);

CREATE TYPE "SunatVoidRequestStatus" AS ENUM (
  'PENDING',
  'MANUAL_ACTION_REQUIRED',
  'SUBMITTED',
  'PROCESSING',
  'ACCEPTED',
  'REJECTED',
  'FAILED'
);

CREATE TABLE "sunat_void_request" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "environment" "Environment" NOT NULL,
  "tax_document_id" UUID,
  "despatch_guide_id" UUID,
  "document_type" "DocumentType" NOT NULL,
  "procedure" "SunatVoidProcedure" NOT NULL,
  "status" "SunatVoidRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reference_date" DATE NOT NULL,
  "series" VARCHAR(4) NOT NULL,
  "number" INTEGER NOT NULL,
  "reason" VARCHAR(100) NOT NULL,
  "request_payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "ticket" VARCHAR(100),
  "sunat_code" VARCHAR(40),
  "sunat_message" VARCHAR(1000),
  "submitted_at" TIMESTAMPTZ(6),
  "responded_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "sunat_void_request_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sunat_void_request_single_target_check"
    CHECK (("tax_document_id" IS NOT NULL) <> ("despatch_guide_id" IS NOT NULL))
);

CREATE UNIQUE INDEX "sunat_void_request_tax_document_id_key"
ON "sunat_void_request"("tax_document_id");

CREATE UNIQUE INDEX "sunat_void_request_despatch_guide_id_key"
ON "sunat_void_request"("despatch_guide_id");

CREATE UNIQUE INDEX "sunat_void_request_tenant_id_environment_document_type_series_number_key"
ON "sunat_void_request"("tenant_id", "environment", "document_type", "series", "number");

CREATE INDEX "sunat_void_request_application_id_environment_status_created_at_idx"
ON "sunat_void_request"("application_id", "environment", "status", "created_at");

CREATE INDEX "sunat_void_request_tenant_id_procedure_status_created_at_idx"
ON "sunat_void_request"("tenant_id", "procedure", "status", "created_at");

ALTER TABLE "sunat_void_request"
ADD CONSTRAINT "sunat_void_request_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sunat_void_request"
ADD CONSTRAINT "sunat_void_request_application_id_fkey"
FOREIGN KEY ("application_id") REFERENCES "application"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sunat_void_request"
ADD CONSTRAINT "sunat_void_request_tax_document_id_fkey"
FOREIGN KEY ("tax_document_id") REFERENCES "tax_document"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sunat_void_request"
ADD CONSTRAINT "sunat_void_request_despatch_guide_id_fkey"
FOREIGN KEY ("despatch_guide_id") REFERENCES "despatch_guide"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
