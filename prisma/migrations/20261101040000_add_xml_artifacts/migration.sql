CREATE TYPE "ArtifactType" AS ENUM ('XML', 'ZIP', 'CDR', 'PDF');

CREATE TABLE "artifact" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "type" "ArtifactType" NOT NULL,
    "file_name" VARCHAR(180) NOT NULL,
    "object_key" VARCHAR(600) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artifact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "artifact_document_id_type_key"
ON "artifact"("document_id", "type");

CREATE INDEX "artifact_document_id_created_at_idx"
ON "artifact"("document_id", "created_at");

ALTER TABLE "artifact"
ADD CONSTRAINT "artifact_document_id_fkey"
FOREIGN KEY ("document_id") REFERENCES "tax_document"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
