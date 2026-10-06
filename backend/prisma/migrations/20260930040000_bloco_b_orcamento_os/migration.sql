-- AlterTable
ALTER TABLE "budget_items" ADD COLUMN     "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "discount_type" TEXT NOT NULL DEFAULT 'VALUE';

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "service_address" JSONB,
ADD COLUMN     "service_type" TEXT NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "os_items" ADD COLUMN     "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "discount_type" TEXT NOT NULL DEFAULT 'VALUE';

-- AlterTable
ALTER TABLE "service_orders" ADD COLUMN     "checklist" JSONB,
ADD COLUMN     "labor_source" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "service_address" JSONB,
ADD COLUMN     "service_type" TEXT NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "checklist" JSONB;

-- CreateTable
CREATE TABLE "service_visits" (
    "id" TEXT NOT NULL,
    "os_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "address" JSONB,
    "arrival" TIMESTAMP(3),
    "departure" TIMESTAMP(3),
    "needs_second_visit" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "tech_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_visits_os_id_idx" ON "service_visits"("os_id");

-- CreateIndex
CREATE INDEX "service_visits_date_idx" ON "service_visits"("date");

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_os_id_fkey" FOREIGN KEY ("os_id") REFERENCES "service_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_visits" ADD CONSTRAINT "service_visits_tech_id_fkey" FOREIGN KEY ("tech_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

