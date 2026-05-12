/**
 * 📈 AI Analytics - Dashboard de Performance da IA
 * WhatsHybrid v7.7.0
 * 
 * Features:
 * - Métricas de qualidade
 * - Métricas de aprendizado
 * - Métricas de negócio
 * - Tendências históricas
 * - Alertas e insights
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_ai_analytics';
  const HISTORY_DAYS = 30;

  class AIAnalytics {
    constructor() {
      this.dailyStats = new Map();
      this.alerts = [];
      this.initialized = false;
      this.dailySnapshotInterval = null;
      this.hourlyMetricsInterval = null;
      this.cleanupListenerRegistered = false;
    }

    // ============================================
    // INICIALIZAÇÃO
    // ============================================
    
    async init() {
      if (this.initialized) return;

      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          const stored = JSON.parse(data[STORAGE_KEY]);
          Object.entries(stored.dailyStats || {}).forEach(([key, value]) => {
            this.dailyStats.set(key, value);
          });
          this.alerts = stored.alerts || [];
        }
        
        this.initialized = true;
        this.setupEventListeners();
        this.startDailyCollection();
        
        console.log('[AIAnalytics] ✅ Analytics inicializado');
        
      } catch (error) {
        console.error('[AIAnalytics] Erro ao inicializar:', error);
      }
    }

    // ============================================
    // EVENT LISTENERS
    // ============================================
    
    setupEventListeners() {
      if (!window.EventBus) return;
      
      // Sugestão mostrada
      window.EventBus.on('suggestion:shown', () => {
        this.incrementStat('suggestionsShown');
      });
      
      // Sugestão usada
      window.EventBus.on('suggestion:used', (data) => {
        this.incrementStat('suggestionsUsed');
        if (data.wasEdited) {
          this.incrementStat('suggestionsEdited');
        }
      });
      
      // Auto-resposta enviada
      window.EventBus.on('autopilot:auto-responded', () => {
        this.incrementStat('autoResponses');
      });
      
      // Feedback recebido
      window.EventBus.on('feedback:received', (data) => {
        this.incrementStat('feedbacksReceived');
        if (data.type === 'positive') {
          this.incrementStat('positiveFeedbacks');
        } else if (data.type === 'negative') {
          this.incrementStat('negativeFeedbacks');
        }
      });
      
      // Exemplo adicionado
      window.EventBus.on('example:added', () => {
        this.incrementStat('examplesAdded');
      });
      
      // Conversão
      window.EventBus.on('conversion:completed', (data) => {
        this.incrementStat('conversions');
        this.addValue('conversionValue', data.value || 0);
      });
      
      // Escalação
      window.EventBus.on('escalation:triggered', () => {
        this.incrementStat('escalations');
      });
      
      // Issue resolvida
      window.EventBus.on('issue:resolved', () => {
        this.incrementStat('issuesResolved');
      });
    }

    // ============================================
    // COLETA DE DADOS
    // ============================================
    
    getTodayKey() {
      return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    }

    getTodayStats() {
      const key = this.getTodayKey();
      
      if (!this.dailyStats.has(key)) {
        this.dailyStats.set(key, this.createEmptyStats());
      }
      
      return this.dailyStats.get(key);
    }

    createEmptyStats() {
      return {
        // Métricas de sugestão
        suggestionsShown: 0,
        suggestionsUsed: 0,
        suggestionsEdited: 0,
        
        // Métricas de auto-resposta
        autoResponses: 0,
        escalations: 0,
        
        // Métricas de feedback
        feedbacksReceived: 0,
        positiveFeedbacks: 0,
        negativeFeedbacks: 0,
        
        // Métricas de aprendizado
        examplesAdded: 0,
        patternsPruned: 0,
        
        // Métricas de negócio
        conversions: 0,
        conversionValue: 0,
        issuesResolved: 0,
        
        // Métricas de performance
        averageResponseTime: 0,
        cacheHitRate: 0,
        
        // Timestamp
        date: this.getTodayKey(),
        updatedAt: Date.now()
      };
    }

    incrementStat(statName, amount = 1) {
      const stats = this.getTodayStats();
      stats[statName] = (stats[statName] || 0) + amount;
      stats.updatedAt = Date.now();
      this.save();
    }

    addValue(statName, value) {
      const stats = this.getTodayStats();
      stats[statName] = (stats[statName] || 0) + value;
      stats.updatedAt = Date.now();
      this.save();
    }

    // ============================================
    // COLETA DIÁRIA
    // ============================================
    
    startDailyCollection() {
      // Coletar snapshot diário à meia-noite
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const msUntilMidnight = tomorrow.getTime() - now.getTime();
      
      setTimeout(() => {
        this.collectDailySnapshot();
        // Repetir a cada 24 horas
        if (this.dailySnapshotInterval) clearInterval(this.dailySnapshotInterval);
        this.dailySnapshotInterval = setInterval(() => this.collectDailySnapshot(), 24 * 60 * 60 * 1000);
      }, msUntilMidnight);
      
      // Também coletar a cada hora para métricas derivadas
      if (this.hourlyMetricsInterval) clearInterval(this.hourlyMetricsInterval);
      this.hourlyMetricsInterval = setInterval(() => this.collectHourlyMetrics(), 60 * 60 * 1000);

      if (!this.cleanupListenerRegistered) {
        window.addEventListener('beforeunload', () => {
          this.stopCollections();
        });
        this.cleanupListenerRegistered = true;
      }
    }

    stopCollections() {
      if (this.dailySnapshotInterval) {
        clearInterval(this.dailySnapshotInterval);
        this.dailySnapshotInterval = null;
      }
      if (this.hourlyMetricsInterval) {
        clearInterval(this.hourlyMetricsInterval);
        this.hourlyMetricsInterval = null;
      }
    }

    async collectDailySnapshot() {
      const todayStats = this.getTodayStats();
      
      // Coletar métricas de outros módulos
      if (window.aiFeedbackSystem) {
        const feedback = window.aiFeedbackSystem.getMetrics();
        todayStats.averageRating = feedback.averageRating;
        todayStats.qualityScore = window.aiFeedbackSystem.getQualityScore();
      }
      
      if (window.aiResponseCache) {
        const cache = window.aiResponseCache.getMetrics();
        todayStats.cacheHitRate = cache.hitRate;
        todayStats.cacheSize = cache.cacheSize;
      }
      
      if (window.confidenceSystem) {
        todayStats.confidenceScore = window.confidenceSystem.score;
        todayStats.confidenceLevel = window.confidenceSystem.level;
      }
      
      // Limpar histórico antigo
      this.cleanupOldStats();
      
      // Verificar alertas
      this.checkForAlerts(todayStats);
      
      await this.save();
      
      console.log('[AIAnalytics] 📊 Snapshot diário coletado');
    }

    collectHourlyMetrics() {
      const stats = this.getTodayStats();
      
      // Calcular taxas
      if (stats.suggestionsShown > 0) {
        stats.acceptanceRate = stats.suggestionsUsed / stats.suggestionsShown;
        stats.editRate = stats.suggestionsEdited / Math.max(stats.suggestionsUsed, 1);
      }
      
      if (stats.feedbacksReceived > 0) {
        stats.positiveRate = stats.positiveFeedbacks / stats.feedbacksReceived;
      }
      
      this.save();
    }

    // ============================================
    // ALERTAS E INSIGHTS
    // ============================================
    
    checkForAlerts(stats) {
      const newAlerts = [];
      
      // Alerta: Taxa de aceitação caindo
      if (stats.acceptanceRate !== undefined && stats.acceptanceRate < 0.5) {
        newAlerts.push({
          type: 'warning',
          message: `Taxa de aceitação baixa: ${(stats.acceptanceRate * 100).toFixed(1)}%`,
          suggestion: 'Considere revisar exemplos de treinamento',
          timestamp: Date.now()
        });
      }
      
      // Alerta: Muitas escalações
      const escalationRate = stats.autoResponses > 0 
        ? stats.escalations / stats.autoResponses 
        : 0;
      
      if (escalationRate > 0.3) {
        newAlerts.push({
          type: 'warning',
          message: `Alta taxa de escalação: ${(escalationRate * 100).toFixed(1)}%`,
          suggestion: 'IA pode estar tendo dificuldade com novos tipos de perguntas',
          timestamp: Date.now()
        });
      }
      
      // Alerta positivo: Boa performance
      if (stats.qualityScore > 0.8 && stats.suggestionsUsed > 10) {
        newAlerts.push({
          type: 'success',
          message: 'IA está performando muito bem!',
          suggestion: 'Score de qualidade acima de 80%',
          timestamp: Date.now()
        });
      }
      
      // Alerta: Poucas conversões
      if (stats.suggestionsUsed > 20 && stats.conversions === 0) {
        newAlerts.push({
          type: 'info',
          message: 'Nenhuma conversão registrada hoje',
          suggestion: 'Verifique se o tracking de conversões está configurado',
          timestamp: Date.now()
        });
      }
      
      // Adicionar alertas únicos
      for (const alert of newAlerts) {
        const exists = this.alerts.some(a => 
          a.message === alert.message && 
          Date.now() - a.timestamp < 24 * 60 * 60 * 1000
        );
        
        if (!exists) {
          this.alerts.push(alert);
        }
      }
      
      // Manter apenas últimos 50 alertas
      if (this.alerts.length > 50) {
        this.alerts = this.alerts.slice(-50);
      }
    }

    // ============================================
    // RELATÓRIOS
    // ============================================
    
    /**
     * Obtém dashboard completo
     */
    getDashboard() {
      const today = this.getTodayStats();
      const yesterday = this.getStatsForDate(this.getDateOffset(-1));
      const weekAgo = this.getStatsForDate(this.getDateOffset(-7));
      
      // Calcular tendências
      const trends = {
        acceptanceRate: this.calculateTrend('acceptanceRate', 7),
        qualityScore: this.calculateTrend('qualityScore', 7),
        conversions: this.calculateTrend('conversions', 7)
      };
      
      return {
        // Hoje
        today: {
          suggestionsShown: today.suggestionsShown,
          suggestionsUsed: today.suggestionsUsed,
          acceptanceRate: today.acceptanceRate || 0,
          autoResponses: today.autoResponses,
          escalations: today.escalations,
          positiveFeedbacks: today.positiveFeedbacks,
          negativeFeedbacks: today.negativeFeedbacks,
          examplesAdded: today.examplesAdded,
          conversions: today.conversions,
          conversionValue: today.conversionValue,
          qualityScore: today.qualityScore || 0,
          confidenceScore: today.confidenceScore || 0,
          cacheHitRate: today.cacheHitRate || 0
        },
        
        // Comparações
        comparisons: {
          vsYesterday: this.compareStats(today, yesterday),
          vsWeekAgo: this.compareStats(today, weekAgo)
        },
        
        // Tendências
        trends,
        
        // Alertas recentes
        alerts: this.alerts.slice(-10).reverse(),
        
        // Insights
        insights: this.generateInsights(today, trends)
      };
    }

    /**
     * Obtém estatísticas para uma data específica
     */
    getStatsForDate(dateStr) {
      return this.dailyStats.get(dateStr) || this.createEmptyStats();
    }

    getDateOffset(days) {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toISOString().split('T')[0];
    }

    /**
     * Compara duas séries de stats
     */
    compareStats(current, previous) {
      const comparison = {};
      
      const metrics = [
        'suggestionsUsed', 'autoResponses', 'positiveFeedbacks',
        'conversions', 'examplesAdded'
      ];
      
      for (const metric of metrics) {
        const curr = current[metric] || 0;
        const prev = previous[metric] || 0;
        
        if (prev === 0) {
          comparison[metric] = curr > 0 ? 100 : 0;
        } else {
          comparison[metric] = ((curr - prev) / prev) * 100;
        }
      }
      
      return comparison;
    }

    /**
     * Calcula tendência de uma métrica
     */
    calculateTrend(metric, days = 7) {
      const values = [];
      
      for (let i = 0; i < days; i++) {
        const dateStr = this.getDateOffset(-i);
        const stats = this.dailyStats.get(dateStr);
        if (stats && stats[metric] !== undefined) {
          values.push(stats[metric]);
        }
      }
      
      if (values.length < 2) return 0;
      
      // Calcular tendência linear simples
      const first = values[values.length - 1];
      const last = values[0];
      
      if (first === 0) return last > 0 ? 100 : 0;
      
      return ((last - first) / first) * 100;
    }

    /**
     * Gera insights baseados nos dados
     */
    generateInsights(today, trends) {
      const insights = [];
      
      // Insight sobre aceitação
      if (today.acceptanceRate > 0.8) {
        insights.push({
          type: 'positive',
          icon: '🎯',
          message: 'Excelente taxa de aceitação de sugestões!'
        });
      } else if (today.acceptanceRate < 0.4 && today.suggestionsShown > 5) {
        insights.push({
          type: 'negative',
          icon: '⚠️',
          message: 'Taxa de aceitação baixa. Revise os exemplos de treinamento.'
        });
      }
      
      // Insight sobre aprendizado
      if (today.examplesAdded > 5) {
        insights.push({
          type: 'positive',
          icon: '📚',
          message: `IA aprendeu ${today.examplesAdded} novos exemplos hoje!`
        });
      }
      
      // Insight sobre tendência
      if (trends.qualityScore > 10) {
        insights.push({
          type: 'positive',
          icon: '📈',
          message: 'Qualidade da IA está melhorando!'
        });
      } else if (trends.qualityScore < -10) {
        insights.push({
          type: 'warning',
          icon: '📉',
          message: 'Qualidade da IA está caindo. Verifique os feedbacks.'
        });
      }
      
      // Insight sobre conversões
      if (today.conversions > 0) {
        insights.push({
          type: 'success',
          icon: '💰',
          message: `${today.conversions} conversão(ões) assistida(s) por IA!`
        });
      }
      
      // Insight sobre cache
      if (today.cacheHitRate > 0.5) {
        insights.push({
          type: 'info',
          icon: '⚡',
          message: `Cache hit rate de ${(today.cacheHitRate * 100).toFixed(0)}% - Economia de tokens!`
        });
      }
      
      return insights;
    }

    /**
     * Obtém histórico de uma métrica
     */
    getMetricHistory(metric, days = 7) {
      const history = [];
      
      for (let i = days - 1; i >= 0; i--) {
        const dateStr = this.getDateOffset(-i);
        const stats = this.dailyStats.get(dateStr);
        
        history.push({
          date: dateStr,
          value: stats?.[metric] || 0
        });
      }
      
      return history;
    }

    // ============================================
    // MANUTENÇÃO
    // ============================================
    
    cleanupOldStats() {
      const cutoffDate = this.getDateOffset(-HISTORY_DAYS);
      
      for (const key of this.dailyStats.keys()) {
        if (key < cutoffDate) {
          this.dailyStats.delete(key);
        }
      }
    }

    // ============================================
    // PERSISTÊNCIA
    // ============================================
    
    async save() {
      try {
        const data = {
          dailyStats: Object.fromEntries(this.dailyStats),
          alerts: this.alerts,
          savedAt: Date.now()
        };
        
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(data)
        });
        
        return true;
      } catch (error) {
        console.error('[AIAnalytics] Erro ao salvar:', error);
        return false;
      }
    }

    // ============================================
    // API PÚBLICA
    // ============================================
    
    /**
     * Obtém resumo rápido
     */
    getQuickSummary() {
      const today = this.getTodayStats();
      
      return {
        suggestionsUsed: today.suggestionsUsed,
        acceptanceRate: `${((today.acceptanceRate || 0) * 100).toFixed(0)}%`,
        qualityScore: `${((today.qualityScore || 0) * 100).toFixed(0)}%`,
        examplesAdded: today.examplesAdded,
        conversions: today.conversions
      };
    }

    /**
     * Exporta dados para CSV
     */
    exportToCSV() {
      const headers = [
        'date', 'suggestionsShown', 'suggestionsUsed', 'acceptanceRate',
        'autoResponses', 'escalations', 'positiveFeedbacks', 'negativeFeedbacks',
        'examplesAdded', 'conversions', 'conversionValue', 'qualityScore'
      ];
      
      const rows = [headers.join(',')];
      
      const sortedDates = Array.from(this.dailyStats.keys()).sort();
      
      for (const date of sortedDates) {
        const stats = this.dailyStats.get(date);
        const row = headers.map(h => stats[h] || 0);
        rows.push(row.join(','));
      }
      
      return rows.join('\n');
    }
  }

  // ============================================
  // EXPORTAR
  // ============================================
  
  window.AIAnalytics = AIAnalytics;
  
  if (!window.aiAnalytics) {
    window.aiAnalytics = new AIAnalytics();
    window.aiAnalytics.init().then(() => {
      console.log('[AIAnalytics] ✅ Dashboard de analytics inicializado');
    });
  }

})();
