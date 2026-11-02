ALTER TABLE "despatch_guide"
  ADD COLUMN "issue_time" VARCHAR(8) NOT NULL DEFAULT '00:00:00',
  ADD COLUMN "sunat_hash" VARCHAR(128);

CREATE TABLE "despatch_guide_artifact" (
  "id" UUID NOT NULL,
  "guide_id" UUID NOT NULL,
  "type" "ArtifactType" NOT NULL,
  "file_name" VARCHAR(180) NOT NULL,
  "object_key" VARCHAR(600) NOT NULL,
  "content_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "despatch_guide_artifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "despatch_guide_artifact_guide_id_type_key"
  ON "despatch_guide_artifact"("guide_id", "type");
CREATE INDEX "despatch_guide_artifact_guide_id_created_at_idx"
  ON "despatch_guide_artifact"("guide_id", "created_at");

ALTER TABLE "despatch_guide_artifact"
  ADD CONSTRAINT "despatch_guide_artifact_guide_id_fkey"
  FOREIGN KEY ("guide_id") REFERENCES "despatch_guide"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
