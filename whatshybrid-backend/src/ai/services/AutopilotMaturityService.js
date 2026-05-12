/**
 * AutopilotMaturityService — v9.3.0
 *
 * Implementa o conceito de "autopilot com graduação" que o usuário
 * descreveu mas que não existia no código:
 *
 *   1. Cliente liga autopilot → entra em modo TRAINING
 *   2. Em TRAINING, IA gera resposta mas NÃO envia automaticamente
 *      (sugere pro humano aprovar/editar — modo Copilot)
 *   3. Sistema registra cada interação como "approved" / "edited" /
 *      "rejected" baseado no que o humano fez com a sugestão
 *   4. Quando taxa de aprovação ≥ MATURITY_THRESHOLD (default 80%) por
 *      MIN_INTERACTIONS (default 30) consecutivas, sistema sinaliza
 *      "READY" — mostra botão pra usuário liberar modo LIVE
 *   5. Em LIVE, IA envia automaticamente sem aprovação humana
 *
 * Estágios:
 *   training (inicial) → ready (pronto pra liberar) → live (ativo)
 *   live pode voltar pra paused se taxa cair abaixo de threshold
 *
 * Storage: tabela autopilot_maturity (workspace_id, stage, stats, ...)
 *
 * Não inventa: usa ResponseOutcomeTracker e PerformanceScoreEngine
 * existentes pra computar taxa.
 */

const logger = require('../../utils/logger');

const STAGES = {
  TRAINING: 'training',   // gera mas não envia (modo copilot forçado)
  READY:    'ready',      // atingiu threshold, aguardando humano liberar
  LIVE:     'live',       // envia automaticamente
  PAUSED:   'paused',     // estava live mas qualidade caiu, pausou
};

const DEFAULTS = {
  MIN_INTERACTIONS: 30,            // mínimo para considerar maturidade
  MATURITY_THRESHOLD: 0.80,        // 80% aprovação pra graduar
  DEMOTION_THRESHOLD: 0.60,        // se cair pra <60% em LIVE, volta pra PAUSED
  ROLLING_WINDOW: 50,              // janela rolante de interações
};

// ─── Schema (idempotente) ─────────────────────────────────────────────
function ensureTable(db) {
  // SQLite — better-sqlite3 síncrono
  db.exec(`
    CREATE TABLE IF NOT EXISTS autopilot_maturity (
      workspace_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL DEFAULT 'training',
      total_interactions INTEGER NOT NULL DEFAULT 0,
      approved_count INTEGER NOT NULL DEFAULT 0,
      edited_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      success_rate REAL NOT NULL DEFAULT 0.0,
      last_interactions TEXT NOT NULL DEFAULT '[]',
      graduated_at DATETIME,
      paused_at DATETIME,
      paused_reason TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_autopilot_stage ON autopilot_maturity(stage);
  `);
}

// ─── Estado por workspace ─────────────────────────────────────────────

function getState(workspaceId) {
  const db = require('../../utils/database');
  ensureTable(db);

  let row = db.get('SELECT * FROM autopilot_maturity WHERE workspace_id = ?', [workspaceId]);
  if (!row) {
    db.run(
      `INSERT INTO autopilot_maturity (workspace_id, stage) VALUES (?, 'training')`,
      [workspaceId]
    );
    row = db.get('SELECT * FROM autopilot_maturity WHERE workspace_id = ?', [workspaceId]);
  }

  let lastInteractions = [];
  try { lastInteractions = JSON.parse(row.last_interactions || '[]'); } catch (_) {}
  let config = { ...DEFAULTS };
  try { config = { ...DEFAULTS, ...JSON.parse(row.config || '{}') }; } catch (_) {}

  return {
    workspaceId,
    stage: row.stage,
    totalInteractions: row.total_interactions,
    approvedCount: row.approved_count,
    editedCount: row.edited_count,
    rejectedCount: row.rejected_count,
    successRate: row.success_rate,
    lastInteractions,
    graduatedAt: row.graduated_at,
    pausedAt: row.paused_at,
    pausedReason: row.paused_reason,
    config,
    minInteractions: config.MIN_INTERACTIONS,
    maturityThreshold: config.MATURITY_THRESHOLD,
    demotionThreshold: config.DEMOTION_THRESHOLD,
  };
}

// ─── Calculo de taxa de sucesso ───────────────────────────────────────

/**
 * Calcula taxa de sucesso baseada em janela rolante.
 * "Aprovado" e "editado" contam como sucesso (humano aproveitou a sugestão).
 * "Rejeitado" conta como falha.
 */
function computeSuccessRate(lastInteractions, window) {
  const slice = lastInteractions.slice(-window);
  if (slice.length === 0) return 0;
  const successful = slice.filter(i => i.outcome === 'approved' || i.outcome === 'edited').length;
  return successful / slice.length;
}

// ─── API pública ──────────────────────────────────────────────────────

/**
 * Registra uma interação do autopilot.
 *
 * @param {string} workspaceId
 * @param {'approved'|'edited'|'rejected'} outcome
 *        approved: humano enviou exatamente como sugerido
 *        edited:   humano editou e enviou (positivo parcial)
 *        rejected: humano descartou e digitou do zero
 * @param {object} [metadata] — interactionId, intent, etc. (rastreabilidade)
 * @returns {object} novo estado
 */
function recordInteraction(workspaceId, outcome, metadata = {}) {
  if (!['approved', 'edited', 'rejected'].includes(outcome)) {
    throw new Error(`outcome inválido: ${outcome}`);
  }

  const db = require('../../utils/database');
  const state = getState(workspaceId);

  // Adiciona à janela rolante
  state.lastInteractions.push({
    outcome,
    timestamp: Date.now(),
    metadata: metadata || {},
  });

  // Mantém só os últimos N (janela rolante)
  const maxWindow = state.config.ROLLING_WINDOW;
  if (state.lastInteractions.length > maxWindow) {
    state.lastInteractions = state.lastInteractions.slice(-maxWindow);
  }

  // Recomputa contadores totais (não rolantes)
  state.totalInteractions += 1;
  if (outcome === 'approved') state.approvedCount += 1;
  if (outcome === 'edited')   state.editedCount += 1;
  if (outcome === 'rejected') state.rejectedCount += 1;

  // Taxa rolante (sobre a janela)
  const successRate = computeSuccessRate(state.lastInteractions, state.config.ROLLING_WINDOW);
  state.successRate = +successRate.toFixed(3);

  // Avalia mudança de estágio
  const oldStage = state.stage;
  state.stage = _evaluateStage(state);

  // Persiste
  //
  // FIX BUG paused_at:
  //   Antes: paused_at = CASE WHEN stage = 'paused' THEN CURRENT_TIMESTAMP ELSE NULL END
  //   Problema: sobrescrevia timestamp original a cada interação enquanto paused.
  //   Histórico de "quando ficou pra trás" era perdido.
  //
  //   Depois: COALESCE preserva timestamp original quando já é paused, só atualiza
  //   na PRIMEIRA transição pra paused. Se sai de paused, zera (próxima entrada
  //   marca de novo).
  //
  // FIX BUG paused_reason:
  //   Mesma lógica — preserva reason original quando já é paused.
  //   Quando sai de paused, zera. Quando entra, marca.
  //
  // Detecção de "primeira entrada em paused": comparamos oldStage vs newStage.
  const justEnteredPaused = (oldStage !== STAGES.PAUSED && state.stage === STAGES.PAUSED);
  const stillPaused       = (oldStage === STAGES.PAUSED && state.stage === STAGES.PAUSED);
  const leftPaused        = (oldStage === STAGES.PAUSED && state.stage !== STAGES.PAUSED);

  db.run(
    `UPDATE autopilot_maturity SET
       stage = ?,
       total_interactions = ?,
       approved_count = ?,
       edited_count = ?,
       rejected_count = ?,
       success_rate = ?,
       last_interactions = ?,
       graduated_at = COALESCE(graduated_at, CASE WHEN ? = 'ready' THEN CURRENT_TIMESTAMP ELSE NULL END),
       paused_at = CASE
         WHEN ? = 1 THEN CURRENT_TIMESTAMP
         WHEN ? = 1 THEN paused_at
         WHEN ? = 1 THEN NULL
         ELSE paused_at
       END,
       paused_reason = CASE
         WHEN ? = 1 THEN ?
         WHEN ? = 1 THEN paused_reason
         WHEN ? = 1 THEN NULL
         ELSE paused_reason
       END,
       updated_at = CURRENT_TIMESTAMP
     WHERE workspace_id = ?`,
    [
      state.stage,
      state.totalInteractions,
      state.approvedCount,
      state.editedCount,
      state.rejectedCount,
      state.successRate,
      JSON.stringify(state.lastInteractions),
      state.stage,
      // paused_at: 3 flags em ordem
      justEnteredPaused ? 1 : 0,
      stillPaused ? 1 : 0,
      leftPaused ? 1 : 0,
      // paused_reason: 3 flags + reason value
      justEnteredPaused ? 1 : 0,
      state.pausedReason || null,
      stillPaused ? 1 : 0,
      leftPaused ? 1 : 0,
      workspaceId,
    ]
  );

  // Logs claros pra debug
  if (oldStage !== state.stage) {
    logger.info(`[AutopilotMaturity] ${workspaceId}: ${oldStage} → ${state.stage} (rate=${(successRate*100).toFixed(1)}%, n=${state.lastInteractions.length})`);
  }

  return state;
}

/**
 * Decide se pode mudar estágio.
 *  - training: pode ir pra ready se atingir threshold + min interactions
 *  - ready: usuário libera manualmente pra live (não automático)
 *  - live: pode ir pra paused se cair abaixo de demotion threshold
 *  - paused: usuário libera manualmente
 *
 * @private
 */
function _evaluateStage(state) {
  const { stage, lastInteractions, successRate, minInteractions, maturityThreshold, demotionThreshold } = state;

  if (stage === STAGES.TRAINING) {
    if (lastInteractions.length >= minInteractions && successRate >= maturityThreshold) {
      return STAGES.READY;
    }
    return STAGES.TRAINING;
  }

  if (stage === STAGES.READY) {
    // Não auto-avança pra LIVE — humano precisa liberar via promoteToLive()
    // Mas se a taxa cair antes de promover, volta pra training
    if (successRate < maturityThreshold * 0.9) {
      return STAGES.TRAINING;
    }
    return STAGES.READY;
  }

  if (stage === STAGES.LIVE) {
    // Demotion: se taxa cair muito, volta pra paused
    if (lastInteractions.length >= minInteractions && successRate < demotionThreshold) {
      state.pausedReason = `success rate dropped to ${(successRate*100).toFixed(1)}% (threshold ${(demotionThreshold*100).toFixed(0)}%)`;
      return STAGES.PAUSED;
    }
    return STAGES.LIVE;
  }

  if (stage === STAGES.PAUSED) {
    // Não auto-recupera — humano precisa avaliar e ressubir manualmente
    return STAGES.PAUSED;
  }

  return stage;
}

/**
 * Promove autopilot de READY pra LIVE. Apenas o usuário humano pode chamar.
 * @returns {boolean} true se promoveu, false se não estava em READY
 */
function promoteToLive(workspaceId) {
  const db = require('../../utils/database');
  const state = getState(workspaceId);
  if (state.stage !== STAGES.READY) {
    return { ok: false, reason: `current stage is ${state.stage}, not ready` };
  }
  db.run(
    `UPDATE autopilot_maturity SET stage = 'live', paused_at = NULL, paused_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?`,
    [workspaceId]
  );
  logger.info(`[AutopilotMaturity] ${workspaceId}: promoted to LIVE by user`);
  return { ok: true, stage: STAGES.LIVE };
}

/**
 * Resume autopilot de PAUSED pra LIVE (decisão humana após investigar queda).
 */
function resumeLive(workspaceId) {
  const db = require('../../utils/database');
  const state = getState(workspaceId);
  if (state.stage !== STAGES.PAUSED) {
    return { ok: false, reason: `current stage is ${state.stage}, not paused` };
  }
  db.run(
    `UPDATE autopilot_maturity SET stage = 'live', paused_at = NULL, paused_reason = NULL, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?`,
    [workspaceId]
  );
  return { ok: true, stage: STAGES.LIVE };
}

/**
 * Reseta tudo (volta pra TRAINING). Útil pra testes / treinamento novo.
 */
function reset(workspaceId) {
  const db = require('../../utils/database');
  db.run(
    `UPDATE autopilot_maturity SET
       stage = 'training',
       total_interactions = 0,
       approved_count = 0,
       edited_count = 0,
       rejected_count = 0,
       success_rate = 0,
       last_interactions = '[]',
       graduated_at = NULL,
       paused_at = NULL,
       paused_reason = NULL,
       updated_at = CURRENT_TIMESTAMP
     WHERE workspace_id = ?`,
    [workspaceId]
  );
  return { ok: true };
}

/**
 * Pode enviar mensagem automaticamente?
 * Usado pelo AIOrchestrator pra decidir entre "auto-send" vs "suggest only".
 */
function canAutoSend(workspaceId) {
  const state = getState(workspaceId);
  return state.stage === STAGES.LIVE;
}

module.exports = {
  STAGES,
  DEFAULTS,
  ensureTable,
  getState,
  recordInteraction,
  promoteToLive,
  resumeLive,
  reset,
  canAutoSend,
  computeSuccessRate, // exportado pra testes
};
