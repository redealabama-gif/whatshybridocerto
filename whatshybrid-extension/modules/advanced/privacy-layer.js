/**
 * ADV-011/012: Privacy Layer - Federated Learning + Differential Privacy
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_privacy_layer',
    
    // Differential Privacy
    EPSILON: 1.0, // Privacy budget
    DELTA: 1e-5,
    SENSITIVITY: 1.0,
    
    // Federated Learning
    LOCAL_EPOCHS: 3,
    AGGREGATION_INTERVAL_MS: 3600000 // 1 hora
  };

  class PrivacyLayer {
    constructor() {
      this.localModel = null;
      this.privacyBudget = CONFIG.EPSILON;
      this.noiseHistory = [];
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this.initialized = true;
      console.log('[PrivacyLayer] Initialized - Privacy Budget:', this.privacyBudget);
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data) {
          this.privacyBudget = data.privacyBudget || CONFIG.EPSILON;
          this.noiseHistory = data.noiseHistory || [];
        }
      } catch (e) {
        console.warn('[PrivacyLayer] Load failed:', e);
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        privacyBudget: this.privacyBudget,
        noiseHistory: this.noiseHistory.slice(-100)
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

    // =====================
    // DIFFERENTIAL PRIVACY
    // =====================

    /**
     * Adiciona ruído Laplaciano para privacidade diferencial
     */
    addLaplaceNoise(value, sensitivity = CONFIG.SENSITIVITY) {
      if (this.privacyBudget <= 0) {
        console.warn('[PrivacyLayer] Privacy budget exhausted');
        return value;
      }

      const scale = sensitivity / this.privacyBudget;
      const u = Math.random() - 0.5;
      const noise = -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
      
      this.noiseHistory.push({
        timestamp: Date.now(),
        originalValue: value,
        noise,
        budget: this.privacyBudget
      });

      // Consumir budget
      this.privacyBudget *= 0.99;
      this._saveData();

      return value + noise;
    }

    /**
     * Adiciona ruído Gaussiano
     */
    addGaussianNoise(value, sensitivity = CONFIG.SENSITIVITY) {
      const sigma = sensitivity * Math.sqrt(2 * Math.log(1.25 / CONFIG.DELTA)) / CONFIG.EPSILON;
      
      // Box-Muller transform
      const u1 = Math.random();
      const u2 = Math.random();
      const noise = sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      
      return value + noise;
    }

    /**
     * Sanitiza dados sensíveis
     */
    sanitize(data, fields = []) {
      const sanitized = { ...data };
      
      for (const field of fields) {
        if (sanitized[field] !== undefined) {
          if (typeof sanitized[field] === 'number') {
            sanitized[field] = this.addLaplaceNoise(sanitized[field]);
          } else if (typeof sanitized[field] === 'string') {
            sanitized[field] = this._anonymizeString(sanitized[field]);
          }
        }
      }
      
      return sanitized;
    }

    _anonymizeString(str) {
      // Hash básico para anonimização
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return `anon_${Math.abs(hash).toString(36)}`;
    }

    // =====================
    // FEDERATED LEARNING
    // =====================

    /**
     * Treina modelo localmente (sem enviar dados brutos)
     */
    async trainLocal(data) {
      // Simular treinamento local
      const gradients = this._computeLocalGradients(data);
      
      // Adicionar ruído aos gradientes
      const noisyGradients = {};
      for (const [key, value] of Object.entries(gradients)) {
        noisyGradients[key] = this.addGaussianNoise(value, 0.1);
      }
      
      return {
        gradients: noisyGradients,
        sampleCount: data.length,
        timestamp: Date.now()
      };
    }

    _computeLocalGradients(data) {
      // Placeholder - computação real dependeria do modelo
      return {
        weight_1: Math.random() * 0.1 - 0.05,
        weight_2: Math.random() * 0.1 - 0.05,
        bias: Math.random() * 0.01
      };
    }

    /**
     * Prepara update para agregação federada
     */
    prepareUpdate(localUpdate) {
      // Clip gradientes
      const clipped = this._clipGradients(localUpdate.gradients, 1.0);
      
      // Adicionar ruído para DP
      const noisy = {};
      for (const [key, value] of Object.entries(clipped)) {
        noisy[key] = this.addGaussianNoise(value, 0.5);
      }
      
      return {
        gradients: noisy,
        sampleCount: localUpdate.sampleCount,
        clientId: this._getClientId(),
        timestamp: Date.now()
      };
    }

    _clipGradients(gradients, maxNorm) {
      const norm = Math.sqrt(
        Object.values(gradients).reduce((sum, g) => sum + g * g, 0)
      );
      
      if (norm > maxNorm) {
        const scale = maxNorm / norm;
        const clipped = {};
        for (const [key, value] of Object.entries(gradients)) {
          clipped[key] = value * scale;
        }
        return clipped;
      }
      
      return gradients;
    }

    _getClientId() {
      // ID anônimo do cliente
      return `client_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Agrega updates (para servidor - simulado)
     */
    aggregateUpdates(updates) {
      if (updates.length === 0) return null;

      const aggregated = {};
      const totalSamples = updates.reduce((sum, u) => sum + u.sampleCount, 0);
      
      // Média ponderada
      for (const update of updates) {
        const weight = update.sampleCount / totalSamples;
        
        for (const [key, value] of Object.entries(update.gradients)) {
          aggregated[key] = (aggregated[key] || 0) + value * weight;
        }
      }
      
      return {
        aggregatedGradients: aggregated,
        participantCount: updates.length,
        totalSamples,
        timestamp: Date.now()
      };
    }

    // =====================
    // UTILS
    // =====================

    /**
     * Obtém status de privacidade
     */
    getPrivacyStatus() {
      return {
        budgetRemaining: this.privacyBudget,
        budgetUsed: CONFIG.EPSILON - this.privacyBudget,
        percentUsed: ((1 - this.privacyBudget / CONFIG.EPSILON) * 100).toFixed(1) + '%',
        queriesWithNoise: this.noiseHistory.length
      };
    }

    /**
     * Reseta budget de privacidade
     */
    resetPrivacyBudget() {
      this.privacyBudget = CONFIG.EPSILON;
      this.noiseHistory = [];
      this._saveData();
    }

    getStats() {
      return {
        ...this.getPrivacyStatus(),
        epsilon: CONFIG.EPSILON,
        delta: CONFIG.DELTA
      };
    }
  }

  const privacyLayer = new PrivacyLayer();
  privacyLayer.init();

  window.WHLPrivacyLayer = privacyLayer;
  window.WHLPrivacyConfig = CONFIG;
  console.log('[ADV-011/012] Privacy Layer (Federated + DP) initialized');

})();
