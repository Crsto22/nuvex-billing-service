CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD');

CREATE TABLE "webhook_endpoint" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "environment" "Environment" NOT NULL,
  "url" VARCHAR(500) NOT NULL,
  "event_types" TEXT[] NOT NULL,
  "signing_secret_encrypted" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "webhook_endpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_event" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_delivery" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "endpoint_id" UUID NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 10,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(6),
  "locked_by" VARCHAR(100),
  "last_http_status" INTEGER,
  "last_error" VARCHAR(1000),
  "delivered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "webhook_event_document_id_created_at_idx" ON "webhook_event"("document_id", "created_at");
CREATE UNIQUE INDEX "webhook_delivery_event_id_endpoint_id_key" ON "webhook_delivery"("event_id", "endpoint_id");
CREATE INDEX "webhook_endpoint_application_id_environment_active_idx" ON "webhook_endpoint"("application_id", "environment", "active");
CREATE INDEX "webhook_event_application_id_created_at_idx" ON "webhook_event"("application_id", "created_at");
CREATE INDEX "webhook_delivery_status_next_attempt_at_idx" ON "webhook_delivery"("status", "next_attempt_at");
CREATE INDEX "webhook_delivery_endpoint_id_created_at_idx" ON "webhook_delivery"("endpoint_id", "created_at");

ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "tax_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "webhook_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
