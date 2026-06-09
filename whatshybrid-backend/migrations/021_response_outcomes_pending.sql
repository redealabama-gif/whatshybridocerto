-- 021_response_outcomes_pending.sql
-- Onda 3 — Persiste os outcomes PENDENTES do ciclo de auto-aprendizado.
--
-- Antes, o ResponseOutcomeTracker guardava os "pending" (resposta enviada,
-- esperando o cliente reagir) só em MEMÓRIA (Map). Restart do backend ou
-- eviction do orquestrador (30min ocioso) perdia tudo → quando o cliente
-- respondia depois, não havia o que correlacionar e o sinal de aprendizado
-- (replied/converted/ignored) sumia. A IA "fechava o ciclo" mas esquecia no
-- primeiro restart.
--
-- Esta tabela ESPELHA os pending pra sobreviver a restart: trackSent insere,
-- _resolveOutcome remove, e o tracker re-hidrata o Map no boot (re-armando o
-- timeout de "ignored" pro tempo restante). Aditivo e à prova de falha: se o DB
-- estiver fora, o tracker volta a operar só em memória (comportamento atual).

CREATE TABLE IF NOT EXISTS response_outcomes_pending (
  interaction_id TEXT PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  chat_id        TEXT NOT NULL,
  response       TEXT,
  response_goal  TEXT,
  client_stage   TEXT,
  intent         TEXT,
  variant        TEXT,
  quality_score  REAL,
  sent_at        INTEGER NOT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_outcomes_pending_ws_chat ON response_outcomes_pending(workspace_id, chat_id);

-- @SEPARATOR
CREATE INDEX IF NOT EXISTS idx_outcomes_pending_sent ON response_outcomes_pending(sent_at);
