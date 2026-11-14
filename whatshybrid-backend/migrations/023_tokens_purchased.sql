-- 023_tokens_purchased.sql
-- PLN-01 — o site promete que pacotes avulsos de tokens "não expiram", mas a
-- renovação mensal fazia tokens_total = cota do plano e zerava o uso: a sobra
-- do pacote comprado sumia. Guarda quanto do saldo atual veio de compra
-- (topup) para a renovação manter essa parte. A cota do plano continua sem
-- acumular de um mês para o outro.
ALTER TABLE workspace_credits ADD COLUMN tokens_purchased INTEGER NOT NULL DEFAULT 0;
