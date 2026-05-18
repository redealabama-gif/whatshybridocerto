-- 013_dunning_charge_attempts.sql
-- v9.6.x — Histórico de tentativas de cobrança real dentro do dunning
--
-- A tabela `workspaces` tem dunning_attempts (1/2/3) e last_dunning_at
-- mas só rastreia QUE houve dunning naquele dia. Não diz se a cobrança
-- real (POST /invoices/{id}/pay no Stripe ou getPreapprovalHealth no MP)
-- deu certo, se o cartão foi recusado, se a subscription estava gone, etc.
--
-- Sem esse histórico, operador depende de logs/alertManager pra reconstruir
-- "por que esse workspace foi suspenso?" e dashboard admin não tem dado
-- pra mostrar funil de cobrança (X tentativas → Y declined → Z paid).
--
-- Cada row = uma tentativa real de charge feita pelo processDunning.
-- Linka workspace_id + attempt_number (1/2/3 = estágio do dunning) +
-- resultado completo (status semantizado + raw response truncado).

CREATE TABLE IF NOT EXISTS dunning_charge_attempts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  -- 'stripe' | 'mp' | 'none' (workspace sem método de pagamento)
  provider TEXT NOT NULL,
  -- Stripe subscription_id ou MP preapproval_id (referência externa).
  -- NULL quando provider='none'.
  provider_subscription_id TEXT,
  -- Estágio do dunning (1, 2, 3) — espelha workspaces.dunning_attempts
  -- no momento do disparo. Permite agrupar histórico por ciclo.
  attempt_number INTEGER NOT NULL,
  -- Idade em dias desde past_due_since quando o charge rodou.
  past_due_age_days INTEGER NOT NULL,
  -- Tipo de operação tentada no gateway:
  --   'retry_invoice'  — POST /invoices/{id}/pay (Stripe)
  --   'health_check'   — GET /preapproval/{id} (MP, pq MP não força charge)
  --   'skipped'        — não tentou (sem método/service não configurado)
  charge_method TEXT NOT NULL,
  -- Status semantizado retornado pelo service:
  --   Stripe:  paid|already_paid|declined|gone|invoice_void|no_invoice|error
  --   MP:      authorized|cancelled|paused|finished|not_found|unknown|missing
  --   skipped: no_method
  charge_status TEXT NOT NULL,
  -- Sucesso boolean — true quando charge_status efetivamente regularizou
  -- o workspace (paid|already_paid pro Stripe; authorized pra MP que
  -- não force charge mas confirma assinatura viva).
  ok INTEGER NOT NULL DEFAULT 0,
  -- Mensagem de erro (truncada 500ch) quando falha de API/rede.
  error_message TEXT,
  -- Raw response do gateway (JSON truncado 4KB) — útil pra debug
  -- post-mortem ("por que esse charge falhou?"). Pode ser NULL em
  -- responses gigantes.
  raw_response TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_dunning_charges_workspace_date
  ON dunning_charge_attempts(workspace_id, created_at DESC);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_dunning_charges_status
  ON dunning_charge_attempts(charge_status, created_at DESC);
