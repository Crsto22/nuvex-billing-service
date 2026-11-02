CREATE TABLE "sunat_void_job" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "void_request_id" UUID NOT NULL,
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
  CONSTRAINT "sunat_void_job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sunat_void_job_void_request_id_fkey"
    FOREIGN KEY ("void_request_id") REFERENCES "sunat_void_request"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "sunat_void_job_void_request_id_key"
ON "sunat_void_job"("void_request_id");

CREATE INDEX "sunat_void_job_status_next_attempt_at_idx"
ON "sunat_void_job"("status", "next_attempt_at");
