CREATE UNIQUE INDEX "emission_job_active_document_operation_key"
ON "emission_job"("document_id", "operation")
WHERE "status" IN ('PENDING', 'PROCESSING');
