/**
 * 📡 ResponseOutcomeTracker
 * WhatsHybrid Pro v10.2.0 — Auto-Evolutionary AI
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
}

module.exports = ResponseOutcomeTracker;
