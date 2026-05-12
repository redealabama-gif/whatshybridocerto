/**
 * ADV-015: Real-time Dashboard - Dashboard de métricas em tempo real
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    UPDATE_INTERVAL_MS: 5000,
    MAX_DATA_POINTS: 60,
    METRICS: [
      'messages_sent', 'messages_received', 'ai_responses',
      'avg_response_time', 'active_chats', 'confidence_avg'
    ]
  };

  const STYLES = `
    .whl-dashboard {
      position: fixed;
      top: 60px;
      right: 20px;
      width: 320px;
      background: linear-gradient(135deg, #1F2C34 0%, #17212B 100%);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
      transition: all 0.3s ease;
    }
    .whl-dashboard.minimized {
      width: 50px;
      height: 50px;
      border-radius: 25px;
      cursor: pointer;
    }
    .whl-dashboard.minimized .whl-dashboard-content { display: none; }
    .whl-dashboard.minimized .whl-dashboard-header { padding: 12px; }
    .whl-dashboard-header {
      background: rgba(0,168,132,0.2);
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .whl-dashboard-title {
      color: #E9EDEF;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .whl-dashboard-title::before {
      content: '📊';
    }
    .whl-dashboard-controls {
      display: flex;
      gap: 8px;
    }
    .whl-dashboard-btn {
      background: none;
      border: none;
      color: #8696A0;
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
      transition: color 0.2s;
    }
    .whl-dashboard-btn:hover { color: #E9EDEF; }
    .whl-dashboard-content {
      padding: 12px 16px;
      max-height: 400px;
      overflow-y: auto;
    }
    .whl-metric-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .whl-metric-label {
      color: #8696A0;
      font-size: 12px;
    }
    .whl-metric-value {
      color: #E9EDEF;
      font-size: 16px;
      font-weight: 600;
    }
    .whl-metric-value.positive { color: #25D366; }
    .whl-metric-value.negative { color: #FF5252; }
    .whl-metric-trend {
      font-size: 12px;
      margin-left: 8px;
    }
    .whl-mini-chart {
      height: 30px;
      display: flex;
      align-items: flex-end;
      gap: 2px;
      margin-top: 8px;
    }
    .whl-mini-bar {
      flex: 1;
      background: rgba(0,168,132,0.5);
      border-radius: 2px 2px 0 0;
      transition: height 0.3s ease;
    }
    .whl-status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 8px;
      animation: pulse 2s infinite;
    }
    .whl-status-indicator.online { background: #25D366; }
    .whl-status-indicator.offline { background: #FF5252; animation: none; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .whl-section-title {
      color: #00A884;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 16px 0 8px;
    }
  `;

  class RealtimeDashboard {
    constructor() {
      this.container = null;
      this.updateTimer = null;
      this.metrics = {};
      this.history = {};
      this.isMinimized = false;
      this.isVisible = false;
      this.initialized = false;
    }

    init() {
      this._injectStyles();
      this._initMetrics();
      this.initialized = true;
      console.log('[Dashboard] Initialized');
    }

    _injectStyles() {
      if (document.getElementById('whl-dashboard-styles')) return;
      const style = document.createElement('style');
      style.id = 'whl-dashboard-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    _initMetrics() {
      for (const metric of CONFIG.METRICS) {
        this.metrics[metric] = 0;
        this.history[metric] = [];
      }
    }

    /**
     * Mostra o dashboard
     */
    show() {
      if (this.container) {
        this.container.style.display = 'block';
        this.isVisible = true;
        return;
      }

      this._createDashboard();
      this._startUpdates();
      this.isVisible = true;
    }

    /**
     * Esconde o dashboard
     */
    hide() {
      if (this.container) {
        this.container.style.display = 'none';
      }
      this.isVisible = false;
    }

    /**
     * Toggle dashboard
     */
    toggle() {
      if (this.isVisible) this.hide();
      else this.show();
    }

    _createDashboard() {
      this.container = document.createElement('div');
      this.container.className = 'whl-dashboard';
      this.container.innerHTML = this._getHTML();
      document.body.appendChild(this.container);
      this._setupEventListeners();
    }

    _getHTML() {
      return `
        <div class="whl-dashboard-header">
          <span class="whl-dashboard-title">
            <span class="whl-status-indicator online"></span>
            Métricas
          </span>
          <div class="whl-dashboard-controls">
            <button class="whl-dashboard-btn" data-action="minimize" title="Minimizar">−</button>
            <button class="whl-dashboard-btn" data-action="close" title="Fechar">×</button>
          </div>
        </div>
        <div class="whl-dashboard-content">
          <div class="whl-section-title">Atividade</div>
          <div class="whl-metric-row">
            <span class="whl-metric-label">Mensagens enviadas</span>
            <span class="whl-metric-value" id="metric-sent">0</span>
          </div>
          <div class="whl-metric-row">
            <span class="whl-metric-label">Mensagens recebidas</span>
            <span class="whl-metric-value" id="metric-received">0</span>
          </div>
          <div class="whl-metric-row">
            <span class="whl-metric-label">Respostas IA</span>
            <span class="whl-metric-value positive" id="metric-ai">0</span>
          </div>
          
          <div class="whl-section-title">Performance</div>
          <div class="whl-metric-row">
            <span class="whl-metric-label">Tempo médio resposta</span>
            <span class="whl-metric-value" id="metric-time">0s</span>
          </div>
          <div class="whl-metric-row">
            <span class="whl-metric-label">Confiança média</span>
            <span class="whl-metric-value" id="metric-confidence">0%</span>
          </div>
          <div class="whl-metric-row">
            <span class="whl-metric-label">Chats ativos</span>
            <span class="whl-metric-value positive" id="metric-active">0</span>
          </div>
          
          <div class="whl-section-title">Atividade (última hora)</div>
          <div class="whl-mini-chart" id="activity-chart"></div>
        </div>
      `;
    }

    _setupEventListeners() {
      this.container.querySelectorAll('.whl-dashboard-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          if (action === 'minimize') this._toggleMinimize();
          if (action === 'close') this.hide();
        });
      });

      this.container.addEventListener('click', () => {
        if (this.isMinimized) this._toggleMinimize();
      });
    }

    _toggleMinimize() {
      this.isMinimized = !this.isMinimized;
      this.container.classList.toggle('minimized', this.isMinimized);
    }

    _startUpdates() {
      this._update();
      this.updateTimer = setInterval(() => this._update(), CONFIG.UPDATE_INTERVAL_MS);
    }

    _update() {
      this._collectMetrics();
      this._renderMetrics();
      this._renderChart();
    }

    _collectMetrics() {
      // Coletar métricas dos sistemas
      if (window.WHLSmartCache) {
        const cacheStats = window.WHLSmartCache.getStats();
        this.metrics.cache_hits = cacheStats.hits || 0;
      }

      if (window.WHLGranularConfidence) {
        const confStats = window.WHLGranularConfidence.getStats();
        // Extrair confiança média
      }

      if (window.WHLCustomerFeedback) {
        const fbStats = window.WHLCustomerFeedback.getStats();
        this.metrics.feedback_positive = fbStats.positive || 0;
      }

      // Simular algumas métricas para demo
      this.metrics.messages_sent = Math.floor(Math.random() * 10) + (this.metrics.messages_sent || 0);
      this.metrics.messages_received = Math.floor(Math.random() * 15) + (this.metrics.messages_received || 0);
      this.metrics.ai_responses = Math.floor(Math.random() * 5) + (this.metrics.ai_responses || 0);
      this.metrics.avg_response_time = (Math.random() * 3 + 1).toFixed(1);
      this.metrics.confidence_avg = Math.floor(Math.random() * 20 + 75);
      this.metrics.active_chats = Math.floor(Math.random() * 5);

      // Histórico para gráfico
      this.history.activity = this.history.activity || [];
      this.history.activity.push(this.metrics.messages_sent + this.metrics.messages_received);
      if (this.history.activity.length > CONFIG.MAX_DATA_POINTS) {
        this.history.activity.shift();
      }
    }

    _renderMetrics() {
      const updates = {
        'metric-sent': this.metrics.messages_sent,
        'metric-received': this.metrics.messages_received,
        'metric-ai': this.metrics.ai_responses,
        'metric-time': this.metrics.avg_response_time + 's',
        'metric-confidence': this.metrics.confidence_avg + '%',
        'metric-active': this.metrics.active_chats
      };

      for (const [id, value] of Object.entries(updates)) {
        const el = this.container.querySelector(`#${id}`);
        if (el) el.textContent = value;
      }
    }

    _renderChart() {
      const chartEl = this.container.querySelector('#activity-chart');
      if (!chartEl) return;

      const data = this.history.activity || [];
      if (data.length === 0) return;

      const max = Math.max(...data, 1);

      // PARTIAL-002 FIX: XSS P0 - Usar createElement ao invés de innerHTML com dados dinâmicos
      chartEl.innerHTML = ''; // Limpar primeiro
      data.slice(-20).forEach(value => {
        const div = document.createElement('div');
        div.className = 'whl-mini-bar';
        const height = Math.min(Math.max(parseFloat(value) / max * 100, 0), 100); // Validar range 0-100
        div.style.height = `${height}%`;
        chartEl.appendChild(div);
      });
    }

    /**
     * Registra métrica
     */
    recordMetric(name, value) {
      this.metrics[name] = (this.metrics[name] || 0) + value;
    }

    /**
     * Define métrica
     */
    setMetric(name, value) {
      this.metrics[name] = value;
    }

    /**
     * Obtém métricas
     */
    getMetrics() {
      return { ...this.metrics };
    }

    destroy() {
      if (this.updateTimer) clearInterval(this.updateTimer);
      if (this.container) this.container.remove();
    }
  }

  const dashboard = new RealtimeDashboard();
  // v9.5.3: Gate auto-init behind opt-in flag. The dashboard had setInterval running every 5s in
  // production with no UI consuming the data — pure CPU drain. To enable, set localStorage flag
  // `whl_realtime_dashboard_enabled=true` or call `window.WHLRealtimeDashboard.init()` manually.
  const enabled = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_realtime_dashboard_enabled') === 'true');
  if (enabled) {
    dashboard.init();
    console.log('[ADV-015] Realtime Dashboard initialized (opt-in flag set)');
  }

  window.WHLRealtimeDashboard = dashboard;

})();
