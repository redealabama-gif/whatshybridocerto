/**
 * 🔄 AutoLearningLoop
 * WhatsHybrid Pro v10.2.0 — Auto-Evolutionary AI
 *
 * Fecha o CICLO COMPLETO de aprendizado autônomo:
 *
 *   1. IA gera resposta (AIOrchestrator)
 *   2. Resposta é enviada (autopilot ou manual)
 *   3. OutcomeTracker detecta se cliente respondeu/converteu (REAL)
 *   4. PerformanceScoreEngine calcula score (0→1)
 *   5. AutoLearningLoop:
 *      a. Alimenta ValidatedLearningPipeline com feedback real
 *      b. Alimenta ResponseABTester com resultado real do variant
 *      c. Alimenta StrategySelector com outcome para calibrar futuras estratégias
 *      d. Atualiza ConversationMemory com score e conversão
 *   6. Próxima resposta para este cliente usa estratégia melhorada ← AUTOMÁTICO
 *
 * @module ai/learning/outcome/AutoLearningLoop
 */

const EventEmitter = require('events');
const logger = require('../../../config/logger');

class AutoLearningLoop extends EventEmitter {
  /**
   * @param {Object} deps – Dependências injetadas pelo AIOrchestrator
   * @param {import('./ResponseOutcomeTracker')}      deps.outcomeTracker
   * @param {import('./PerformanceScoreEngine')}      deps.scoreEngine
   * @param {import('./StrategySelector')}            deps.strategySelector
   * @param {import('../ValidatedLearningPipeline')}  deps.learningPipeline
   * @param {import('../../learning/ResponseABTester')} deps.abTester
   * @param {import('../../memory/ConversationMemory')} deps.conversationMemory
   */
  constructor(deps = {}) {
    super();
    this.outcomeTracker    = deps.outcomeTracker;
    this.scoreEngine       = deps.scoreEngine;
    this.strategySelector  = deps.strategySelector;
    this.learningPipeline  = deps.learningPipeline;
    this.abTester          = deps.abTester;
    this.conversationMemory= deps.conversationMemory;

    this.stats = {
      cyclesCompleted: 0,
      patternsLearned: 0,
      abResultsRecorded: 0,
      strategyUpdates: 0,
      avgScore: null,
      scoreHistory: [],   // últimos 100 scores
    };

    // Escuta outcomes resolvidos pelo tracker
    if (this.outcomeTracker) {
      this.outcomeTracker.on('outcome', (resolved) => this._onOutcome(resolved));
    }
  }

  /**
   * Registra que uma resposta foi enviada.
   * Deve ser chamado pelo AIOrchestrator imediatamente após enviar.
   *
   * @param {Object} interactionMeta – metadata retornado por processMessage()
   * @param {Object} strategy        – estratégia usada (do StrategySelector)
   */
  trackSent(interactionMeta, strategy = null) {
    if (!this.outcomeTracker) return;
    if (!interactionMeta?.interactionId) return;

    this.outcomeTracker.trackSent({
      interactionId: interactionMeta.interactionId,
      chatId:        interactionMeta.chatId || interactionMeta.metadata?.chatId,
      response:      interactionMeta.response,
      responseGoal:  interactionMeta.metadata?.responseGoal,
      clientStage:   interactionMeta.metadata?.clientStage,
      intent:        interactionMeta.metadata?.intent,
      variant:       interactionMeta.metadata?.variant,
      qualityScore:  interactionMeta.metadata?.qualityScore,
    });

    // Guardar estratégia usada para poder correlacionar com outcome
    if (strategy) {
      this._pendingStrategies = this._pendingStrategies || new Map();
      this._pendingStrategies.set(interactionMeta.interactionId, {
        strategy,
        message:   interactionMeta.message,
        response:  interactionMeta.response,
        intent:    interactionMeta.metadata?.intent,
        chatId:    interactionMeta.chatId || interactionMeta.metadata?.chatId,
        responseGoal: interactionMeta.metadata?.responseGoal,
        clientStage:  interactionMeta.metadata?.clientStage,
      });
    }
  }

  /**
   * Notifica que o cliente enviou uma mensagem.
   * Deve ser chamado pelo message-capture ou autopilot ao receber mensagem.
   *
   * @param {string} chatId
   * @param {string} messageText
   */
  onClientMessage(chatId, messageText) {
    if (!this.outcomeTracker) return;
    this.outcomeTracker.onClientMessage(chatId, messageText);
  }

  /**
   * Registra conversão manual (ex: vendedor fecha negócio no CRM).
   */
  recordManualConversion(interactionId) {
    return this.outcomeTracker?.recordManualConversion(interactionId) ?? false;
  }

  getStats() {
    return { ...this.stats };
  }

  // ─── Handler central do ciclo ─────────────────────────────────────────────

  async _onOutcome(resolved) {
    const { interactionId, chatId, responseGoal, clientStage, intent, variant, qualityScore, outcome, response } = resolved;

    try {
      this.stats.cyclesCompleted++;

      // ── Passo 4: Calcular score ─────────────────────────────────────────────
      const { score, label } = this.scoreEngine
        ? this.scoreEngine.calculate(resolved)
        : { score: outcome.replied ? 0.6 : 0.2, label: 'fallback' };

      // Atualizar histórico de scores
      this.stats.scoreHistory.push(score);
      if (this.stats.scoreHistory.length > 100) this.stats.scoreHistory.shift();
      this.stats.avgScore = +(this.stats.scoreHistory.reduce((a, b) => a + b, 0) / this.stats.scoreHistory.length).toFixed(3);

      logger.info(`[AutoLearningLoop] Outcome for ${interactionId}: score=${score} label=${label} chatId=${chatId}`);

      // ── Passo 5a: ValidatedLearningPipeline ─────────────────────────────────
      const feedbackType = this.scoreEngine?.toFeedbackType(score) ?? (outcome.replied ? 'positive' : 'negative');

      if (this.learningPipeline) {
        try {
          const message = this._pendingStrategies?.get(interactionId)?.message || '';
          await this.learningPipeline.addFeedback({
            intent:   intent || 'unknown',
            question: message,
            response,
            feedback: feedbackType,
            wasEdited: false,
          });
          this.stats.patternsLearned++;
          logger.debug(`[AutoLearningLoop] LearningPipeline.addFeedback: ${feedbackType} for intent=${intent}`);
        } catch (e) {
          logger.warn(`[AutoLearningLoop] LearningPipeline error: ${e.message}`);
        }
      }

      // ── Passo 5b: ResponseABTester com dados reais ─────────────────────────
      if (this.abTester && variant && intent) {
        try {
          const experimentId = `intent_${intent}`;
          if (this.abTester.experiments?.has(experimentId)) {
            this.abTester.recordResult(experimentId, variant, outcome.replied || outcome.converted);
            this.stats.abResultsRecorded++;
            logger.debug(`[AutoLearningLoop] ABTester.recordResult: exp=${experimentId} variant=${variant} success=${outcome.replied}`);
          }
        } catch (e) {
          logger.warn(`[AutoLearningLoop] ABTester error: ${e.message}`);
        }
      }

      // ── Passo 5c: StrategySelector aprende com o outcome ──────────────────
      if (this.strategySelector) {
        const pendingData = this._pendingStrategies?.get(interactionId);
        if (pendingData?.strategy) {
          this.strategySelector.recordOutcome({
            chatId,
            responseGoal: pendingData.responseGoal || responseGoal,
            clientStage:  pendingData.clientStage  || clientStage,
            strategy:     pendingData.strategy,
            score,
            converted: outcome.converted,
          });
          this.stats.strategyUpdates++;
          logger.debug(`[AutoLearningLoop] StrategySelector updated for ${chatId}: score=${score}`);
        }
      }

      // ── Passo 5d: Atualizar ConversationMemory com score e conversão ────────
      if (this.conversationMemory && chatId) {
        try {
          const ctx = this.conversationMemory.getOrCreateConversation(chatId);
          if (!ctx.profile.performanceHistory) ctx.profile.performanceHistory = [];
          ctx.profile.performanceHistory.push({
            score, label, converted: outcome.converted,
            responseGoal, intent, recordedAt: Date.now()
          });
          // Manter últimas 20 entradas
          if (ctx.profile.performanceHistory.length > 20) {
            ctx.profile.performanceHistory = ctx.profile.performanceHistory.slice(-20);
          }
          // Atualizar estágio se houve conversão confirmada
          if (outcome.converted && ctx.profile.stage !== 'customer') {
            ctx.profile.stage = 'customer';
            logger.info(`[AutoLearningLoop] Auto-promoted ${chatId} to 'customer' via conversion`);
          }
          ctx.updatedAt = Date.now();
        } catch (e) {
          logger.warn(`[AutoLearningLoop] ConversationMemory update error: ${e.message}`);
        }
      }

      // Limpar estratégia pending
      this._pendingStrategies?.delete(interactionId);

      this.emit('cycle_complete', { interactionId, chatId, score, label, feedbackType });

    } catch (error) {
      logger.error(`[AutoLearningLoop] Error processing outcome for ${interactionId}: ${error.message}`);
    }
  }
}

module.exports = AutoLearningLoop;
