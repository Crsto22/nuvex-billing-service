ALTER TABLE "despatch_guide"
ADD COLUMN "carrier_delivery_date" DATE,
ALTER COLUMN "arrival_ubigeo" DROP NOT NULL,
ALTER COLUMN "arrival_address" DROP NOT NULL;
