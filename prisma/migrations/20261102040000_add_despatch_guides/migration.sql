ALTER TYPE "DocumentType" ADD VALUE 'DESPATCH_GUIDE';

CREATE TYPE "DespatchGuideStatus" AS ENUM (
  'REGISTERED',
  'PROCESSING',
  'ACCEPTED',
  'ACCEPTED_WITH_OBSERVATIONS',
  'REJECTED',
  'FAILED',
  'CANCELLATION_REQUESTED',
  'CANCELLED'
);

CREATE TYPE "DespatchTransportMode" AS ENUM ('PUBLIC', 'PRIVATE');

CREATE TABLE "despatch_guide" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "fiscal_series_id" UUID NOT NULL,
  "external_id" VARCHAR(100) NOT NULL,
  "environment" "Environment" NOT NULL,
  "status" "DespatchGuideStatus" NOT NULL DEFAULT 'REGISTERED',
  "series" VARCHAR(4) NOT NULL,
  "number" INTEGER NOT NULL,
  "issue_date" DATE NOT NULL,
  "transfer_start_date" DATE NOT NULL,
  "transfer_reason_code" VARCHAR(2) NOT NULL,
  "transfer_reason_description" VARCHAR(250),
  "transport_mode" "DespatchTransportMode" NOT NULL,
  "gross_weight" DECIMAL(18,3) NOT NULL,
  "weight_unit" VARCHAR(3) NOT NULL DEFAULT 'KGM',
  "package_count" INTEGER,
  "departure_ubigeo" VARCHAR(6) NOT NULL,
  "departure_address" VARCHAR(255) NOT NULL,
  "arrival_ubigeo" VARCHAR(6) NOT NULL,
  "arrival_address" VARCHAR(255) NOT NULL,
  "related_document_type" VARCHAR(2),
  "related_document_number" VARCHAR(50),
  "issuer_snapshot" JSONB NOT NULL,
  "request_payload" JSONB NOT NULL,
  "metadata" JSONB,
  "sunat_code" VARCHAR(40),
  "sunat_message" VARCHAR(1000),
  "sunat_observations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "cancellation_reason" VARCHAR(250),
  "cancellation_requested_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "submitted_at" TIMESTAMPTZ(6),
  "responded_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "despatch_guide_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "despatch_guide_recipient" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "guide_id" UUID NOT NULL,
  "document_type" VARCHAR(20) NOT NULL,
  "document_number" VARCHAR(20) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "address" VARCHAR(255),
  "ubigeo" VARCHAR(6),
  CONSTRAINT "despatch_guide_recipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "despatch_guide_carrier" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "guide_id" UUID NOT NULL,
  "ruc" VARCHAR(11) NOT NULL,
  "legal_name" VARCHAR(200) NOT NULL,
  "mtc_registration_number" VARCHAR(30),
  CONSTRAINT "despatch_guide_carrier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "despatch_guide_vehicle" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "guide_id" UUID NOT NULL,
  "plate" VARCHAR(10) NOT NULL,
  "brand" VARCHAR(60),
  "authorization_number" VARCHAR(50),
  "primary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "despatch_guide_vehicle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "despatch_guide_driver" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "guide_id" UUID NOT NULL,
  "document_type" VARCHAR(20) NOT NULL,
  "document_number" VARCHAR(20) NOT NULL,
  "first_names" VARCHAR(100) NOT NULL,
  "last_names" VARCHAR(100) NOT NULL,
  "license_number" VARCHAR(30) NOT NULL,
  "primary" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "despatch_guide_driver_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "despatch_guide_item" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "guide_id" UUID NOT NULL,
  "line_number" INTEGER NOT NULL,
  "external_id" VARCHAR(100) NOT NULL,
  "sku" VARCHAR(60),
  "description" VARCHAR(500) NOT NULL,
  "quantity" DECIMAL(18,10) NOT NULL,
  "unit_code" VARCHAR(10) NOT NULL,
  CONSTRAINT "despatch_guide_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "despatch_guide_application_id_external_id_key" ON "despatch_guide"("application_id", "external_id");
CREATE UNIQUE INDEX "despatch_guide_tenant_id_environment_series_number_key" ON "despatch_guide"("tenant_id", "environment", "series", "number");
CREATE INDEX "despatch_guide_application_id_created_at_idx" ON "despatch_guide"("application_id", "created_at");
CREATE INDEX "despatch_guide_tenant_id_environment_status_created_at_idx" ON "despatch_guide"("tenant_id", "environment", "status", "created_at");
CREATE UNIQUE INDEX "despatch_guide_recipient_guide_id_key" ON "despatch_guide_recipient"("guide_id");
CREATE UNIQUE INDEX "despatch_guide_carrier_guide_id_key" ON "despatch_guide_carrier"("guide_id");
CREATE UNIQUE INDEX "despatch_guide_vehicle_guide_id_plate_key" ON "despatch_guide_vehicle"("guide_id", "plate");
CREATE INDEX "despatch_guide_vehicle_guide_id_primary_idx" ON "despatch_guide_vehicle"("guide_id", "primary");
CREATE UNIQUE INDEX "despatch_guide_driver_guide_id_document_type_document_number_key" ON "despatch_guide_driver"("guide_id", "document_type", "document_number");
CREATE INDEX "despatch_guide_driver_guide_id_primary_idx" ON "despatch_guide_driver"("guide_id", "primary");
CREATE UNIQUE INDEX "despatch_guide_item_guide_id_line_number_key" ON "despatch_guide_item"("guide_id", "line_number");
CREATE UNIQUE INDEX "despatch_guide_item_guide_id_external_id_key" ON "despatch_guide_item"("guide_id", "external_id");

ALTER TABLE "despatch_guide" ADD CONSTRAINT "despatch_guide_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "despatch_guide" ADD CONSTRAINT "despatch_guide_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "despatch_guide" ADD CONSTRAINT "despatch_guide_fiscal_series_id_fkey" FOREIGN KEY ("fiscal_series_id") REFERENCES "fiscal_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "despatch_guide_recipient" ADD CONSTRAINT "despatch_guide_recipient_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "despatch_guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "despatch_guide_carrier" ADD CONSTRAINT "despatch_guide_carrier_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "despatch_guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "despatch_guide_vehicle" ADD CONSTRAINT "despatch_guide_vehicle_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "despatch_guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "despatch_guide_driver" ADD CONSTRAINT "despatch_guide_driver_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "despatch_guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "despatch_guide_item" ADD CONSTRAINT "despatch_guide_item_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "despatch_guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
