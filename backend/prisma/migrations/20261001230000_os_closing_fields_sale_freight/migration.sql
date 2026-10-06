-- PDF p.6/7 - processo de fechamento de O.S.:
-- forma de pagamento combinada, contato com cliente (aprovação + desconto)
-- e "resumo p/ cliente" (gerar -> salvar -> imprimir)
ALTER TABLE "service_orders" ADD COLUMN "payment_method" TEXT;
ALTER TABLE "service_orders" ADD COLUMN "client_approved" BOOLEAN;
ALTER TABLE "service_orders" ADD COLUMN "client_contact_notes" TEXT;
ALTER TABLE "service_orders" ADD COLUMN "client_summary" TEXT;

-- PDF p.6 - documento de venda: frete
ALTER TABLE "sales" ADD COLUMN "freight" DOUBLE PRECISION NOT NULL DEFAULT 0;
