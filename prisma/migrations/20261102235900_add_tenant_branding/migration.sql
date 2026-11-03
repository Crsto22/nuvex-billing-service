CREATE TABLE "tenant_branding" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source_file_name" VARCHAR(180) NOT NULL,
    "source_mime_type" VARCHAR(50) NOT NULL,
    "source_size_bytes" INTEGER NOT NULL,
    "source_width" INTEGER NOT NULL,
    "source_height" INTEGER NOT NULL,
    "master_object_key" VARCHAR(600) NOT NULL,
    "master_size_bytes" INTEGER NOT NULL,
    "master_sha256" VARCHAR(64) NOT NULL,
    "master_width" INTEGER NOT NULL,
    "master_height" INTEGER NOT NULL,
    "pdf_object_key" VARCHAR(600) NOT NULL,
    "pdf_size_bytes" INTEGER NOT NULL,
    "pdf_sha256" VARCHAR(64) NOT NULL,
    "pdf_width" INTEGER NOT NULL,
    "pdf_height" INTEGER NOT NULL,
    "preview_object_key" VARCHAR(600) NOT NULL,
    "preview_size_bytes" INTEGER NOT NULL,
    "preview_sha256" VARCHAR(64) NOT NULL,
    "preview_width" INTEGER NOT NULL,
    "preview_height" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_branding_tenant_id_key" ON "tenant_branding"("tenant_id");
CREATE INDEX "tenant_branding_updated_at_idx" ON "tenant_branding"("updated_at");

ALTER TABLE "tenant_branding"
ADD CONSTRAINT "tenant_branding_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
