-- ============================================================================
-- Integração com maquininha de cartão
--
-- 1) Status de PAGAMENTO na venda. Antes só existia `payment_method`, que é a
--    FORMA escolhida no cadastro ("Cartão", "PIX", "Dinheiro") e não o estado
--    do pagamento. O código usava `paymentMethod` como se fosse "já pago" e
--    rejeitava com ALREADY_PAID toda venda normal marcada como Cartão.
-- 2) Comprovante da transação na própria venda (NSU, autorização, bandeira).
-- 3) Tabela `card_transactions`: o serviço guardava as transações apenas num
--    Map em memória — reiniciar a API perdia tudo e o callback virava no-op.
-- ============================================================================

ALTER TABLE sales ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE sales ADD COLUMN paid_at TIMESTAMP(3);
ALTER TABLE sales ADD COLUMN card_transaction_id TEXT;
ALTER TABLE sales ADD COLUMN card_authorization_code TEXT;
ALTER TABLE sales ADD COLUMN card_nsu TEXT;
ALTER TABLE sales ADD COLUMN card_brand TEXT;
ALTER TABLE sales ADD COLUMN card_installments INTEGER;

CREATE INDEX sales_payment_status_idx ON sales (payment_status);

CREATE TABLE card_transactions (
  id                  TEXT PRIMARY KEY,
  sale_id             TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  machine_id          TEXT NOT NULL,
  -- CIELO | TEF_IP | SIMULATED (driver que processou)
  gateway             TEXT NOT NULL DEFAULT 'TEF_IP',
  -- PENDING | APPROVED | DECLINED | CANCELLED | ERROR
  status              TEXT NOT NULL DEFAULT 'PENDING',
  -- SEMPRE em centavos (evita ponto flutuante em dinheiro)
  amount              INTEGER NOT NULL,
  -- CREDIT | DEBIT | PIX
  type                TEXT NOT NULL,
  installments        INTEGER NOT NULL DEFAULT 1,
  installments_interest TEXT,
  card_brand          TEXT,
  -- id da transação no gateway (Cielo: MerchantOrderId / Payment.Id)
  external_id         TEXT,
  authorization_code  TEXT,
  nsu                 TEXT,
  qr_code             TEXT,
  payload             JSONB,
  error_message       TEXT,
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX card_transactions_sale_idx    ON card_transactions (sale_id);
CREATE INDEX card_transactions_status_idx ON card_transactions (status);
CREATE INDEX card_transactions_ext_idx    ON card_transactions (external_id);