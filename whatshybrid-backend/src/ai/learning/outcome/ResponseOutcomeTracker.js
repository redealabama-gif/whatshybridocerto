/**
 * 📡 ResponseOutcomeTracker
 * Vórtex Pro v10.2.0 — Auto-Evolutionary AI
 *
 * Registra o que acontece DEPOIS que uma resposta é enviada.
 * Este é o dado mais valioso do sistema: o cliente reagiu ou não?
 *
 * Captura:
 *   - houve reply do cliente? (e em quanto tempo?)
 *   - houve conversão? (intent de compra detectado no reply)
 *   - cliente ficou em silêncio? (ignorou)
 *   - conversa continuou ou parou?
 *
 * Integração:
 *   - Chamado pelo AIOrchestrator após cada resposta enviada
 *   - Escuta mensagens recebidas do cliente para correlacionar
 *   - Alimenta o PerformanceScoreEngine com outcome real
 *
 * @module ai/learning/outcome/ResponseOutcomeTracker
 */

const EventEmitter = require('events');
const logger = require('../../../config/logger');

// Janela de tempo para considerar que um reply é consequência da nossa resposta
const REPLY_WINDOW_MS = 30 * 60 * 1000; // 30 minutos
const CONVERSION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 horas

// Tokens que indicam conversão no reply do cliente
const CONVERSION_TOKENS = [
  /\bquero\s+(comprar|fechar|confirmar|assinar|pagar|contratar)\b/i,
  /\bpode\s+(confirmar|fechar|processar|enviar)\b/i,
  /\bme\s+(manda|passa|envia)\s+(o\s+)?(pix|link|boleto|dados)\b/i,
  /\bvou\s+(levar|pegar|fechar|contratar|comprar)\b/i,
  /\bcombinado\b|\bfechado\b|\bpode\s+ser\b/i,
  /\bagreed?\b|\bdeal\b|\blet.*go\b/i,
];

// Tokens que indicam desinteresse
const DISINTEREST_TOKENS = [
  /\bnão\s+(tenho|quero|preciso|vou|estou)\b/i,
  /\bpor\s+enquanto\s+não\b/i,
  /\bvou\s+pensar\b/i,
  /\bobrigad[ao]\s*[,.]?\s*$/ ,
  /\btá\s+bom\s*[,.]?\s*$/i,
];

class ResponseOutcomeTracker extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      replyWindowMs:      config.replyWindowMs      || REPLY_WINDOW_MS,
      conversionWindowMs: config.conversionWindowMs || CONVERSION_WINDOW_MS,
      maxPendingOutcomes: config.maxPendingOutcomes  || 2000,
      ...config,
    };

    // Tenant pra escopar a persistência dos pending no DB (multi-tenant). Sem
    // tenant (ou 'default'), a persistência fica desligada → só memória.
    this.tenantId = config.tenantId || null;

    // Map de interactionId → pending outcome
    // Fica aqui até o cliente responder ou o timeout expirar
    this.pending = new Map();

    // Outcomes já resolvidos (janela rolante de 7 dias)
    this.resolved = [];

    // Stats acumuladas
    this.stats = {
      total:             0,
      replied:           0,
      converted:         0,
      ignored:           0,
      disinterested:     0,
      avgReplyTimeMs:    null,
      replyRate:         '0%',
      conversionRate:    '0%',
    };

    // Cleanup periódico de pendings expirados
    this._cleanupInterval = setInterval(() => this._expirePending(), 5 * 60 * 1000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();

    // Re-hidrata os pending persistidos no DB (sobrevive a restart / eviction do
    // orquestrador). Best-effort e assíncrono: a fonte quente continua sendo o
    // Map em memória; se o DB estiver fora, segue só em memória (como antes).
    this._hydrateFromDb().catch(() => {});
  }

  // ─────────────────────────────────────────────────────────────────────────
  // API PÚBLICA
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Registra que uma resposta foi enviada.
   * Cria uma entrada pendente que espera o reply do cliente.
   *
   * @param {Object} p
   * @param {string} p.interactionId  – ID retornado pelo AIOrchestrator
   * @param {string} p.chatId
   * @param {string} p.response       – Texto da resposta enviada
   * @param {string} p.responseGoal   – Goal classificado (fechar_venda etc)
   * @param {string} p.clientStage    – Estágio do cliente no momento
   * @param {string} p.intent         – Intent da mensagem original
   * @param {string} p.variant        – A/B variant usada
   * @param {number} p.qualityScore   – Score do QualityChecker
   */
  trackSent({ interactionId, chatId, response, responseGoal, clientStage, intent, variant, qualityScore }) {
    if (!interactionId || !chatId) return;

    this.stats.total++;
    this.pending.set(interactionId, {
      interactionId,
      chatId,
      response,
      responseGoal: responseGoal || 'responder_duvida',
      clientStage:  clientStage  || 'cold',
      intent:       intent       || 'unknown',
      variant:      variant      || 'default',
      qualityScore: qualityScore ?? null,
      sentAt:       Date.now(),
      outcome:      null,   // preenchido quando cliente responder
    });

    // Espelha no DB pra sobreviver a restart (best-effort, não bloqueia).
    this._persistPending(this.pending.get(interactionId));

    // Timeout: se ninguém responder em 30min, marcar como ignored
    setTimeout(() => {
      if (this.pending.has(interactionId)) {
        this._resolveOutcome(interactionId, {
          replied:      false,
          converted:    false,
          disinterested:false,
          replyTimeMs:  null,
          replyText:    null,
          reason:       'timeout',
        });
      }
    }, this.config.replyWindowMs);

    logger.debug(`[OutcomeTracker] Tracking sent: ${interactionId} (chatId=${chatId})`);
  }

  /**
   * Notifica que o cliente enviou uma mensagem.
   * Correlaciona com todos os pendings do mesmo chatId.
   *
   * @param {string} chatId
   * @param {string} messageText – Texto da mensagem do cliente
   */
  onClientMessage(chatId, messageText) {
    if (!chatId || !messageText) return;

    const now = Date.now();

    // Encontrar todos os pendings desse chat dentro da janela
    for (const [interactionId, pending] of this.pending.entries()) {
      if (pending.chatId !== chatId) continue;
      if (now - pending.sentAt > this.config.conversionWindowMs) continue;

      const replyTimeMs = now - pending.sentAt;
      const converted    = CONVERSION_TOKENS.some(p => p.test(messageText));
      const disinterested= DISINTEREST_TOKENS.some(p => p.test(messageText));

      this._resolveOutcome(interactionId, {
        replied:       true,
        converted,
        disinterested,
        replyTimeMs,
        replyText:     messageText.slice(0, 200),
        reason:        'client_replied',
      });

      // Só resolve o MAIS RECENTE para evitar double-count
      break;
    }
  }

  /**
   * Resolve manualmente um outcome (ex: vendedor marca conversão no CRM).
   */
  recordManualConversion(interactionId) {
    if (!this.pending.has(interactionId)) return false;
    this._resolveOutcome(interactionId, {
      replied:       true,
      converted:     true,
      disinterested: false,
      replyTimeMs:   null,
      replyText:     null,
      reason:        'manual_conversion',
    });
    return true;
  }

  /**
   * Retorna outcomes resolvidos para um chatId.
   */
  getOutcomesForChat(chatId, limit = 20) {
    return this.resolved
      .filter(o => o.chatId === chatId)
      .slice(-limit);
  }

  /**
   * Retorna métricas por responseGoal.
   */
  getGoalMetrics() {
    const byGoal = {};
    for (const o of this.resolved) {
      const g = o.responseGoal;
      if (!byGoal[g]) byGoal[g] = { total: 0, replied: 0, converted: 0, replyTimes: [] };
      byGoal[g].total++;
      if (o.outcome.replied)    byGoal[g].replied++;
      if (o.outcome.converted)  byGoal[g].converted++;
      if (o.outcome.replyTimeMs) byGoal[g].replyTimes.push(o.outcome.replyTimeMs);
    }

    const result = {};
    for (const [goal, m] of Object.entries(byGoal)) {
      const avgReply = m.replyTimes.length > 0
        ? Math.round(m.replyTimes.reduce((a, b) => a + b, 0) / m.replyTimes.length / 1000)
        : null;
      result[goal] = {
        total:          m.total,
        replyRate:      m.total > 0 ? ((m.replied    / m.total) * 100).toFixed(1) + '%' : '0%',
        conversionRate: m.total > 0 ? ((m.converted  / m.total) * 100).toFixed(1) + '%' : '0%',
        avgReplyTimeSec: avgReply,
      };
    }
    return result;
  }

  getStats() {
    return { ...this.stats, pendingCount: this.pending.size };
  }

  destroy() {
    clearInterval(this._cleanupInterval);
    this.pending.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVADO
  // ─────────────────────────────────────────────────────────────────────────

  _resolveOutcome(interactionId, outcome) {
    const pending = this.pending.get(interactionId);
    if (!pending) return;

    this.pending.delete(interactionId);
    // Resolvido → tira do espelho persistido (best-effort).
    this._unpersistPending(interactionId);

    const resolved = { ...pending, outcome, resolvedAt: Date.now() };
    this.resolved.push(resolved);

    // Janela rolante: manter apenas últimas 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.resolved = this.resolved.filter(r => r.resolvedAt > cutoff);

    // Atualizar stats
    if (outcome.replied)       this.stats.replied++;
    if (outcome.converted)     this.stats.converted++;
    if (outcome.disinterested) this.stats.disinterested++;
    if (!outcome.replied)      this.stats.ignored++;

    const total = this.stats.total;
    this.stats.replyRate      = total > 0 ? ((this.stats.replied    / total) * 100).toFixed(1) + '%' : '0%';
    this.stats.conversionRate = total > 0 ? ((this.stats.converted  / total) * 100).toFixed(1) + '%' : '0%';

    const replyTimes = this.resolved.filter(r => r.outcome.replyTimeMs).map(r => r.outcome.replyTimeMs);
    this.stats.avgReplyTimeMs = replyTimes.length > 0
      ? Math.round(replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length)
      : null;

    logger.debug(`[OutcomeTracker] Resolved ${interactionId}: replied=${outcome.replied} converted=${outcome.converted} reason=${outcome.reason}`);
    this.emit('outcome', resolved);
  }

  _expirePending() {
    const now = Date.now();
    for (const [id, pending] of this.pending.entries()) {
      if (now - pending.sentAt > this.config.conversionWindowMs) {
        this._resolveOutcome(id, {
          replied: false, converted: false, disinterested: false,
          replyTimeMs: null, replyText: null, reason: 'expired',
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PERSISTÊNCIA (espelho dos pending no DB — sobrevive a restart)
  // Tudo aqui é best-effort e à prova de falha: qualquer erro/DB ausente cai
  // de volta no comportamento só-memória. A persistência só liga com tenant.
  // ─────────────────────────────────────────────────────────────────────────

  _db() {
    if (this._dbRef !== undefined) return this._dbRef;
    try { this._dbRef = require('../../../utils/database'); }
    catch (_) { this._dbRef = null; }
    return this._dbRef;
  }

  _persistEnabled() {
    return !!(this.tenantId && this.tenantId !== 'default' && this._db());
  }

  _persistPending(p) {
    if (!p || !this._persistEnabled()) return;
    try {
      const r = this._db().run(
        `INSERT OR REPLACE INTO response_outcomes_pending
           (interaction_id, workspace_id, chat_id, response, response_goal,
            client_stage, intent, variant, quality_score, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p.interactionId, this.tenantId, p.chatId, p.response ?? null,
         p.responseGoal, p.clientStage, p.intent, p.variant,
         p.qualityScore ?? null, p.sentAt]
      );
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (_) { /* best-effort */ }
  }

  _unpersistPending(interactionId) {
    if (!this._persistEnabled()) return;
    try {
      const r = this._db().run(
        `DELETE FROM response_outcomes_pending WHERE interaction_id = ? AND workspace_id = ?`,
        [interactionId, this.tenantId]
      );
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (_) { /* best-effort */ }
  }

  // Recarrega os pending da tabela pro Map no boot. Funciona com driver sync
  // (sqlite) ou async (postgres) via Promise.resolve. Re-arma o timeout de
  // "ignored" pro tempo restante e descarta o que já passou da janela de 24h.
  async _hydrateFromDb() {
    if (!this._persistEnabled()) return;
    let rows;
    try {
      rows = await Promise.resolve(this._db().all(
        `SELECT interaction_id, chat_id, response, response_goal, client_stage,
                intent, variant, quality_score, sent_at
           FROM response_outcomes_pending WHERE workspace_id = ?`,
        [this.tenantId]
      ));
    } catch (_) { return; }
    if (!Array.isArray(rows) || rows.length === 0) return;

    const now = Date.now();
    let loaded = 0, stale = 0;
    for (const row of rows) {
      const sentAt = Number(row.sent_at) || 0;
      if (now - sentAt > this.config.conversionWindowMs) {
        this._unpersistPending(row.interaction_id); // fora da janela → limpa
        stale++;
        continue;
      }
      if (this.pending.has(row.interaction_id)) continue; // já em memória

      this.pending.set(row.interaction_id, {
        interactionId: row.interaction_id,
        chatId:        row.chat_id,
        response:      row.response,
        responseGoal:  row.response_goal || 'responder_duvida',
        clientStage:   row.client_stage  || 'cold',
        intent:        row.intent        || 'unknown',
        variant:       row.variant       || 'default',
        qualityScore:  row.quality_score ?? null,
        sentAt,
        outcome:       null,
      });
      loaded++;

      // Re-arma o timeout de "ignored" pro tempo restante da replyWindow.
      const remaining = Math.max(0, sentAt + this.config.replyWindowMs - now);
      const id = row.interaction_id;
      const t = setTimeout(() => {
        if (this.pending.has(id)) {
          this._resolveOutcome(id, {
            replied: false, converted: false, disinterested: false,
            replyTimeMs: null, replyText: null, reason: 'timeout',
          });
        }
      }, remaining);
      if (t.unref) t.unref();
    }
    if (loaded || stale) {
      logger.info(`[OutcomeTracker] Hidratado do DB: ${loaded} pendente(s), ${stale} expirado(s) (tenant=${this.tenantId})`);
    }
  }
}

module.exports = ResponseOutcomeTracker;
