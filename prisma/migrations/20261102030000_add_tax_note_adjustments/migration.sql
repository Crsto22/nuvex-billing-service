CREATE TABLE "tax_note_adjustment" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "reference_line_number" INTEGER NOT NULL,
    "quantity" DECIMAL(18,10),
    "amount" DECIMAL(18,2) NOT NULL,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_note_adjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tax_note_adjustment_document_id_reference_line_number_key"
ON "tax_note_adjustment"("document_id", "reference_line_number");

CREATE INDEX "tax_note_adjustment_reference_line_number_idx"
ON "tax_note_adjustment"("reference_line_number");

ALTER TABLE "tax_note_adjustment"
ADD CONSTRAINT "tax_note_adjustment_document_id_fkey"
FOREIGN KEY ("document_id") REFERENCES "tax_document"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
