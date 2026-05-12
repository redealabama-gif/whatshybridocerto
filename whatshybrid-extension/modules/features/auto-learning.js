/**
 * FEAT-002: Auto-Learning Pipeline - Aprendizado contínuo automático
 * 
 * Benefícios:
 * - IA que melhora sozinha com o tempo
 * - Menos necessidade de treinamento manual
 * - Adaptação automática a novos padrões
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_auto_learning',
    
    // Thresholds para aprendizado
    CONFIDENCE_THRESHOLD: 0.85,
    POSITIVE_FEEDBACK_RATIO: 0.8,
    MIN_SAMPLES: 3,
    
    // Processamento
    BATCH_SIZE: 10,
    PROCESS_INTERVAL_MS: 300000, // 5 minutos
    
    // Retenção
    MAX_CANDIDATES: 500,
    CANDIDATE_EXPIRY_DAYS: 7
  };

  class AutoLearningPipeline {
    constructor() {
      this.candidates = [];
      this.learnedPatterns = [];
      this.stats = { processed: 0, learned: 0, rejected: 0, pending: 0 };
      this.processTimer = null;
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this._startProcessing();
      this._setupEventListeners();
      this.initialized = true;
      console.log('[AutoLearning] Initialized');
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data) {
          this.candidates = data.candidates || [];
          this.learnedPatterns = data.learnedPatterns || [];
          this.stats = data.stats || this.stats;
        }
      } catch (e) {
        console.warn('[AutoLearning] Load failed:', e);
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        candidates: this.candidates.slice(-CONFIG.MAX_CANDIDATES),
        learnedPatterns: this.learnedPatterns,
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
      if (window.WHLEventBus) {
        window.WHLEventBus.on('aiResponseSent', d => this._captureCandidate(d));
        window.WHLEventBus.on('customerFeedback', d => this._processFeedback(d));
        window.WHLEventBus.on('messageEdited', d => this._handleEdit(d));
      }
    }

    _startProcessing() {
      this.processTimer = setInterval(() => this._processQueue(), CONFIG.PROCESS_INTERVAL_MS);
    }

    _captureCandidate(data) {
      const { question, response, confidence, responseId, contactId } = data;
      if (!question || !response || confidence < CONFIG.CONFIDENCE_THRESHOLD * 0.7) return;

      this.candidates.push({
        id: responseId || `cand_${Date.now()}`,
        question,
        response,
        confidence,
        contactId,
        timestamp: Date.now(),
        feedback: [],
        status: 'pending'
      });

      this.stats.pending++;
      this._saveData();
    }

    _processFeedback(data) {
      const { responseId, type } = data;
      const candidate = this.candidates.find(c => c.id === responseId);
      
      if (candidate) {
        candidate.feedback.push({
          type,
          timestamp: Date.now()
        });
        candidate.status = 'has_feedback';
        this._saveData();
      }
    }

    _handleEdit(data) {
      const { responseId, editedMessage } = data;
      const candidate = this.candidates.find(c => c.id === responseId);
      
      if (candidate) {
        candidate.editedResponse = editedMessage;
        candidate.status = 'edited';
        this._saveData();
      }
    }

    async _processQueue() {
      const now = Date.now();
      const expiryTime = now - (CONFIG.CANDIDATE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      
      // Limpar expirados
      this.candidates = this.candidates.filter(c => c.timestamp > expiryTime);

      // Processar candidatos prontos
      const readyToProcess = this.candidates
        .filter(c => c.status !== 'processed' && c.feedback.length >= CONFIG.MIN_SAMPLES)
        .slice(0, CONFIG.BATCH_SIZE);

      for (const candidate of readyToProcess) {
        await this._evaluateCandidate(candidate);
      }

      this._saveData();
    }

    async _evaluateCandidate(candidate) {
      const positive = candidate.feedback.filter(f => f.type === 'positive').length;
      const total = candidate.feedback.length;
      const ratio = total > 0 ? positive / total : 0;

      this.stats.processed++;

      if (ratio >= CONFIG.POSITIVE_FEEDBACK_RATIO && candidate.confidence >= CONFIG.CONFIDENCE_THRESHOLD) {
        await this._learnPattern(candidate);
        candidate.status = 'learned';
        this.stats.learned++;
      } else if (candidate.editedResponse) {
        // Aprender versão editada
        await this._learnPattern({
          ...candidate,
          response: candidate.editedResponse,
          source: 'human_edit'
        });
        candidate.status = 'learned_edited';
        this.stats.learned++;
      } else {
        candidate.status = 'rejected';
        this.stats.rejected++;
      }

      this.stats.pending = Math.max(0, this.stats.pending - 1);
    }

    async _learnPattern(candidate) {
      const pattern = {
        id: `pattern_${Date.now()}`,
        question: candidate.question,
        response: candidate.editedResponse || candidate.response,
        confidence: candidate.confidence,
        source: candidate.source || 'auto_learned',
        feedbackRatio: candidate.feedback.filter(f => f.type === 'positive').length / candidate.feedback.length,
        learnedAt: Date.now()
      };

      this.learnedPatterns.push(pattern);

      // Integrar com sistemas existentes
      if (window.WHLDynamicFewShot) {
        await window.WHLDynamicFewShot.addExample({
          question: pattern.question,
          answer: pattern.response,
          category: 'auto_learned',
          source: pattern.source
        });
      }

      if (window.FewShotLearning) {
        try {
          await window.FewShotLearning.addExample(pattern.question, pattern.response, 'auto_learned');
        } catch (e) {
          console.warn('[AutoLearning] FewShot integration failed:', e);
        }
      }

      // Emitir evento
      if (window.WHLEventBus) {
        window.WHLEventBus.emit('patternLearned', pattern);
      }

      console.log('[AutoLearning] Learned new pattern:', pattern.question.substring(0, 50));
    }

    /**
     * Força processamento imediato
     */
    async processNow() {
      await this._processQueue();
    }

    /**
     * Adiciona candidato manualmente
     */
    addCandidate(question, response, confidence = 0.9) {
      this._captureCandidate({ question, response, confidence, responseId: `manual_${Date.now()}` });
    }

    /**
     * Obtém estatísticas
     */
    getStats() {
      return {
        ...this.stats,
        totalCandidates: this.candidates.length,
        totalPatterns: this.learnedPatterns.length,
        learningRate: this.stats.processed > 0 
          ? ((this.stats.learned / this.stats.processed) * 100).toFixed(1) + '%' 
          : 'N/A'
      };
    }

    /**
     * Lista padrões aprendidos
     */
    getLearnedPatterns(limit = 50) {
      return this.learnedPatterns.slice(-limit).reverse();
    }

    /**
     * Exporta dados
     */
    exportData() {
      return {
        candidates: this.candidates,
        learnedPatterns: this.learnedPatterns,
        stats: this.getStats(),
        exportedAt: new Date().toISOString()
      };
    }

    destroy() {
      if (this.processTimer) clearInterval(this.processTimer);
    }
  }

  // Inicialização
  const autoLearning = new AutoLearningPipeline();
  autoLearning.init();

  window.WHLAutoLearning = autoLearning;
  window.WHLAutoLearningConfig = CONFIG;

  console.log('[FEAT-002] Auto-Learning Pipeline initialized');

})();
