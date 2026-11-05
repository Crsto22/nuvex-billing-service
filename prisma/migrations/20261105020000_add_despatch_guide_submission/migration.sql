ALTER TYPE "DespatchGuideStatus" ADD VALUE IF NOT EXISTS 'VALIDATED_BETA';

ALTER TABLE "despatch_guide" ADD COLUMN "sunat_ticket" VARCHAR(120);

CREATE TABLE "despatch_guide_related_document" (
    "id" UUID NOT NULL,
    "guide_id" UUID NOT NULL,
    "document_type" VARCHAR(2) NOT NULL,
    "number" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "despatch_guide_related_document_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "despatch_guide_related_document_guide_id_document_type_number_key"
ON "despatch_guide_related_document"("guide_id", "document_type", "number");
CREATE INDEX "despatch_guide_related_document_guide_id_created_at_idx"
ON "despatch_guide_related_document"("guide_id", "created_at");

ALTER TABLE "despatch_guide_related_document"
ADD CONSTRAINT "despatch_guide_related_document_guide_id_fkey"
FOREIGN KEY ("guide_id") REFERENCES "despatch_guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "despatch_guide_related_document" ("id", "guide_id", "document_type", "number")
SELECT gen_random_uuid(), "id", "related_document_type", "related_document_number"
FROM "despatch_guide"
WHERE "related_document_type" IS NOT NULL AND "related_document_number" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE "despatch_guide_emission_job" (
    "id" UUID NOT NULL,
    "guide_id" UUID NOT NULL,
    "status" "EmissionJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 20,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(6),
    "locked_by" VARCHAR(100),
    "last_error_code" VARCHAR(40),
    "last_error_message" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    CONSTRAINT "despatch_guide_emission_job_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "despatch_guide_emission_job_guide_id_key"
ON "despatch_guide_emission_job"("guide_id");
CREATE INDEX "despatch_guide_emission_job_status_next_attempt_at_idx"
ON "despatch_guide_emission_job"("status", "next_attempt_at");

ALTER TABLE "despatch_guide_emission_job"
ADD CONSTRAINT "despatch_guide_emission_job_guide_id_fkey"
FOREIGN KEY ("guide_id") REFERENCES "despatch_guide"("id") ON DELETE CASCADE ON UPDATE CASCADE;
