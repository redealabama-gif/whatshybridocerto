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
    // Bridge to the page-world WhatsApp internals.
    //
    // In WA 2.3000.x window.Store is gone; the canonical source of truth
    // is the WHL page bridge (injected/wa-page-bridge.js), which mirrors
    // WAWebChatCollection / ContactCollection / etc into the isolated
    // world. We poll WHL_WaBridge.healthCheck() instead of poking
    // window.Store.* directly.
    whatsappStore: {
      name: 'WhatsApp Store API',
      critical: true,
      timeout: 12000,
      test: async () => {
        const maxWait = 10000;
        const startTime = Date.now();
        let lastHealth = null;

        while (Date.now() - startTime < maxWait) {
          const health = window.WHL_WaBridge?.healthCheck?.();
          if (health && health.ok && (health.modulesLoaded || []).length > 0) {
            const loaded = new Set(health.modulesLoaded);
            return {
              passed: true,
              details: {
                via: 'WHL_WaBridge',
                version: health.version,
                hasChat: loaded.has('Chat'),
                hasMsg: loaded.has('Msg'),
                hasContact: loaded.has('Contact'),
                hasBlocklist: loaded.has('Blocklist'),
                loaded: health.modulesLoaded,
                missing: health.missing,
              }
            };
          }
          lastHealth = health;
          // Legacy fallback: builds anteriores ao 2.3000.x ainda expunham
          // window.Store. Não emitimos warning aqui pra não confundir.
          if (window.Store?.Chat && window.Store?.Msg) {
            return {
              passed: true,
              details: {
                via: 'window.Store(legacy)',
                hasChat: !!window.Store.Chat,
                hasMsg: !!window.Store.Msg,
                hasContact: !!window.Store.Contact,
                hasConn: !!window.Store.Conn,
              }
            };
          }
          await new Promise(r => setTimeout(r, 500));
        }

        return {
          passed: false,
          error: 'Page bridge não respondeu STORE_READY após ' + maxWait + 'ms',
          details: { lastHealth, timeout: maxWait },
        };
      }
    },

    // Conexão com WhatsApp — checa se o usuário fez QR-login.
    // Em WA 2.3000.x não temos window.Store.Conn. Heurística:
    //   bridge pronto + pane-side renderizado = sessão registrada.
    whatsappConnection: {
      name: 'Conexão WhatsApp',
      critical: true,
      timeout: 3000,
      test: async () => {
        try {
          const bridgeReady = !!window.WHL_WaBridge?.healthCheck?.()?.ok;
          // #pane-side existe nas duas eras (2.2000.x e 2.3000.x) e só
          // aparece após o login.
          const paneSide = document.querySelector('#pane-side');
          const legacyConn = window.Store?.Conn?.isRegistered?.();
          const isConnected = (bridgeReady && !!paneSide) || legacyConn === true;
          return {
            passed: isConnected,
            error: isConnected ? null : 'WhatsApp não está conectado',
            details: { bridgeReady, hasPaneSide: !!paneSide, legacyConn: !!legacyConn }
          };
        } catch (e) {
          return { passed: false, error: e.message };
        }
      }
    },

    // Seletores críticos — prefere os duráveis (IDs antigos do WA que
    // sobrevivem updates) e mantém os data-testid como tentativa
    // secundária. Em WA 2.3000.x a maioria dos data-testid morreu.
    criticalSelectors: {
      name: 'Seletores Críticos',
      critical: true,
      timeout: 3000,
      test: async () => {
        const selectors = {
          chatList: [
            '#pane-side',
            '[aria-label="Lista de conversas"]',
            '[aria-label="Chat list"]',
            '[data-testid="chat-list"]',
          ],
          mainPanel: [
            '#main',
            '[data-testid="conversation-panel-wrapper"]',
          ],
          header: [
            '#app header',
            'header._amid',
            'header[data-testid="chatlist-header"]',
          ],
        };

        const results = {};
        let allPassed = true;

        for (const [name, variants] of Object.entries(selectors)) {
          let found = false;
          for (const selector of variants) {
            try {
              if (document.querySelector(selector)) {
                found = true;
                results[name] = { found: true, selector };
                break;
              }
            } catch (_) {}
          }
          if (!found) {
            results[name] = { found: false, tried: variants };
            // mainPanel só existe quando um chat está aberto — não falha o teste.
            if (name !== 'mainPanel') allPassed = false;
          }
        }

        return {
          passed: allPassed,
          error: allPassed ? null : 'Alguns seletores críticos não encontrados',
          details: results
        };
      }
    },

    // Seletor de input do compositor.
    // WA 2.3000.x: o composer é um lexical-editor:
    //   footer div[contenteditable="true"][role="textbox"]
    //   div[contenteditable="true"][data-lexical-editor="true"]
    // Os data-tab="10/1" são da era 2.2000.x — mantidos como fallback.
    inputSelectors: {
      name: 'Seletores de Input',
      critical: false,
      timeout: 3000,
      test: async () => {
        const inputSelectors = [
          'footer div[contenteditable="true"][role="textbox"]',
          'footer div[contenteditable="true"][data-lexical-editor="true"]',
          '[data-lexical-editor="true"][contenteditable="true"]',
          '#main footer div[contenteditable="true"]',
          'footer div[contenteditable="true"]',
          // legacy:
          'div[contenteditable="true"][data-tab="10"]',
          'div[contenteditable="true"][data-tab="1"]',
          '[data-testid="conversation-compose-box-input"]',
        ];

        for (const selector of inputSelectors) {
          try {
            const el = document.querySelector(selector);
            if (el && (el.offsetWidth || el.offsetHeight)) {
              return { passed: true, details: { selector, found: true } };
            }
          } catch (_) {}
        }

        // Input só existe quando há chat aberto.
        const hasOpenChat = !!document.querySelector('#main');
        return {
          passed: !hasOpenChat,
          error: hasOpenChat ? 'Input não encontrado com chat aberto' : null,
          details: { hasOpenChat, inputFound: false, tried: inputSelectors.length }
        };
      }
    },

    // Container de mensagens dentro do chat aberto.
    messageSelectors: {
      name: 'Seletores de Mensagens',
      critical: false,
      timeout: 3000,
      test: async () => {
        const hasChat = !!document.querySelector('#main');
        if (!hasChat) return { passed: true, details: { noChat: true } };

        const messageSelectors = [
          // WA 2.3000.x usa classes ofuscadas mas mantém data-id no DOM.
          '#main [data-id]',
          '#main [role="row"]',
          'div.copyable-text',
          '[data-id^="true_"]',
          '[data-id^="false_"]',
          // legacy:
          'div[data-testid="msg-container"]',
        ];

        for (const selector of messageSelectors) {
          try {
            if (document.querySelector(selector)) {
              return { passed: true, details: { selector, found: true } };
            }
          } catch (_) {}
        }

        return {
          passed: false,
          error: 'Seletores de mensagem não encontrados',
          details: { hasChat: true, tried: messageSelectors }
        };
      }
    },

    // Chrome APIs disponíveis no isolated world do content script.
    //
    // Importante: chrome.tabs e chrome.alarms NÃO existem em content
    // scripts (são background-only). Esse era o motivo do teste falhar
    // direto sempre. Aqui só validamos o que o content script realmente
    // tem acesso: chrome.storage.local + chrome.runtime.sendMessage.
    chromeAPIs: {
      name: 'Chrome Extension APIs',
      critical: true,
      timeout: 1000,
      test: async () => {
        const apis = {
          storage: typeof chrome?.storage?.local !== 'undefined',
          runtime_sendMessage: typeof chrome?.runtime?.sendMessage === 'function',
          runtime_getURL: typeof chrome?.runtime?.getURL === 'function',
          extensionId: !!chrome?.runtime?.id,
        };
        const allAvailable = Object.values(apis).every(Boolean);
        return {
          passed: allAvailable,
          error: allAvailable ? null : 'Algumas Chrome APIs essenciais ausentes',
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
