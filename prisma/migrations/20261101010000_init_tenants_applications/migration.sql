CREATE TYPE "Environment" AS ENUM ('BETA', 'PRODUCTION');
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "ApplicationStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AuditActorType" AS ENUM ('PLATFORM_ADMIN', 'API_KEY', 'SYSTEM');

CREATE TABLE "tenant" (
  "id" UUID NOT NULL,
  "ruc" VARCHAR(11) NOT NULL,
  "legal_name" VARCHAR(200) NOT NULL,
  "trade_name" VARCHAR(200),
  "address" VARCHAR(255),
  "ubigeo" VARCHAR(6),
  "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "code" VARCHAR(50) NOT NULL,
  "status" "ApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "application_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "api_key" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "environment" "Environment" NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "prefix" VARCHAR(40) NOT NULL,
  "secret_hash" VARCHAR(100) NOT NULL,
  "scopes" TEXT[],
  "last_used_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_event" (
  "id" UUID NOT NULL,
  "tenant_id" UUID,
  "application_id" UUID,
  "actor_type" "AuditActorType" NOT NULL,
  "actor_id" VARCHAR(100) NOT NULL,
  "action" VARCHAR(100) NOT NULL,
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id" VARCHAR(100) NOT NULL,
  "request_id" VARCHAR(100),
  "ip" INET,
  "data" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_ruc_key" ON "tenant"("ruc");
CREATE INDEX "tenant_status_idx" ON "tenant"("status");
CREATE INDEX "tenant_created_at_idx" ON "tenant"("created_at");
CREATE INDEX "application_tenant_id_status_idx" ON "application"("tenant_id", "status");
CREATE UNIQUE INDEX "application_tenant_id_code_key" ON "application"("tenant_id", "code");
CREATE UNIQUE INDEX "api_key_prefix_key" ON "api_key"("prefix");
CREATE INDEX "api_key_application_id_environment_idx" ON "api_key"("application_id", "environment");
CREATE INDEX "api_key_expires_at_idx" ON "api_key"("expires_at");
CREATE INDEX "api_key_revoked_at_idx" ON "api_key"("revoked_at");
CREATE INDEX "audit_event_tenant_id_created_at_idx" ON "audit_event"("tenant_id", "created_at");
CREATE INDEX "audit_event_resource_type_resource_id_idx" ON "audit_event"("resource_type", "resource_id");
CREATE INDEX "audit_event_request_id_idx" ON "audit_event"("request_id");

ALTER TABLE "application"
  ADD CONSTRAINT "application_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "api_key"
  ADD CONSTRAINT "api_key_application_id_fkey"
  FOREIGN KEY ("application_id") REFERENCES "application"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_event"
  ADD CONSTRAINT "audit_event_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
