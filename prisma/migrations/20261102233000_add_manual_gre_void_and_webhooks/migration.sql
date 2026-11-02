ALTER TABLE "sunat_void_request"
ADD COLUMN "manual_reference" VARCHAR(100),
ADD COLUMN "manual_evidence" JSONB,
ADD COLUMN "manual_confirmed_at" TIMESTAMPTZ(6);

ALTER TABLE "webhook_event"
ADD COLUMN "sunat_void_request_id" UUID;

ALTER TABLE "webhook_event"
ADD CONSTRAINT "webhook_event_sunat_void_request_id_fkey"
FOREIGN KEY ("sunat_void_request_id") REFERENCES "sunat_void_request"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "webhook_event_sunat_void_request_id_created_at_idx"
ON "webhook_event"("sunat_void_request_id", "created_at");
