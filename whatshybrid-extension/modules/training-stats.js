/**
 * 📊 Training Stats - Estatísticas de Treinamento
 * Axion v7.6.0
 * 
 * Funcionalidades:
 * - Rastreamento de estatísticas de treinamento
 * - Contador de feedbacks (bom, ruim, correções)
 * - Atualização de UI
 * - Persistência em storage
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_training_stats';

  const defaultTrainingStats = {
    good: 0,
    bad: 0,
    corrected: 0,
    suggestions_used: 0,
    suggestions_ignored: 0,
    auto_responses: 0,
    total_trainings: 0,
    lastUpdated: Date.now()
  };

  class TrainingStats {
    constructor() {
      this.stats = { ...defaultTrainingStats };
      this.initialized = false;
    }

    /**
     * Inicializa e carrega estatísticas do storage
     */
    async init() {
      if (this.initialized) return;

      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          this.stats = JSON.parse(data[STORAGE_KEY]);
          console.log('[TrainingStats] Estatísticas carregadas:', this.stats);
        }
        this.initialized = true;
      } catch (error) {
        console.error('[TrainingStats] Erro ao inicializar:', error);
        this.stats = { ...defaultTrainingStats };
      }
    }

    /**
     * Salva estatísticas no storage
     */
    async save() {
      try {
        this.stats.lastUpdated = Date.now();
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(this.stats)
        });
        console.log('[TrainingStats] Estatísticas salvas');
        return true;
      } catch (error) {
        console.error('[TrainingStats] Erro ao salvar:', error);
        return false;
      }
    }

    /**
     * Obtém estatísticas
     * @returns {Object} - Estatísticas
     */
    getTrainingStats() {
      return { ...this.stats };
    }

    /**
     * Atualiza estatísticas
     * @param {Object} updates - Atualizações parciais
     */
    async saveTrainingStats(updates) {
      this.stats = { ...this.stats, ...updates };
      await this.save();

      // Emite evento
      if (window.EventBus) {
        window.EventBus.emit('training-stats:updated', this.stats);
      }

      // Atualiza UI se disponível
      this.updateUI();
    }

    /**
     * Incrementa contador de feedback bom
     */
    async incrementGood() {
      this.stats.good++;
      this.stats.total_trainings++;
      await this.save();
      this.updateUI();
    }

    /**
     * Incrementa contador de feedback ruim
     */
    async incrementBad() {
      this.stats.bad++;
      this.stats.total_trainings++;
      await this.save();
      this.updateUI();
    }

    /**
     * Incrementa contador de correções
     */
    async incrementCorrected() {
      this.stats.corrected++;
      this.stats.total_trainings++;
      await this.save();
      this.updateUI();
    }

    /**
     * Incrementa contador de sugestões usadas
     */
    async incrementSuggestionsUsed() {
      this.stats.suggestions_used++;
      await this.save();
      this.updateUI();
    }

    /**
     * Incrementa contador de sugestões ignoradas
     */
    async incrementSuggestionsIgnored() {
      this.stats.suggestions_ignored++;
      await this.save();
      this.updateUI();
    }

    /**
     * Incrementa contador de respostas automáticas
     */
    async incrementAutoResponses() {
      this.stats.auto_responses++;
      await this.save();
      this.updateUI();
    }

    /**
     * Atualiza UI com estatísticas
     */
    updateUI() {
      // Atualiza elementos no sidepanel se existirem
      const elements = {
        'training_stat_good': this.stats.good,
        'training_stat_bad': this.stats.bad,
        'training_stat_corrected': this.stats.corrected,
        'training_stat_suggestions_used': this.stats.suggestions_used,
        'training_stat_auto_responses': this.stats.auto_responses,
        'training_stat_total': this.stats.total_trainings
      };

      Object.entries(elements).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
          element.textContent = value;
        }
      });

      // Calcula e mostra taxa de sucesso
      const total = this.stats.good + this.stats.bad;
      if (total > 0) {
        const successRate = Math.round((this.stats.good / total) * 100);
        const element = document.getElementById('training_stat_success_rate');
        if (element) {
          element.textContent = `${successRate}%`;
        }
      }
    }

    /**
     * Reseta estatísticas
     */
    async reset() {
      this.stats = { ...defaultTrainingStats };
      await this.save();
      this.updateUI();
      console.log('[TrainingStats] Estatísticas resetadas');
    }

    /**
     * Calcula métricas derivadas
     * @returns {Object} - Métricas
     */
    getMetrics() {
      const total = this.stats.good + this.stats.bad;
      const successRate = total > 0 ? (this.stats.good / total) * 100 : 0;
      const usageRate = this.stats.suggestions_used + this.stats.suggestions_ignored > 0
        ? (this.stats.suggestions_used / (this.stats.suggestions_used + this.stats.suggestions_ignored)) * 100
        : 0;

      return {
        ...this.stats,
        successRate: Math.round(successRate),
        usageRate: Math.round(usageRate),
        totalFeedback: total
      };
    }

    /**
     * Exporta estatísticas como JSON
     * @returns {string} - JSON das estatísticas
     */
    exportJSON() {
      return JSON.stringify(this.stats, null, 2);
    }

    /**
     * Importa estatísticas de JSON
     * @param {string} json - JSON das estatísticas
     */
    async importJSON(json) {
      try {
        const imported = JSON.parse(json);
        this.stats = { ...defaultTrainingStats, ...imported };
        await this.save();
        this.updateUI();
        console.log('[TrainingStats] Estatísticas importadas');
        return true;
      } catch (error) {
        console.error('[TrainingStats] Erro ao importar JSON:', error);
        return false;
      }
    }
  }

  // Exporta globalmente
  window.TrainingStats = TrainingStats;

  // Cria instância global
  if (!window.trainingStats) {
    window.trainingStats = new TrainingStats();
    window.trainingStats.init().then(() => {
      console.log('[TrainingStats] ✅ Módulo carregado e inicializado');
    });
  }

})();
