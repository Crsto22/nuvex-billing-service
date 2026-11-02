CREATE TABLE "tax_credential" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "environment" "Environment" NOT NULL,
    "sol_username_encrypted" TEXT,
    "sol_password_encrypted" TEXT,
    "client_id_encrypted" TEXT,
    "client_secret_encrypted" TEXT,
    "certificate_object_key" VARCHAR(600),
    "certificate_password_encrypted" TEXT,
    "certificate_file_name" VARCHAR(180),
    "certificate_mime_type" VARCHAR(100),
    "certificate_size_bytes" INTEGER,
    "certificate_fingerprint" VARCHAR(64),
    "certificate_serial_number" VARCHAR(128),
    "certificate_subject" TEXT,
    "certificate_issuer" TEXT,
    "certificate_valid_from" TIMESTAMPTZ(6),
    "certificate_expires_at" TIMESTAMPTZ(6),
    "certificate_uploaded_at" TIMESTAMPTZ(6),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "tax_credential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tax_credential_tenant_id_environment_key"
ON "tax_credential"("tenant_id", "environment");

CREATE INDEX "tax_credential_tenant_id_active_idx"
ON "tax_credential"("tenant_id", "active");

CREATE INDEX "tax_credential_certificate_expires_at_idx"
ON "tax_credential"("certificate_expires_at");

ALTER TABLE "tax_credential"
ADD CONSTRAINT "tax_credential_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
