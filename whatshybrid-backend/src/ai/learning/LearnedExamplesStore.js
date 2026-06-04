'use strict';

/**
 * LearnedExamplesStore — captura a CORREÇÃO do operador como exemplo de treino
 * durável e recuperável (FASE 3c). Fecha o loop de aprendizado.
 *
 * O GAP (descoberto lendo o código de ponta a ponta)
 * --------------------------------------------------
 * Quando o operador edita uma sugestão antes de enviar, o cliente JÁ manda o
 * texto corrigido pro backend (POST /ai/learn/feedback, feedbackType=correction,
 * correctedResponse). Hoje isso vira: (a) uma linha em `ai_feedback`, e (b) um
 * VOTO num pattern do ValidatedLearningPipeline — que só "gradua" (passa a ser
 * servido) depois de ≥5 amostras a ≥80% positivo. Ou seja: uma correção humana
 * isolada — o sinal de qualidade MAIS FORTE que existe, uma pessoa escreveu a
 * resposta certa — NÃO é servida de volta até a MESMA pergunta repetir 5×. Numa
 * pergunta de cauda longa (perguntada e corrigida uma vez), a correção se perde.
 *
 * A SOLUÇÃO
 * ---------
 * Tratar a correção como verdade-fundamental: persistir num lugar DURÁVEL (tabela
 * própria, que o /training/sync NUNCA apaga — ao contrário de `training_examples`,
 * que ele faz DELETE+INSERT a cada sync) e fazer o _loadTrainedKnowledge servi-la
 * IMEDIATAMENTE no próximo processMessage da mesma pergunta. A graduação
 * estatística do pipeline continua existindo pra escolher entre variantes ao
 * longo do tempo; isto é ORTOGONAL e complementar.
 *
 * Dedup por (workspace, pergunta normalizada): a correção mais recente do humano
 * para uma pergunta substitui a anterior — a store sempre reflete a última
 * preferência e não incha. Reusa o `normalize` do LocalKnowledgeRanker (Fase 1)
 * pra a chave de dedup ser acento/caixa-insensível.
 *
 * Reversível por env: WHL_LEARN_FROM_EDITS=0 → captura desligada (a leitura é
 * inócua quando a tabela está vazia → comportamento pré-3c).
 */

const logger = require('../../utils/logger');
const { normalize } = require('../search/LocalKnowledgeRanker');
const { v4: uuid } = require('../../utils/uuid-wrapper');

const MAX_INPUT = 2000;
const MAX_OUTPUT = 5000;

/** Cria a tabela + índices (idempotente). */
function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learned_examples (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      input_norm TEXT NOT NULL,
      input TEXT NOT NULL,
      output TEXT NOT NULL,
      original TEXT,
      intent TEXT,
      source TEXT NOT NULL DEFAULT 'operator_edit',
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_learned_examples_ws ON learned_examples(workspace_id);');
  // UNIQUE habilita o upsert ON CONFLICT (dedup por pergunta normalizada).
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_examples_ws_input ON learned_examples(workspace_id, input_norm);'
  );
}

/**
 * Captura uma correção do operador como exemplo durável.
 *
 * Resolve a pergunta/intent: prefere os campos explícitos; quando faltam e há
 * interactionId, reconstrói de `interaction_metadata` (gravado pelo orquestrador).
 * Valida que é uma MUDANÇA real (correção idêntica ao original = aprovação, não
 * aprendizado). Dedup por pergunta normalizada (upsert).
 *
 * @param {object} signals
 * @param {string}  signals.workspaceId       (obrigatório)
 * @param {string}  [signals.question]        a pergunta do cliente
 * @param {string}  signals.correctedResponse o texto que o humano corrigiu (obrigatório)
 * @param {string}  [signals.originalResponse] a sugestão original da IA
 * @param {string}  [signals.intent]
 * @param {string}  [signals.interactionId]   pra reconstruir pergunta/intent se faltarem
 * @param {object}  [db] injeção do driver de DB (default: util compartilhado) — testável
 * @returns {{ ok: boolean, reason?: string }}
 */
function captureFromEdit(signals = {}, db = require('../../utils/database')) {
  if (process.env.WHL_LEARN_FROM_EDITS === '0') return { ok: false, reason: 'disabled' };

  const workspaceId = signals.workspaceId;
  if (!workspaceId) return { ok: false, reason: 'missing_workspace' };

  let input = (signals.question || '').toString().trim();
  let resolvedIntent = (signals.intent || '').toString().trim() || null;
  let original = (signals.originalResponse || '').toString();
  const output = (signals.correctedResponse || '').toString().trim();

  // Reconstrução via interaction_metadata quando a pergunta/intent não vieram.
  if ((!input || !resolvedIntent || !original) && signals.interactionId) {
    try {
      const row = db.get(
        'SELECT question, intent, response FROM interaction_metadata WHERE interaction_id = ? AND workspace_id = ?',
        [signals.interactionId, workspaceId]
      );
      if (row) {
        if (!input) input = (row.question || '').toString().trim();
        if (!resolvedIntent) resolvedIntent = row.intent || null;
        if (!original) original = (row.response || '').toString();
      }
    } catch (e) {
      logger.debug?.(`[LearnedExamples] interaction_metadata lookup falhou: ${e.message}`);
    }
  }

  // Precisa de pergunta + correção, e a correção tem que ser uma mudança real.
  if (!input || !output) return { ok: false, reason: 'missing_input_or_output' };
  if (original && output === original.trim()) return { ok: false, reason: 'not_an_edit' };

  const inputNorm = normalize(input).trim();
  if (!inputNorm) return { ok: false, reason: 'empty_normalized_input' };

  try {
    ensureTable(db);
    db.run(
      `INSERT INTO learned_examples
         (id, workspace_id, input_norm, input, output, original, intent, source, usage_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'operator_edit', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(workspace_id, input_norm) DO UPDATE SET
         output = excluded.output,
         original = excluded.original,
         intent = COALESCE(excluded.intent, learned_examples.intent),
         updated_at = CURRENT_TIMESTAMP`,
      [
        uuid(),
        workspaceId,
        inputNorm,
        input.slice(0, MAX_INPUT),
        output.slice(0, MAX_OUTPUT),
        original ? original.slice(0, MAX_OUTPUT) : null,
        resolvedIntent,
      ]
    );
    logger.info(
      `[LearnedExamples] correção capturada ws=${workspaceId} intent=${resolvedIntent || '-'} q="${input.slice(0, 60)}"`
    );
    return { ok: true };
  } catch (e) {
    logger.warn(`[LearnedExamples] capture falhou: ${e.message}`);
    return { ok: false, reason: e.message };
  }
}

/**
 * Carrega exemplos aprendidos pro ranqueamento do _loadTrainedKnowledge.
 * Tolerante a falha (tabela inexistente → []), pra nunca quebrar a resposta.
 *
 * @param {object} db driver de DB
 * @param {string} workspaceId
 * @param {number} [limit=200]
 * @returns {Array<{ input, output, intent }>}
 */
function loadForRanking(db, workspaceId, limit = 200) {
  if (!db || !workspaceId) return [];
  try {
    ensureTable(db);
    return (
      db.all(
        `SELECT input, output, intent FROM learned_examples
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
        LIMIT ?`,
        [workspaceId, limit]
      ) || []
    );
  } catch (e) {
    logger.debug?.(`[LearnedExamples] loadForRanking falhou: ${e.message}`);
    return [];
  }
}

module.exports = {
  ensureTable,
  captureFromEdit,
  loadForRanking,
  MAX_INPUT,
  MAX_OUTPUT,
};
