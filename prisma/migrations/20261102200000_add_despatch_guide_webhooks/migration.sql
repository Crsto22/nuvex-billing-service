ALTER TABLE "webhook_event"
ALTER COLUMN "document_id" DROP NOT NULL,
ADD COLUMN "despatch_guide_id" UUID;

ALTER TABLE "webhook_event"
ADD CONSTRAINT "webhook_event_despatch_guide_id_fkey"
FOREIGN KEY ("despatch_guide_id") REFERENCES "despatch_guide"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "webhook_event"
ADD CONSTRAINT "webhook_event_single_resource_check"
CHECK (("document_id" IS NOT NULL) <> ("despatch_guide_id" IS NOT NULL));

CREATE INDEX "webhook_event_despatch_guide_id_created_at_idx"
ON "webhook_event"("despatch_guide_id", "created_at");
