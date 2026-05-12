/**
 * 🎯 PerformanceScoreEngine
 * WhatsHybrid Pro v10.2.0 — Auto-Evolutionary AI
 *
 * Calcula um score de performance (0→1) para cada resposta enviada,
 * baseado em outcomes REAIS medidos pelo ResponseOutcomeTracker.
 *
 * Formula:
 *   score = w_reply*reply_score + w_conv*conversion_score + w_speed*speed_score + w_quality*quality_score
 *
 * Onde:
 *   reply_score      = cliente respondeu? (0 ou 1)
 *   conversion_score = houve intenção de compra no reply? (0, 0.5 ou 1)
 *   speed_score      = quão rápido o cliente respondeu (0→1, mais rápido = melhor)
 *   quality_score    = qualityScore do ResponseQualityChecker normalizado
 *
 * Esse score alimenta:
 *   - ValidatedLearningPipeline.addFeedback('converted' ou 'positive' ou 'negative')
 *   - StrategySelector para escolher melhor abordagem
 *   - ResponseABTester.recordResult com dados reais
 *
 * @module ai/learning/outcome/PerformanceScoreEngine
 */

const logger = require('../../../config/logger');

// Pesos por componente do score
const DEFAULT_WEIGHTS = {
  reply:    0.35,  // se o cliente respondeu (básico)
  convert:  0.40,  // se houve intenção de compra (mais valioso)
  speed:    0.10,  // velocidade da resposta (engajamento)
  quality:  0.15,  // score interno do QualityChecker
};

// Referência de velocidade: reply em < 2 min = score máximo de velocidade
const FAST_REPLY_THRESHOLD_MS = 2 * 60 * 1000;
// > 20 min = score de velocidade zero
const SLOW_REPLY_THRESHOLD_MS = 20 * 60 * 1000;

class PerformanceScoreEngine {
  constructor(config = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...(config.weights || {}) };

    // CORREÇÃO P1: tenantId para namespace no banco
    this.tenantId = config.tenantId || 'default';

    // Cache in-memory dos scores (persistido no banco entre restarts)
    this.history = {
      byGoal:    {},
      byVariant: {},
      byStage:   {},
      byIntent:  {},
    };

    this.stats = { total: 0, avgScore: null, topGoal: null, topVariant: null };
  }

  /** CORREÇÃO P1: Persiste score no banco com namespace por tenant */
  _persistScoreToDB(dimension, dimensionValue, score, components) {
    try {
      const db = require('../../../utils/database');
      db.run(
        `INSERT INTO performance_scores (workspace_id, dimension, dimension_value, score, components)
         VALUES (?, ?, ?, ?, ?)`,
        [this.tenantId, dimension, String(dimensionValue), score, JSON.stringify(components || {})]
      );
    } catch (err) {
      logger.warn(`[PerformanceScoreEngine] _persistScoreToDB error: ${err.message}`);
    }
  }

  /**
   * Calcula o performance score de um outcome resolvido.
   *
   * @param {Object} resolvedOutcome – Objeto retornado pelo ResponseOutcomeTracker
   * @returns {{ score: number, components: Object, label: string }}
   */
  calculate(resolvedOutcome) {
    const { outcome, responseGoal, clientStage, intent, variant, qualityScore } = resolvedOutcome;
    if (!outcome) return { score: 0, components: {}, label: 'no_outcome' };

    // ── 1. Reply score ───────────────────────────────────────────────────────
    const replyScore = outcome.replied ? 1.0 : 0.0;

    // ── 2. Conversion score ──────────────────────────────────────────────────
    let conversionScore = 0;
    if (outcome.converted) {
      conversionScore = 1.0;
    } else if (outcome.replied && !outcome.disinterested) {
      // Respondeu mas sem conversão explícita = engajamento parcial
      conversionScore = 0.4;
    } else if (outcome.disinterested) {
      conversionScore = 0.0;
    }

    // ── 3. Speed score ───────────────────────────────────────────────────────
    let speedScore = 0;
    if (outcome.replied && outcome.replyTimeMs !== null) {
      if (outcome.replyTimeMs <= FAST_REPLY_THRESHOLD_MS) {
        speedScore = 1.0;
      } else if (outcome.replyTimeMs >= SLOW_REPLY_THRESHOLD_MS) {
        speedScore = 0.0;
      } else {
        // Interpolação linear
        const range = SLOW_REPLY_THRESHOLD_MS - FAST_REPLY_THRESHOLD_MS;
        const elapsed = outcome.replyTimeMs - FAST_REPLY_THRESHOLD_MS;
        speedScore = 1 - (elapsed / range);
      }
    }

    // ── 4. Quality score (normalizado de 0→100 para 0→1) ────────────────────
    const qualityNorm = qualityScore !== null ? qualityScore / 100 : 0.5;

    // ── 5. Score final ponderado ─────────────────────────────────────────────
    const w = this.weights;
    const score = Math.min(1, Math.max(0,
      w.reply   * replyScore    +
      w.convert * conversionScore +
      w.speed   * speedScore    +
      w.quality * qualityNorm
    ));

    const components = {
      replyScore:      +replyScore.toFixed(3),
      conversionScore: +conversionScore.toFixed(3),
      speedScore:      +speedScore.toFixed(3),
      qualityNorm:     +qualityNorm.toFixed(3),
    };

    const label = this._scoreLabel(score, outcome);

    // ── 6. Atualizar histórico ───────────────────────────────────────────────
    this._record(score, { responseGoal, clientStage, intent, variant });

    logger.debug(`[PerformanceScore] ${resolvedOutcome.interactionId} → score=${score.toFixed(3)} label=${label}`);
    return { score: +score.toFixed(4), components, label };
  }

  /**
   * Traduz o score num FeedbackType para o ValidatedLearningPipeline.
   *   score ≥ 0.75 → 'converted'
   *   score ≥ 0.50 → 'positive'
   *   score ≥ 0.25 → 'neutral'
   *   score <  0.25 → 'negative'
   */
  toFeedbackType(score) {
    if (score >= 0.75) return 'converted';
    if (score >= 0.50) return 'positive';
    if (score >= 0.25) return 'neutral';
    return 'negative';
  }

  /**
   * Retorna o melhor goal/variant/stage com base no histórico de scores.
   * Usado pelo StrategySelector.
   */
  getBestPerformers() {
    return {
      byGoal:    this._topKey(this.history.byGoal),
      byVariant: this._topKey(this.history.byVariant),
      byStage:   this._topKey(this.history.byStage),
      byIntent:  this._topKey(this.history.byIntent),
    };
  }

  /**
   * Retorna médias de score agrupadas por goal.
   */
  getGoalScores() {
    const result = {};
    for (const [goal, scores] of Object.entries(this.history.byGoal)) {
      if (scores.length === 0) continue;
      result[goal] = {
        count:    scores.length,
        avgScore: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3),
      };
    }
    return result;
  }

  getStats() {
    return { ...this.stats, historySize: Object.values(this.history.byGoal).flat().length };
  }

  // ─── privado ───────────────────────────────────────────────────────────────

  _scoreLabel(score, outcome) {
    if (outcome.converted)                return 'converted';
    if (score >= 0.75)                    return 'high_engagement';
    if (score >= 0.50 && outcome.replied) return 'engaged';
    if (score >= 0.25)                    return 'low_engagement';
    if (outcome.disinterested)            return 'disinterested';
    return 'ignored';
  }

  _record(score, { responseGoal, clientStage, intent, variant }) {
    this.stats.total++;

    // CORREÇÃO P1: Persistir score no banco com namespace por tenant
    this._persistScoreToDB('goal', responseGoal, score, components);
    if (variant) this._persistScoreToDB('variant', variant, score, components);
    if (clientStage) this._persistScoreToDB('stage', clientStage, score, components);
    if (intent) this._persistScoreToDB('intent', intent, score, components);

    const addTo = (map, key) => {
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(score);
      if (map[key].length > 200) map[key].shift(); // janela rolante de 200
    };

    addTo(this.history.byGoal,    responseGoal);
    addTo(this.history.byVariant, variant);
    addTo(this.history.byStage,   clientStage);
    addTo(this.history.byIntent,  intent);

    const allScores = Object.values(this.history.byGoal).flat();
    this.stats.avgScore = allScores.length > 0
      ? +(allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(3)
      : null;

    this.stats.topGoal    = this._topKey(this.history.byGoal);
    this.stats.topVariant = this._topKey(this.history.byVariant);
  }

  _topKey(map) {
    let best = null, bestScore = -1;
    for (const [key, scores] of Object.entries(map)) {
      if (scores.length < 3) continue; // mínimo de amostras
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg > bestScore) { bestScore = avg; best = key; }
    }
    return best;
  }
}

module.exports = PerformanceScoreEngine;
