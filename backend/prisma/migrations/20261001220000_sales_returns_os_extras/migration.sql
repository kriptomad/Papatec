-- Briefing: vendas - endereço de entrega, devolução/troca como documento
ALTER TABLE "sales" ADD COLUMN "delivery_address" JSONB;

-- Documento de devolução/troca de venda
CREATE TABLE "sale_returns" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "sale_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'RETURN',
    "reason" TEXT,
    "notes" TEXT,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sale_returns_code_key" ON "sale_returns"("code");
CREATE INDEX "sale_returns_sale_id_idx" ON "sale_returns"("sale_id");
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sale_return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "sale_item_id" TEXT,
    "part_id" TEXT,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sale_return_items_return_id_idx" ON "sale_return_items"("return_id");
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sale_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Briefing O.S.: observações internas x externas, acessórios, estado,
-- senha do aparelho, quem deixou o equipamento, delivery
ALTER TABLE "service_orders" ADD COLUMN "internal_notes" TEXT;
ALTER TABLE "service_orders" ADD COLUMN "external_notes" TEXT;
ALTER TABLE "service_orders" ADD COLUMN "accessories" TEXT;
ALTER TABLE "service_orders" ADD COLUMN "condition" TEXT;
ALTER TABLE "service_orders" ADD COLUMN "device_password" TEXT;
ALTER TABLE "service_orders" ADD COLUMN "dropped_off_by" TEXT;
ALTER TABLE "service_orders" ADD COLUMN "delivery_type" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "service_orders" ADD COLUMN "delivery_value" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "service_orders" ADD COLUMN "delivery_done" BOOLEAN NOT NULL DEFAULT false;

-- Briefing: código de barra do produto
ALTER TABLE "parts" ADD COLUMN "barcode" TEXT;
CREATE UNIQUE INDEX "parts_barcode_key" ON "parts"("barcode");

-- Briefing: histórico de estoque com valores
ALTER TABLE "stock_movements" ADD COLUMN "unit_value" DOUBLE PRECISION NOT NULL DEFAULT 0;
