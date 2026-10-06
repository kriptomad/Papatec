-- AlterTable
ALTER TABLE "parts" ADD COLUMN     "alert_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "characteristics" TEXT,
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "max_discount_percent" DOUBLE PRECISION,
ADD COLUMN     "max_discount_value" DOUBLE PRECISION;

