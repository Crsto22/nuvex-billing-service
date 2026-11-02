CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'RECEIPT');
CREATE TYPE "DocumentStatus" AS ENUM ('RECEIVED', 'VALIDATING', 'QUEUED', 'PROCESSING', 'ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS', 'REJECTED', 'RETRY_SCHEDULED', 'FAILED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CREDIT');
CREATE TYPE "EmissionJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'DEAD');
CREATE TYPE "EmissionOperation" AS ENUM ('ISSUE');

CREATE TABLE "establishment" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "code" VARCHAR(10) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "address" VARCHAR(255) NOT NULL,
  "ubigeo" VARCHAR(6) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "establishment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fiscal_series" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "establishment_id" UUID NOT NULL,
  "environment" "Environment" NOT NULL,
  "document_type" "DocumentType" NOT NULL,
  "series" VARCHAR(4) NOT NULL,
  "current_number" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "fiscal_series_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_document" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "fiscal_series_id" UUID NOT NULL,
  "external_id" VARCHAR(100) NOT NULL,
  "environment" "Environment" NOT NULL,
  "document_type" "DocumentType" NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'QUEUED',
  "series" VARCHAR(4) NOT NULL,
  "number" INTEGER NOT NULL,
  "issue_date" DATE NOT NULL,
  "issue_time" VARCHAR(8),
  "currency" CHAR(3) NOT NULL,
  "payment_method" "PaymentMethod" NOT NULL,
  "calculation_version" VARCHAR(40) NOT NULL,
  "issuer_snapshot" JSONB NOT NULL,
  "customer_snapshot" JSONB NOT NULL,
  "request_payload" JSONB NOT NULL,
  "normalized_payload" JSONB NOT NULL,
  "metadata" JSONB,
  "taxable_amount" DECIMAL(18,2) NOT NULL,
  "exempt_amount" DECIMAL(18,2) NOT NULL,
  "unaffected_amount" DECIMAL(18,2) NOT NULL,
  "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(18,2) NOT NULL,
  "total_amount" DECIMAL(18,2) NOT NULL,
  "sunat_code" VARCHAR(40),
  "sunat_message" VARCHAR(1000),
  "sunat_hash" VARCHAR(128),
  "submitted_at" TIMESTAMPTZ(6),
  "responded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tax_document_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_document_line" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "line_number" INTEGER NOT NULL,
  "external_id" VARCHAR(100) NOT NULL,
  "sku" VARCHAR(60),
  "description" VARCHAR(500) NOT NULL,
  "unit_code" VARCHAR(10) NOT NULL,
  "quantity" DECIMAL(18,10) NOT NULL,
  "unit_price" DECIMAL(18,10) NOT NULL,
  "unit_price_includes_tax" BOOLEAN NOT NULL,
  "tax_affectation_code" VARCHAR(4) NOT NULL,
  "unit_value" DECIMAL(18,10) NOT NULL,
  "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "line_value" DECIMAL(18,2) NOT NULL,
  "tax_amount" DECIMAL(18,2) NOT NULL,
  "total_amount" DECIMAL(18,2) NOT NULL,
  CONSTRAINT "tax_document_line_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payment_installment" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "number" INTEGER NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "due_date" DATE NOT NULL,
  CONSTRAINT "payment_installment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_record" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "resource_type" VARCHAR(50) NOT NULL,
  "resource_id" VARCHAR(100) NOT NULL,
  "response_status" INTEGER NOT NULL,
  "response_body" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "emission_job" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "operation" "EmissionOperation" NOT NULL DEFAULT 'ISSUE',
  "status" "EmissionJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 10,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" VARCHAR(100),
  "last_error_code" VARCHAR(40),
  "last_error_message" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(6),
  CONSTRAINT "emission_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "establishment_tenant_id_code_key" ON "establishment"("tenant_id", "code");
CREATE INDEX "establishment_tenant_id_active_idx" ON "establishment"("tenant_id", "active");
CREATE UNIQUE INDEX "fiscal_series_tenant_id_environment_document_type_series_key" ON "fiscal_series"("tenant_id", "environment", "document_type", "series");
CREATE INDEX "fiscal_series_application_id_environment_active_idx" ON "fiscal_series"("application_id", "environment", "active");
CREATE UNIQUE INDEX "tax_document_application_id_external_id_key" ON "tax_document"("application_id", "external_id");
CREATE UNIQUE INDEX "tax_document_tenant_id_environment_document_type_series_number_key" ON "tax_document"("tenant_id", "environment", "document_type", "series", "number");
CREATE INDEX "tax_document_application_id_created_at_idx" ON "tax_document"("application_id", "created_at");
CREATE INDEX "tax_document_tenant_id_status_created_at_idx" ON "tax_document"("tenant_id", "status", "created_at");
CREATE UNIQUE INDEX "tax_document_line_document_id_line_number_key" ON "tax_document_line"("document_id", "line_number");
CREATE UNIQUE INDEX "payment_installment_document_id_number_key" ON "payment_installment"("document_id", "number");
CREATE UNIQUE INDEX "idempotency_record_application_id_key_key" ON "idempotency_record"("application_id", "key");
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record"("expires_at");
CREATE INDEX "emission_job_status_next_attempt_at_idx" ON "emission_job"("status", "next_attempt_at");
CREATE INDEX "emission_job_document_id_created_at_idx" ON "emission_job"("document_id", "created_at");

ALTER TABLE "establishment" ADD CONSTRAINT "establishment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiscal_series" ADD CONSTRAINT "fiscal_series_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiscal_series" ADD CONSTRAINT "fiscal_series_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fiscal_series" ADD CONSTRAINT "fiscal_series_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_document" ADD CONSTRAINT "tax_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_document" ADD CONSTRAINT "tax_document_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_document" ADD CONSTRAINT "tax_document_fiscal_series_id_fkey" FOREIGN KEY ("fiscal_series_id") REFERENCES "fiscal_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_document_line" ADD CONSTRAINT "tax_document_line_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "tax_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_installment" ADD CONSTRAINT "payment_installment_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "tax_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emission_job" ADD CONSTRAINT "emission_job_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "tax_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
