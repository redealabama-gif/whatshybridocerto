-- 024_billing_cycle.sql
-- Compra anual dos planos (2 meses grátis: paga 10, leva 12).
--
-- O ciclo não existia: toda assinatura era mensal e a cota era renovada pelo
-- webhook de cada pagamento. No anual há UM pagamento só, então não há webhook
-- mensal — a cota passa a ser renovada pelo cron diário, uma vez por mês, com
-- invoice_id "anual:<workspace>:<AAAA-MM>" (idempotente por mês).
--
-- A cota continua MENSAL mesmo no anual: quem paga 12 meses não recebe 12x a
-- cota de uma vez. Isso mantém o teto de custo por mês que sustenta a margem.
ALTER TABLE workspaces ADD COLUMN billing_cycle TEXT NOT NULL DEFAULT 'monthly';

-- @SEPARATOR
-- Quando o período anual termina (12 meses após o pagamento). NULL = mensal.
ALTER TABLE workspaces ADD COLUMN annual_period_end DATETIME;
