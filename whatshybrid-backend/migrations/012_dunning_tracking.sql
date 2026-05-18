-- 012_dunning_tracking.sql
-- v9.6.x — Dunning automático para subscriptions past_due
--
-- O ciclo de cobrança falhada precisa de retries escalonados (não cobrar
-- 1× e suspender direto após 7 dias). Padrão SaaS: tentar nos dias 1, 3
-- e 7 com mensagens cada vez mais firmes; suspender só após a última
-- tentativa falhar. Esses campos permitem o billingCron rastrear em qual
-- estágio cada workspace está e quando foi o último alerta enviado, pra
-- não duplicar emails se o cron rodar várias vezes no mesmo dia.

ALTER TABLE workspaces ADD COLUMN dunning_attempts INTEGER DEFAULT 0;

-- @SEPARATOR
ALTER TABLE workspaces ADD COLUMN last_dunning_at DATETIME;

-- @SEPARATOR
-- past_due_since: quando ficou past_due. Antes usávamos updated_at, mas
-- updated_at muda por qualquer write na linha (incluindo o próprio bump
-- de dunning_attempts) → suspendDelinquent acabava nunca disparando.
ALTER TABLE workspaces ADD COLUMN past_due_since DATETIME;

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_workspaces_dunning ON workspaces(subscription_status, past_due_since);
