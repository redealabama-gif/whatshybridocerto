/**
 * LearningPipelineSQLiteAdapter
 *
 * CORREÇÃO: Reescrito para usar better-sqlite3 (database.js) em vez de Prisma.
 * O nome "PrismaAdapter" é mantido para não quebrar imports existentes.
 * Funcionalidade idêntica: tenant-scoped, persistente, sem JSON file.
 *
 * Mapeia para a tabela learning_patterns (criada em database.js SCHEMA).
 */

'use strict';

const db = require('../../utils/database');

class LearningPipelinePrismaAdapter {
  /**
   * @param {*} _prisma  — ignorado (compatibilidade com assinatura antiga)
   * @param {string} tenantId
   */
  constructor(_prisma, tenantId) {
    this.tenantId = tenantId || 'default';
  }

  /**
   * Carrega todos os padrões para este tenant, agrupados por status.
   * @returns {{ candidates: Map, graduated: Map, discarded: Set }}
   */
  loadAll() {
    const rows = db.all(
      'SELECT * FROM learning_patterns WHERE workspace_id = ?',
      [this.tenantId]
    );

    const candidates = new Map();
    const graduated  = new Map();
    const discarded  = new Set();

    for (const r of rows) {
      const obj = {
        key:           r.pattern_key,
        intent:        r.intent,
        question:      r.question,
        response:      r.response,
        positiveCount: r.positive_count,
        negativeCount: r.negative_count,
        totalCount:    r.total_count,
        feedbackScore: r.feedback_score,
        status:        r.status,
        graduatedAt:   r.graduated_at ? new Date(r.graduated_at).getTime() : null,
      };
      if (r.status === 'graduated')  graduated.set(r.pattern_key, obj);
      else if (r.status === 'discarded') discarded.add(r.pattern_key);
      else candidates.set(r.pattern_key, obj);
    }
    return { candidates, graduated, discarded };
  }

  /**
   * Persiste ou atualiza um padrão.
   * @param {string} patternKey
   * @param {Object} data
   */
  savePattern(patternKey, data) {
    db.run(
      `INSERT INTO learning_patterns
       (id, workspace_id, pattern_key, intent, question, response, feedback_score,
        positive_count, negative_count, total_count, status, graduated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(workspace_id, pattern_key) DO UPDATE SET
         intent=excluded.intent, question=excluded.question, response=excluded.response,
         feedback_score=excluded.feedback_score, positive_count=excluded.positive_count,
         negative_count=excluded.negative_count, total_count=excluded.total_count,
         status=excluded.status, graduated_at=excluded.graduated_at,
         updated_at=CURRENT_TIMESTAMP`,
      [
        `${this.tenantId}_${patternKey}`,
        this.tenantId,
        patternKey,
        data.intent        || '',
        data.question      || '',
        data.response      || '',
        data.feedbackScore || 0,
        data.positiveCount || 0,
        data.negativeCount || 0,
        data.totalCount    || 0,
        data.status        || 'candidate',
        data.graduatedAt   ? new Date(data.graduatedAt).toISOString() : null,
      ]
    );
  }

  /**
   * Remove um padrão (marcado como discarded).
   * @param {string} patternKey
   */
  discardPattern(patternKey) {
    db.run(
      `UPDATE learning_patterns SET status = 'discarded', updated_at = CURRENT_TIMESTAMP
       WHERE workspace_id = ? AND pattern_key = ?`,
      [this.tenantId, patternKey]
    );
  }

  deletePattern(patternKey) {
    db.run(
      'DELETE FROM learning_patterns WHERE workspace_id = ? AND pattern_key = ?',
      [this.tenantId, patternKey]
    );
  }

  /** Retorna todos os padrões graduados prontos para few-shot injection */
  getGraduated() {
    return db.all(
      `SELECT * FROM learning_patterns
       WHERE workspace_id = ? AND status = 'graduated'
       ORDER BY feedback_score DESC LIMIT 20`,
      [this.tenantId]
    ).map(r => ({
      intent:    r.intent,
      question:  r.question,
      response:  r.response,
      score:     r.feedback_score,
    }));
  }
}

module.exports = LearningPipelinePrismaAdapter;
