/**
 * ADV-005: Autonomous Learning Pipeline - Pipeline de aprendizado autônomo
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_autonomous_learning',
    EVALUATION_INTERVAL_MS: 3600000, // 1 hora
    MIN_CONFIDENCE_FOR_INTEGRATION: 0.9,
    MAX_PENDING_LEARNINGS: 100
  };

  class AutonomousLearning {
    constructor() {
      this.pendingLearnings = [];
      this.integratedLearnings = [];
      this.evaluationQueue = [];
      this.stats = { evaluated: 0, integrated: 0, rejected: 0 };
      this.evaluationTimer = null;
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this._startEvaluationCycle();
      this._setupEventListeners();
      this.initialized = true;
      console.log('[AutonomousLearning] Initialized');
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data) {
          this.pendingLearnings = data.pendingLearnings || [];
          this.integratedLearnings = data.integratedLearnings || [];
          this.stats = data.stats || this.stats;
        }
      } catch (e) {
        console.warn('[AutonomousLearning] Load failed:', e);
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        pendingLearnings: this.pendingLearnings.slice(-CONFIG.MAX_PENDING_LEARNINGS),
        integratedLearnings: this.integratedLearnings.slice(-500),
        stats: this.stats
      });
    }

    _getStorage(key) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.get([key], res => r(res[key]));
        else r(null);
      });
    }

    _setStorage(key, value) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.set({ [key]: value }, r);
        else r();
      });
    }

    _setupEventListeners() {
      // v9.5.3: BUS-FIX — was listening on window.WHLEventBus but production uses window.EventBus.
      // Module was completely dead since it never received any events. Now correctly subscribed.
      const bus = window.EventBus || window.WHLEventBus;
      if (bus && typeof bus.on === 'function') {
        bus.on('successfulInteraction', d => this._captureLearning(d));
        bus.on('patternDetected', d => this._captureLearning(d));
      }
    }

    _startEvaluationCycle() {
      this.evaluationTimer = setInterval(() => {
        this._evaluatePending();
      }, CONFIG.EVALUATION_INTERVAL_MS);
    }

    _captureLearning(data) {
      const learning = {
        id: `learn_${Date.now()}`,
        type: data.type || 'interaction',
        input: data.input,
        output: data.output,
        context: data.context,
        confidence: data.confidence || 0.5,
        source: data.source || 'event',
        capturedAt: Date.now(),
        evaluations: []
      };

      this.pendingLearnings.push(learning);
      this._saveData();
    }

    async _evaluatePending() {
      const toEvaluate = this.pendingLearnings.filter(l => l.evaluations.length < 3);

      for (const learning of toEvaluate.slice(0, 10)) {
        const evaluation = await this._evaluateLearning(learning);
        learning.evaluations.push(evaluation);
        this.stats.evaluated++;

        if (this._shouldIntegrate(learning)) {
          await this._integrateLearning(learning);
        } else if (this._shouldReject(learning)) {
          this._rejectLearning(learning);
        }
      }

      this._saveData();
    }

    async _evaluateLearning(learning) {
      // Avaliação baseada em múltiplos critérios
      const scores = {
        coherence: this._evaluateCoherence(learning),
        relevance: this._evaluateRelevance(learning),
        quality: this._evaluateQuality(learning),
        novelty: this._evaluateNovelty(learning)
      };

      const avgScore = Object.values(scores).reduce((a, b) => a + b, 0) / 4;

      return {
        timestamp: Date.now(),
        scores,
        avgScore,
        passed: avgScore >= CONFIG.MIN_CONFIDENCE_FOR_INTEGRATION
      };
    }

    _evaluateCoherence(learning) {
      if (!learning.input || !learning.output) return 0;
      
      // Verificar se a resposta tem relação com a entrada
      const inputWords = new Set(learning.input.toLowerCase().split(/\s+/));
      const outputWords = learning.output.toLowerCase().split(/\s+/);
      
      const overlap = outputWords.filter(w => inputWords.has(w)).length;
      return Math.min(1, overlap / 3);
    }

    _evaluateRelevance(learning) {
      if (!learning.output) return 0;
      
      const hasContent = learning.output.length > 20;
      const notTooLong = learning.output.length < 1000;
      const hasStructure = /[.!?]/.test(learning.output);
      
      return (hasContent ? 0.4 : 0) + (notTooLong ? 0.3 : 0) + (hasStructure ? 0.3 : 0);
    }

    _evaluateQuality(learning) {
      // Baseado em confiança original e feedback
      let score = learning.confidence || 0.5;
      
      if (learning.feedback) {
        score = score * 0.5 + (learning.feedback.positive ? 0.5 : 0);
      }
      
      return score;
    }

    _evaluateNovelty(learning) {
      // Verificar se é diferente dos já integrados
      const similar = this.integratedLearnings.filter(l => {
        if (!l.input || !learning.input) return false;
        return this._similarity(l.input, learning.input) > 0.8;
      });
      
      return similar.length === 0 ? 1 : 0.3;
    }

    _similarity(str1, str2) {
      const s1 = str1.toLowerCase();
      const s2 = str2.toLowerCase();
      const longer = s1.length > s2.length ? s1 : s2;
      const shorter = s1.length > s2.length ? s2 : s1;
      
      if (longer.length === 0) return 1;
      return (longer.length - this._editDistance(longer, shorter)) / longer.length;
    }

    _editDistance(s1, s2) {
      const m = s1.length, n = s2.length;
      if (m === 0) return n;
      if (n === 0) return m;
      
      const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
      for (let i = 0; i <= m; i++) dp[i][0] = i;
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = Math.min(
            dp[i-1][j] + 1,
            dp[i][j-1] + 1,
            dp[i-1][j-1] + (s1[i-1] !== s2[j-1] ? 1 : 0)
          );
        }
      }
      return dp[m][n];
    }

    _shouldIntegrate(learning) {
      if (learning.evaluations.length < 2) return false;
      
      const passed = learning.evaluations.filter(e => e.passed).length;
      return passed >= 2;
    }

    _shouldReject(learning) {
      if (learning.evaluations.length < 3) return false;
      
      const avgScore = learning.evaluations.reduce((s, e) => s + e.avgScore, 0) / 
                       learning.evaluations.length;
      return avgScore < 0.5;
    }

    async _integrateLearning(learning) {
      learning.integratedAt = Date.now();
      this.integratedLearnings.push(learning);
      this.pendingLearnings = this.pendingLearnings.filter(l => l.id !== learning.id);
      this.stats.integrated++;

      // Integrar com outros sistemas
      if (window.WHLDynamicFewShot && learning.input && learning.output) {
        await window.WHLDynamicFewShot.addExample({
          question: learning.input,
          answer: learning.output,
          category: 'autonomous_learned'
        });
      }

      const bus = window.EventBus || window.WHLEventBus;
      if (bus && typeof bus.emit === 'function') {
        bus.emit('learningIntegrated', learning);
      }

      console.log('[AutonomousLearning] Integrated:', learning.id);
    }

    _rejectLearning(learning) {
      this.pendingLearnings = this.pendingLearnings.filter(l => l.id !== learning.id);
      this.stats.rejected++;
    }

    /**
     * Submete aprendizado manualmente
     */
    submit(input, output, context = {}) {
      this._captureLearning({
        type: 'manual',
        input,
        output,
        context,
        confidence: 0.8,
        source: 'manual_submission'
      });
    }

    getStats() {
      return {
        ...this.stats,
        pending: this.pendingLearnings.length,
        integrated: this.integratedLearnings.length,
        integrationRate: this.stats.evaluated > 0 
          ? ((this.stats.integrated / this.stats.evaluated) * 100).toFixed(1) + '%'
          : 'N/A'
      };
    }

    destroy() {
      if (this.evaluationTimer) clearInterval(this.evaluationTimer);
    }
  }

  const autonomous = new AutonomousLearning();
  autonomous.init();

  window.WHLAutonomousLearning = autonomous;
  console.log('[ADV-005] Autonomous Learning initialized');

})();
