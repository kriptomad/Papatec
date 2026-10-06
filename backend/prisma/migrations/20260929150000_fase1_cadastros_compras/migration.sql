-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('PF', 'PJ');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('NEW', 'USED', 'DIGITAL');

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "ie" TEXT,
ADD COLUMN     "im" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "ramal" TEXT,
ADD COLUMN     "responsible_id" TEXT,
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "site" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "type" "PartyType" NOT NULL DEFAULT 'PF',
ADD COLUMN     "zip" TEXT;

-- AlterTable
ALTER TABLE "parts" ADD COLUMN     "commission_percent" DOUBLE PRECISION,
ADD COLUMN     "ncm" TEXT,
ADD COLUMN     "product_type" "ProductType";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "city" TEXT,
ADD COLUMN     "cnpj" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "commission_percent" DOUBLE PRECISION,
ADD COLUMN     "complement" TEXT,
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "district" TEXT,
ADD COLUMN     "ie" TEXT,
ADD COLUMN     "im" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "number" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "ramal" TEXT,
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "site" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "zip" TEXT;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "type" "PartyType" NOT NULL DEFAULT 'PF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "ramal" TEXT,
    "email" TEXT,
    "site" TEXT,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "district" TEXT,
    "zip" TEXT,
    "city" TEXT,
    "state" TEXT,
    "cpf" TEXT,
    "rg" TEXT,
    "cnpj" TEXT,
    "ie" TEXT,
    "im" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "supplier_id" TEXT NOT NULL,
    "purchase_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "items_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount_type" TEXT NOT NULL DEFAULT 'VALUE',
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payment_method" TEXT,
    "nf_number" TEXT,
    "nf_transport" TEXT,
    "notes" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" TEXT NOT NULL,
    "purchase_id" TEXT NOT NULL,
    "part_id" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "qty" INTEGER NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "unit_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_cpf_key" ON "suppliers"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_cnpj_key" ON "suppliers"("cnpj");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_code_key" ON "purchases"("code");

-- CreateIndex
CREATE INDEX "purchases_supplier_id_idx" ON "purchases"("supplier_id");

-- CreateIndex
CREATE INDEX "purchases_purchase_date_idx" ON "purchases"("purchase_date");

-- CreateIndex
CREATE INDEX "purchase_items_purchase_id_idx" ON "purchase_items"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_code_key" ON "clients"("code");

-- CreateIndex
CREATE UNIQUE INDEX "clients_cnpj_key" ON "clients"("cnpj");

-- CreateIndex
CREATE INDEX "clients_name_idx" ON "clients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_code_key" ON "users"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_cpf_key" ON "users"("cpf");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_responsible_id_fkey" FOREIGN KEY ("responsible_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: códigos únicos de exibição para registros já existentes
-- (CLI-0001... para clientes, FUN-0001... para funcionários/parceiros)
-- ---------------------------------------------------------------------------
UPDATE "clients" c
SET "code" = 'CLI-' || lpad(t.rn::text, 4, '0')
FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
  FROM "clients"
) t
WHERE c."id" = t."id" AND c."code" IS NULL;

UPDATE "users" u
SET "code" = 'FUN-' || lpad(t.rn::text, 4, '0')
FROM (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn
  FROM "users"
) t
WHERE u."id" = t."id" AND u."code" IS NULL;

-- Semeia os contadores transacionais a partir do total já backfilled, para que
-- os próximos códigos gerados na criação continuem a sequência sem colisão.
INSERT INTO "sequences" ("key", "value") VALUES ('client', (SELECT COUNT(*) FROM "clients"))
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("sequences"."value", EXCLUDED."value");

INSERT INTO "sequences" ("key", "value") VALUES ('user', (SELECT COUNT(*) FROM "users"))
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("sequences"."value", EXCLUDED."value");

INSERT INTO "sequences" ("key", "value") VALUES ('supplier', (SELECT COUNT(*) FROM "suppliers"))
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("sequences"."value", EXCLUDED."value");

INSERT INTO "sequences" ("key", "value") VALUES ('purchase', (SELECT COUNT(*) FROM "purchases"))
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("sequences"."value", EXCLUDED."value");

