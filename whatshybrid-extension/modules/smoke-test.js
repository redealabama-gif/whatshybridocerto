/**
 * 🔬 Smoke Test System
 * Validação inicial do ambiente WhatsApp Web
 * 
 * Executa na inicialização:
 * 1. Verifica window.Store (API interna)
 * 2. Valida seletores críticos
 * 3. Testa conectividade
 * 4. Grava health status
 * 
 * @version 1.0.0
 */
(function() {
  'use strict';

  const STORAGE_KEY = 'whl_smoke_test_results';
  const HEALTH_HISTORY_KEY = 'whl_health_history';
  const MAX_HISTORY = 50;

  // ═══════════════════════════════════════════════════════════════════
  // CONFIGURAÇÃO DOS TESTES
  // ═══════════════════════════════════════════════════════════════════

  const TESTS = {
    // Testes da API interna do WhatsApp
    whatsappStore: {
      name: 'WhatsApp Store API',
      critical: true,
      timeout: 5000,
      test: async () => {
        // Aguarda Store estar disponível
        const maxWait = 10000;
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWait) {
          if (window.Store && window.Store.Chat && window.Store.Msg) {
            return {
              passed: true,
              details: {
                hasChat: !!window.Store.Chat,
                hasMsg: !!window.Store.Msg,
                hasContact: !!window.Store.Contact,
                hasConn: !!window.Store.Conn
              }
            };
          }
          await new Promise(r => setTimeout(r, 500));
        }
        
        return {
          passed: false,
          error: 'window.Store não disponível após timeout',
          details: { timeout: maxWait }
        };
      }
    },

    // Teste de conectividade do WhatsApp
    whatsappConnection: {
      name: 'Conexão WhatsApp',
      critical: true,
      timeout: 3000,
      test: async () => {
        try {
          // Verifica se está conectado
          const isConnected = window.Store?.Conn?.isRegistered?.() || 
                              document.querySelector('[data-testid="chat-list"]') !== null;
          
          return {
            passed: isConnected,
            error: isConnected ? null : 'WhatsApp não está conectado',
            details: { isConnected }
          };
        } catch (e) {
          return { passed: false, error: e.message };
        }
      }
    },

    // Teste de seletores críticos
    criticalSelectors: {
      name: 'Seletores Críticos',
      critical: true,
      timeout: 3000,
      test: async () => {
        const selectors = {
          chatList: [
            '[data-testid="chat-list"]',
            '#pane-side'
          ],
          mainPanel: [
            '#main',
            '[data-testid="conversation-panel-wrapper"]'
          ],
          header: [
            'header[data-testid="chatlist-header"]',
            '#app header'
          ]
        };

        const results = {};
        let allPassed = true;

        for (const [name, variants] of Object.entries(selectors)) {
          let found = false;
          for (const selector of variants) {
            if (document.querySelector(selector)) {
              found = true;
              results[name] = { found: true, selector };
              break;
            }
          }
          if (!found) {
            results[name] = { found: false };
            allPassed = false;
          }
        }

        return {
          passed: allPassed,
          error: allPassed ? null : 'Alguns seletores críticos não encontrados',
          details: results
        };
      }
    },

    // Teste de seletores de input
    inputSelectors: {
      name: 'Seletores de Input',
      critical: false,
      timeout: 3000,
      test: async () => {
        const inputSelectors = [
          'div[contenteditable="true"][data-tab="10"]',
          'div[contenteditable="true"][data-tab="1"]',
          'footer div[contenteditable="true"]'
        ];

        for (const selector of inputSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            return {
              passed: true,
              details: { selector, found: true }
            };
          }
        }

        // Input pode não existir se não houver chat aberto
        const hasOpenChat = document.querySelector('#main');
        return {
          passed: !hasOpenChat, // Passa se não há chat aberto
          error: hasOpenChat ? 'Input não encontrado com chat aberto' : null,
          details: { hasOpenChat, inputFound: false }
        };
      }
    },

    // Teste de mensagens
    messageSelectors: {
      name: 'Seletores de Mensagens',
      critical: false,
      timeout: 3000,
      test: async () => {
        const hasChat = document.querySelector('#main');
        if (!hasChat) {
          return { passed: true, details: { noChat: true } };
        }

        const messageSelectors = [
          'div[data-testid="msg-container"]',
          '[data-id^="true_"]',
          '[data-id^="false_"]'
        ];

        for (const selector of messageSelectors) {
          if (document.querySelector(selector)) {
            return { passed: true, details: { selector, found: true } };
          }
        }

        return {
          passed: false,
          error: 'Seletores de mensagem não encontrados',
          details: { hasChat: true }
        };
      }
    },

    // Teste de extensões Chrome
    chromeAPIs: {
      name: 'Chrome Extension APIs',
      critical: true,
      timeout: 1000,
      test: async () => {
        const apis = {
          storage: typeof chrome?.storage?.local !== 'undefined',
          runtime: typeof chrome?.runtime?.sendMessage !== 'undefined',
          tabs: typeof chrome?.tabs !== 'undefined',
          alarms: typeof chrome?.alarms !== 'undefined'
        };

        const allAvailable = Object.values(apis).every(v => v);

        return {
          passed: allAvailable,
          error: allAvailable ? null : 'Algumas Chrome APIs não disponíveis',
          details: apis
        };
      }
    },

    // Teste de módulos carregados
    coreModules: {
      name: 'Módulos Core',
      critical: false,
      timeout: 2000,
      test: async () => {
        const modules = {
          EventBus: !!window.EventBus,
          AIService: !!window.AIService,
          CopilotEngine: !!window.CopilotEngine,
          SubscriptionManager: !!window.SubscriptionManager,
          Scheduler: !!window.Scheduler || !!window.GlobalScheduler
        };

        const loadedCount = Object.values(modules).filter(v => v).length;
        const totalCount = Object.keys(modules).length;

        return {
          passed: loadedCount >= 3, // Pelo menos 3 módulos core
          error: loadedCount < 3 ? 'Poucos módulos core carregados' : null,
          details: { modules, loadedCount, totalCount }
        };
      }
    },

    // Teste de performance inicial
    performanceBaseline: {
      name: 'Performance Baseline',
      critical: false,
      timeout: 2000,
      test: async () => {
        const start = performance.now();
        
        // Simular operação típica
        for (let i = 0; i < 100; i++) {
          document.querySelectorAll('div');
        }
        
        const duration = performance.now() - start;
        const passed = duration < 100; // Deve completar em menos de 100ms

        return {
          passed,
          error: passed ? null : 'Performance abaixo do esperado',
          details: {
            duration: `${duration.toFixed(2)}ms`,
            threshold: '100ms',
            memoryUsage: performance.memory?.usedJSHeapSize 
              ? `${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`
              : 'N/A'
          }
        };
      }
    },

    // Teste de LocalStorage
    storageAvailability: {
      name: 'Storage Disponível',
      critical: true,
      timeout: 1000,
      test: async () => {
        try {
          const testKey = '__whl_storage_test__';
          await chrome.storage.local.set({ [testKey]: 'test' });
          const result = await chrome.storage.local.get(testKey);
          await chrome.storage.local.remove(testKey);

          return {
            passed: result[testKey] === 'test',
            details: { chromeStorage: true }
          };
        } catch (e) {
          return {
            passed: false,
            error: `Storage error: ${e.message}`,
            details: { chromeStorage: false }
          };
        }
      }
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // EXECUÇÃO DOS TESTES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Executa um único teste com timeout
   */
  async function runTest(testId, testConfig) {
    const startTime = performance.now();

    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Test timeout')), testConfig.timeout);
      });

      const result = await Promise.race([
        testConfig.test(),
        timeoutPromise
      ]);

      return {
        testId,
        name: testConfig.name,
        critical: testConfig.critical,
        ...result,
        duration: performance.now() - startTime,
        timestamp: Date.now()
      };
    } catch (error) {
      return {
        testId,
        name: testConfig.name,
        critical: testConfig.critical,
        passed: false,
        error: error.message,
        duration: performance.now() - startTime,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Executa todos os testes
   */
  async function runAllTests() {
    console.log('[SmokeTest] 🔬 Iniciando validação...');
    const startTime = performance.now();
    
    const results = {
      timestamp: Date.now(),
      tests: {},
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        criticalFailed: 0
      }
    };

    for (const [testId, testConfig] of Object.entries(TESTS)) {
      const result = await runTest(testId, testConfig);
      results.tests[testId] = result;
      
      results.summary.total++;
      if (result.passed) {
        results.summary.passed++;
        console.log(`[SmokeTest] ✅ ${testConfig.name}`);
      } else {
        results.summary.failed++;
        if (testConfig.critical) {
          results.summary.criticalFailed++;
        }
        console.warn(`[SmokeTest] ❌ ${testConfig.name}: ${result.error}`);
      }
    }

    results.summary.duration = performance.now() - startTime;
    results.summary.healthScore = Math.round(
      (results.summary.passed / results.summary.total) * 100
    );
    results.summary.status = getHealthStatus(results.summary);

    return results;
  }

  /**
   * Determina status de saúde
   */
  function getHealthStatus(summary) {
    if (summary.criticalFailed > 0) return 'critical';
    if (summary.healthScore >= 90) return 'healthy';
    if (summary.healthScore >= 70) return 'degraded';
    return 'unhealthy';
  }

  // ═══════════════════════════════════════════════════════════════════
  // PERSISTÊNCIA E HISTÓRICO
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Salva resultados
   */
  async function saveResults(results) {
    try {
      // Salvar último resultado
      await chrome.storage.local.set({
        [STORAGE_KEY]: JSON.stringify(results)
      });

      // Adicionar ao histórico
      const historyData = await chrome.storage.local.get(HEALTH_HISTORY_KEY);
      let history = [];
      
      try {
        history = JSON.parse(historyData[HEALTH_HISTORY_KEY] || '[]');
      } catch (e) {
        history = [];
      }

      history.push({
        timestamp: results.timestamp,
        healthScore: results.summary.healthScore,
        status: results.summary.status,
        passed: results.summary.passed,
        failed: results.summary.failed
      });

      // Limitar histórico
      if (history.length > MAX_HISTORY) {
        history = history.slice(-MAX_HISTORY);
      }

      await chrome.storage.local.set({
        [HEALTH_HISTORY_KEY]: JSON.stringify(history)
      });

    } catch (e) {
      console.warn('[SmokeTest] Erro ao salvar resultados:', e);
    }
  }

  /**
   * Carrega último resultado
   */
  async function loadLastResults() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      if (data[STORAGE_KEY]) {
        return JSON.parse(data[STORAGE_KEY]);
      }
    } catch (e) {
      console.warn('[SmokeTest] Erro ao carregar resultados:', e);
    }
    return null;
  }

  /**
   * Carrega histórico de saúde
   */
  async function loadHealthHistory() {
    try {
      const data = await chrome.storage.local.get(HEALTH_HISTORY_KEY);
      if (data[HEALTH_HISTORY_KEY]) {
        return JSON.parse(data[HEALTH_HISTORY_KEY]);
      }
    } catch (e) {
      console.warn('[SmokeTest] Erro ao carregar histórico:', e);
    }
    return [];
  }

  // ═══════════════════════════════════════════════════════════════════
  // UI DE RELATÓRIO
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Gera relatório visual
   */
  function generateReport(results) {
    const statusColors = {
      healthy: '#22c55e',
      degraded: '#f59e0b',
      unhealthy: '#ef4444',
      critical: '#dc2626'
    };

    const statusEmoji = {
      healthy: '✅',
      degraded: '⚠️',
      unhealthy: '❌',
      critical: '🚨'
    };

    let report = `
╔════════════════════════════════════════════════════════════════╗
║                    🔬 SMOKE TEST REPORT                        ║
╠════════════════════════════════════════════════════════════════╣
║  Status: ${statusEmoji[results.summary.status]} ${results.summary.status.toUpperCase().padEnd(10)} Health Score: ${results.summary.healthScore}%
║  Tests: ${results.summary.passed}/${results.summary.total} passed    Duration: ${results.summary.duration.toFixed(0)}ms
╠════════════════════════════════════════════════════════════════╣
`;

    for (const [testId, test] of Object.entries(results.tests)) {
      const icon = test.passed ? '✓' : '✗';
      const status = test.passed ? 'PASS' : 'FAIL';
      const critical = test.critical ? '🔴' : '⚪';
      
      report += `║  ${critical} ${icon} ${test.name.padEnd(30)} [${status}]\n`;
      
      if (!test.passed && test.error) {
        report += `║     └─ ${test.error.substring(0, 50)}\n`;
      }
    }

    report += `╚════════════════════════════════════════════════════════════════╝`;

    return report;
  }

  /**
   * Mostra relatório no console com cores
   */
  function printReport(results) {
    const statusColors = {
      healthy: 'color: #22c55e',
      degraded: 'color: #f59e0b',
      unhealthy: 'color: #ef4444',
      critical: 'color: #dc2626; font-weight: bold'
    };

    console.log('%c' + generateReport(results), statusColors[results.summary.status]);
  }

  // ═══════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════

  let lastResults = null;

  async function init() {
    console.log('[SmokeTest] 🚀 Iniciando smoke test...');
    
    // Aguardar um pouco para WhatsApp carregar
    await new Promise(r => setTimeout(r, 3000));
    
    // Executar testes
    lastResults = await runAllTests();
    
    // Salvar resultados
    await saveResults(lastResults);
    
    // Imprimir relatório
    printReport(lastResults);

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('smoketest:completed', lastResults);
    }

    // Se crítico, notificar
    if (lastResults.summary.status === 'critical') {
      console.error('[SmokeTest] 🚨 FALHAS CRÍTICAS DETECTADAS - Algumas funcionalidades podem não funcionar');
      
      if (window.GracefulDegradation) {
        window.GracefulDegradation.showDegradationBanner(
          'Problemas detectados na inicialização. Algumas funcionalidades podem estar limitadas.'
        );
      }
    }

    return lastResults;
  }

  // ═══════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════

  const SmokeTest = {
    // Execução
    init,
    runAllTests,
    runTest: (testId) => runTest(testId, TESTS[testId]),
    
    // Resultados
    getLastResults: () => lastResults,
    loadLastResults,
    loadHealthHistory,
    
    // Relatórios
    generateReport,
    printReport: () => lastResults && printReport(lastResults),
    
    // Status rápido
    isHealthy: () => lastResults?.summary?.status === 'healthy',
    getHealthScore: () => lastResults?.summary?.healthScore || 0,
    getStatus: () => lastResults?.summary?.status || 'unknown',
    
    // Configuração
    TESTS,
    
    // Re-executar
    rerun: async () => {
      lastResults = await runAllTests();
      await saveResults(lastResults);
      printReport(lastResults);
      return lastResults;
    }
  };

  window.SmokeTest = SmokeTest;

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }

  console.log('[SmokeTest] 🔬 Módulo carregado');

})();
