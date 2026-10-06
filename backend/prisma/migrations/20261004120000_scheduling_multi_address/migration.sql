-- Agendamento de visitas + múltiplos endereços de serviço externo.
--
-- 1) service_orders.service_addresses: lista de endereços quando o cliente pede
--    mais de um (residência + escritório...). O primeiro da lista continua
--    sendo espelhado em `service_address`, então impressão, visitas e
--    relatórios antigos seguem funcionando sem alteração.
--
-- 2) service_visits.duration_minutes: "Tempo Serviço" informado no agendamento.
--    Define o fim do slot no calendário central (antes era +1h fixo) e alimenta
--    a detecção de conflito do MESMO técnico.

-- AlterTable
ALTER TABLE "service_orders" ADD COLUMN "service_addresses" JSONB;

-- AlterTable
ALTER TABLE "service_visits" ADD COLUMN "duration_minutes" INTEGER;
