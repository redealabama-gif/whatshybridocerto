/**
 * 📊 Metrics Dashboard - Dashboard de Métricas em Tempo Real
 * WhatsHybrid v7.9.12
 * 
 * Provê um dashboard visual para monitorar KPIs e saúde do sistema.
 * 
 * Uso: WHLMetrics.show() ou Ctrl+Shift+M
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const DASHBOARD_ID = 'whl-metrics-dashboard';
  const REFRESH_INTERVAL = 5000;

  let refreshTimer = null;
  let isVisible = false;

  const metrics = {
    // Latências
    latencies: {
      aiResponse: [],
      backendRequest: [],
      storageOps: []
    },
    
    // Contadores
    counters: {
      messagesSent: 0,
      messagesReceived: 0,
      aiRequests: 0,
      aiErrors: 0,
      syncOperations: 0,
      syncErrors: 0
    },
    
    // Timestamps
    timestamps: {
      sessionStart: Date.now(),
      lastActivity: Date.now()
    }
  };

  /**
   * Registra latência de uma operação
   */
  function recordLatency(type, ms) {
    if (!metrics.latencies[type]) {
      metrics.latencies[type] = [];
    }
    metrics.latencies[type].push(ms);
    
    // Manter apenas últimas 100 medições
    if (metrics.latencies[type].length > 100) {
      metrics.latencies[type].shift();
    }
  }

  /**
   * Incrementa contador
   */
  function incrementCounter(name, amount = 1) {
    if (name in metrics.counters) {
      metrics.counters[name] += amount;
    }
    metrics.timestamps.lastActivity = Date.now();
  }

  /**
   * Calcula média de array
   */
  function avg(arr) {
    if (!arr || arr.length === 0) return 0;
    return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  }

  /**
   * Calcula percentil
   */
  function percentile(arr, p) {
    if (!arr || arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  /**
   * Formata duração em ms para string legível
   */
  function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  }

  /**
   * Coleta métricas do sistema
   */
  function collectSystemMetrics() {
    const data = {
      // Session info
      session: {
        uptime: Date.now() - metrics.timestamps.sessionStart,
        lastActivity: Date.now() - metrics.timestamps.lastActivity
      },
      
      // Latências
      latency: {
        ai: {
          avg: avg(metrics.latencies.aiResponse),
          p95: percentile(metrics.latencies.aiResponse, 95),
          samples: metrics.latencies.aiResponse.length
        },
        backend: {
          avg: avg(metrics.latencies.backendRequest),
          p95: percentile(metrics.latencies.backendRequest, 95),
          samples: metrics.latencies.backendRequest.length
        }
      },
      
      // Contadores
      counts: { ...metrics.counters },
      
      // Módulos
      modules: {
        eventBus: window.EventBus?.getStats?.() || null,
        memorySystem: window.memorySystem?.getStats?.() || null,
        confidenceSystem: {
          score: window.confidenceSystem?.score || 0,
          level: window.confidenceSystem?.level || 'unknown'
        },
        autopilot: window.AutopilotV2?.getStats?.() || null
      },
      
      // Performance
      performance: {
        memory: performance.memory ? {
          usedJSHeapSize: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
          totalJSHeapSize: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
        } : null
      }
    };
    
    return data;
  }

  /**
   * Renderiza o dashboard
   */
  function renderDashboard() {
    const existing = document.getElementById(DASHBOARD_ID);
    if (existing) existing.remove();

    const data = collectSystemMetrics();

    const dashboard = document.createElement('div');
    dashboard.id = DASHBOARD_ID;
    dashboard.innerHTML = `
      <style>
        #${DASHBOARD_ID} {
          position: fixed;
          top: 20px;
          right: 20px;
          width: 400px;
          max-height: 80vh;
          background: rgba(20, 20, 30, 0.98);
          border: 1px solid rgba(139, 92, 246, 0.4);
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          z-index: 99999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          overflow: hidden;
          backdrop-filter: blur(20px);
        }
        
        #${DASHBOARD_ID} .header {
          background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
          padding: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        #${DASHBOARD_ID} .title {
          color: white;
          font-size: 14px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        #${DASHBOARD_ID} .close-btn {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 16px;
        }
        
        #${DASHBOARD_ID} .body {
          padding: 16px;
          max-height: calc(80vh - 60px);
          overflow-y: auto;
          color: #e5e7eb;
          font-size: 13px;
        }
        
        #${DASHBOARD_ID} .section {
          margin-bottom: 16px;
        }
        
        #${DASHBOARD_ID} .section-title {
          font-size: 11px;
          text-transform: uppercase;
          color: #9ca3af;
          margin-bottom: 8px;
          letter-spacing: 0.5px;
        }
        
        #${DASHBOARD_ID} .metric-row {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        
        #${DASHBOARD_ID} .metric-label {
          color: #9ca3af;
        }
        
        #${DASHBOARD_ID} .metric-value {
          font-weight: 600;
          color: #8b5cf6;
        }
        
        #${DASHBOARD_ID} .metric-value.good { color: #10b981; }
        #${DASHBOARD_ID} .metric-value.warn { color: #f59e0b; }
        #${DASHBOARD_ID} .metric-value.bad { color: #ef4444; }
        
        #${DASHBOARD_ID} .kpi-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 16px;
        }
        
        #${DASHBOARD_ID} .kpi-card {
          background: rgba(139, 92, 246, 0.1);
          border: 1px solid rgba(139, 92, 246, 0.2);
          border-radius: 12px;
          padding: 12px;
          text-align: center;
        }
        
        #${DASHBOARD_ID} .kpi-value {
          font-size: 24px;
          font-weight: 700;
          color: #8b5cf6;
        }
        
        #${DASHBOARD_ID} .kpi-label {
          font-size: 11px;
          color: #9ca3af;
          margin-top: 4px;
        }
      </style>
      
      <div class="header">
        <div class="title">
          <span>📊</span>
          <span>WhatsHybrid Metrics</span>
        </div>
        <button class="close-btn" id="whl-metrics-close">✕</button>
      </div>
      
      <div class="body">
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-value">${formatDuration(data.session.uptime)}</div>
            <div class="kpi-label">Uptime</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">${data.modules.confidenceSystem.score}%</div>
            <div class="kpi-label">Confidence</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">${data.counts.messagesSent}</div>
            <div class="kpi-label">Msgs Enviadas</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value">${data.counts.aiRequests}</div>
            <div class="kpi-label">AI Requests</div>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">⚡ Latências</div>
          <div class="metric-row">
            <span class="metric-label">AI Response (avg)</span>
            <span class="metric-value ${data.latency.ai.avg < 2000 ? 'good' : data.latency.ai.avg < 5000 ? 'warn' : 'bad'}">${data.latency.ai.avg}ms</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">AI Response (p95)</span>
            <span class="metric-value">${data.latency.ai.p95}ms</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Backend (avg)</span>
            <span class="metric-value ${data.latency.backend.avg < 500 ? 'good' : data.latency.backend.avg < 2000 ? 'warn' : 'bad'}">${data.latency.backend.avg}ms</span>
          </div>
        </div>
        
        <div class="section">
          <div class="section-title">🧠 Módulos</div>
          <div class="metric-row">
            <span class="metric-label">EventBus Listeners</span>
            <span class="metric-value">${data.modules.eventBus?.totalListeners || 0}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Memórias</span>
            <span class="metric-value">${data.modules.memorySystem?.totalMemories || 0}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Confidence Level</span>
            <span class="metric-value">${data.modules.confidenceSystem.level}</span>
          </div>
          ${data.modules.autopilot ? `
          <div class="metric-row">
            <span class="metric-label">Autopilot Queue</span>
            <span class="metric-value">${data.modules.autopilot.pendingChats || 0}</span>
          </div>
          ` : ''}
        </div>
        
        ${data.performance.memory ? `
        <div class="section">
          <div class="section-title">💾 Memória</div>
          <div class="metric-row">
            <span class="metric-label">Heap Used</span>
            <span class="metric-value ${data.performance.memory.usedJSHeapSize < 100 ? 'good' : 'warn'}">${data.performance.memory.usedJSHeapSize}MB</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Heap Total</span>
            <span class="metric-value">${data.performance.memory.totalJSHeapSize}MB</span>
          </div>
        </div>
        ` : ''}
        
        <div class="section">
          <div class="section-title">❌ Erros</div>
          <div class="metric-row">
            <span class="metric-label">AI Errors</span>
            <span class="metric-value ${data.counts.aiErrors === 0 ? 'good' : 'bad'}">${data.counts.aiErrors}</span>
          </div>
          <div class="metric-row">
            <span class="metric-label">Sync Errors</span>
            <span class="metric-value ${data.counts.syncErrors === 0 ? 'good' : 'bad'}">${data.counts.syncErrors}</span>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(dashboard);

    // Close button
    document.getElementById('whl-metrics-close').addEventListener('click', hide);

    // Auto-refresh
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(renderDashboard, REFRESH_INTERVAL);
  }

  /**
   * Mostra o dashboard
   */
  function show() {
    if (isVisible) return;
    isVisible = true;
    renderDashboard();
    console.log('[Metrics] Dashboard aberto');
  }

  /**
   * Esconde o dashboard
   */
  function hide() {
    isVisible = false;
    const dashboard = document.getElementById(DASHBOARD_ID);
    if (dashboard) dashboard.remove();
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    console.log('[Metrics] Dashboard fechado');
  }

  /**
   * Toggle visibilidade
   */
  function toggle() {
    isVisible ? hide() : show();
  }

  /**
   * Configura event listeners para coleta automática
   */
  function setupEventListeners() {
    if (!window.EventBus) return;

    // AI requests
    window.EventBus.on('ai:request:start', () => {
      incrementCounter('aiRequests');
    });

    window.EventBus.on('ai:request:complete', (data) => {
      if (data?.latency) recordLatency('aiResponse', data.latency);
    });

    window.EventBus.on('ai:request:error', () => {
      incrementCounter('aiErrors');
    });

    // Messages
    window.EventBus.on('message:sent', () => {
      incrementCounter('messagesSent');
    });

    window.EventBus.on('message:received', () => {
      incrementCounter('messagesReceived');
    });

    // Sync
    window.EventBus.on('sync:complete', () => {
      incrementCounter('syncOperations');
    });

    window.EventBus.on('sync:error', () => {
      incrementCounter('syncErrors');
    });
  }

  // Atalho de teclado: Ctrl+Shift+M
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'M') {
      e.preventDefault();
      toggle();
    }
  });

  // Setup listeners quando EventBus estiver pronto
  if (window.EventBus) {
    setupEventListeners();
  } else {
    const checkInterval = setInterval(() => {
      if (window.EventBus) {
        setupEventListeners();
        clearInterval(checkInterval);
      }
    }, 500);
    
    setTimeout(() => clearInterval(checkInterval), 10000);
  }

  // Exportar globalmente
  window.WHLMetrics = {
    show,
    hide,
    toggle,
    recordLatency,
    incrementCounter,
    getMetrics: collectSystemMetrics,
    formatDuration
  };

  console.log('[Metrics] ✅ Dashboard carregado. Use Ctrl+Shift+M ou WHLMetrics.show()');
})();
