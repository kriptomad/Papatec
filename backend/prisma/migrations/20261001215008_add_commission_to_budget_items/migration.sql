-- CreateEnum
CREATE TYPE "CalendarEventType" AS ENUM ('APPOINTMENT', 'HOLIDAY', 'SPECIAL_DATE', 'LUNCH_BREAK', 'BUSINESS_HOURS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "budget_items" ADD COLUMN     "commission_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "commission_type" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "commission_value" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "os_items" ADD COLUMN     "commission_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "commission_type" TEXT NOT NULL DEFAULT 'PERCENT',
ADD COLUMN     "commission_value" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "service_orders" ADD COLUMN     "appointment_status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "scheduled_at" TIMESTAMP(3),
ADD COLUMN     "total_commission" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "service_visits" ADD COLUMN     "appointment_status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "CalendarEventType" NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "recurrence" TEXT,
    "tech_id" TEXT,
    "os_id" TEXT,
    "visit_id" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "client_id" TEXT,
    "user_id" TEXT NOT NULL,
    "sale_type" TEXT NOT NULL DEFAULT 'PRODUCT_ONLY',
    "os_id" TEXT,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount_type" TEXT NOT NULL DEFAULT 'VALUE',
    "payment_method" TEXT,
    "notes" TEXT,
    "total_commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" TEXT NOT NULL,
    "sale_id" TEXT NOT NULL,
    "part_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "commission_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commission_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "commission_type" TEXT NOT NULL DEFAULT 'PERCENT',
    "total" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount_type" TEXT NOT NULL DEFAULT 'VALUE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_events_start_at_end_at_idx" ON "calendar_events"("start_at", "end_at");

-- CreateIndex
CREATE INDEX "calendar_events_tech_id_idx" ON "calendar_events"("tech_id");

-- CreateIndex
CREATE INDEX "calendar_events_type_idx" ON "calendar_events"("type");

-- CreateIndex
CREATE UNIQUE INDEX "sales_code_key" ON "sales"("code");

-- CreateIndex
CREATE INDEX "sales_client_id_idx" ON "sales"("client_id");

-- CreateIndex
CREATE INDEX "sales_user_id_idx" ON "sales"("user_id");

-- CreateIndex
CREATE INDEX "sales_created_at_idx" ON "sales"("created_at");

-- CreateIndex
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");

-- CreateIndex
CREATE INDEX "sale_items_part_id_idx" ON "sale_items"("part_id");

-- CreateIndex
CREATE INDEX "service_orders_appointment_status_idx" ON "service_orders"("appointment_status");

-- CreateIndex
CREATE INDEX "service_visits_appointment_status_idx" ON "service_visits"("appointment_status");

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_tech_id_fkey" FOREIGN KEY ("tech_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
