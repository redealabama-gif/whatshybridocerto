/**
 * 🔍 Integrity Check - Verificação de Integridade do Sistema
 * WhatsHybrid v7.9.12
 * 
 * Script de diagnóstico para verificar a saúde e integridade
 * dos módulos core e dados da extensão.
 * 
 * Uso no console: await WHLIntegrityCheck.run()
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const CHECKS = {
    // Verificações de storage
    storage: {
      name: 'Chrome Storage Access',
      critical: true,
      async check() {
        try {
          const testKey = '_whl_integrity_test';
          await chrome.storage.local.set({ [testKey]: Date.now() });
          const result = await chrome.storage.local.get(testKey);
          await chrome.storage.local.remove(testKey);
          return { 
            passed: !!result[testKey], 
            message: result[testKey] ? 'Storage acessível' : 'Falha ao acessar storage' 
          };
        } catch (error) {
          return { passed: false, message: `Erro: ${error.message}` };
        }
      }
    },

    // Verificação de módulos críticos
    eventBus: {
      name: 'EventBus Central',
      critical: true,
      check() {
        const available = !!(window.EventBus && typeof window.EventBus.emit === 'function');
        const stats = window.EventBus?.getStats?.() || {};
        return { 
          passed: available, 
          message: available ? `OK - ${stats.totalListeners || 0} listeners` : 'EventBus não disponível',
          data: stats
        };
      }
    },

    memorySystem: {
      name: 'Memory System',
      critical: true,
      async check() {
        const ms = window.memorySystem;
        if (!ms) return { passed: false, message: 'MemorySystem não disponível' };
        
        const initialized = ms.initialized;
        const stats = ms.getStats?.() || {};
        
        return { 
          passed: initialized, 
          message: initialized ? `OK - ${stats.totalMemories || 0} memórias` : 'Não inicializado',
          data: stats
        };
      }
    },

    confidenceSystem: {
      name: 'Confidence System',
      critical: false,
      check() {
        const cs = window.confidenceSystem;
        if (!cs) return { passed: false, message: 'ConfidenceSystem não disponível' };
        
        const score = cs.score || cs.getScore?.() || 0;
        const level = cs.level || 'unknown';
        
        return { 
          passed: true, 
          message: `Score: ${score}% | Level: ${level}`,
          data: { score, level }
        };
      }
    },

    knowledgeBase: {
      name: 'Knowledge Base',
      critical: false,
      check() {
        const kb = window.knowledgeBase;
        if (!kb) return { passed: false, message: 'KnowledgeBase não disponível' };
        
        const faqs = kb.faqs?.length || 0;
        const products = kb.products?.length || 0;
        
        return { 
          passed: true, 
          message: `FAQs: ${faqs} | Produtos: ${products}`,
          data: { faqs, products }
        };
      }
    },

    fewShotLearning: {
      name: 'Few-Shot Learning',
      critical: false,
      check() {
        const fsl = window.fewShotLearning;
        if (!fsl) return { passed: false, message: 'FewShotLearning não disponível' };
        
        const examples = fsl.getAll?.()?.length || fsl.examples?.length || 0;
        
        return { 
          passed: true, 
          message: `Exemplos: ${examples}`,
          data: { examples }
        };
      }
    },

    whatsappStore: {
      name: 'WhatsApp Store',
      critical: true,
      check() {
        const available = !!(
          window.Store && 
          window.Store.Chat && 
          typeof window.Store.Chat.find === 'function'
        );
        
        const whlStore = window.WHLStore?.isAvailable?.() || false;
        
        return { 
          passed: available, 
          message: available ? 'Store disponível' : 'Store não disponível (aguarde WhatsApp carregar)',
          data: { native: available, wrapper: whlStore }
        };
      }
    },

    backendClient: {
      name: 'Backend Client',
      critical: false,
      async check() {
        const bc = window.BackendClient;
        if (!bc) return { passed: false, message: 'BackendClient não disponível' };
        
        const connected = bc.isConnected?.() || false;
        
        return { 
          passed: connected, 
          message: connected ? 'Conectado ao backend' : 'Backend não conectado',
          data: { connected }
        };
      }
    },

    aiService: {
      name: 'AI Service',
      critical: false,
      check() {
        const ai = window.AIService;
        if (!ai) return { passed: false, message: 'AIService não disponível' };
        
        const providers = ai.getConfiguredProviders?.()?.length || 0;
        
        return { 
          passed: providers > 0, 
          message: providers > 0 ? `${providers} provider(s) configurado(s)` : 'Nenhum provider configurado',
          data: { providers }
        };
      }
    },

    autopilot: {
      name: 'Autopilot V2',
      critical: false,
      check() {
        const ap = window.AutopilotV2 || window.Autopilot;
        if (!ap) return { passed: false, message: 'Autopilot não disponível' };
        
        const stats = ap.getStats?.() || {};
        const running = ap.isRunning?.() || false;
        
        return { 
          passed: true, 
          message: running ? 'Autopilot ativo' : 'Autopilot parado',
          data: stats
        };
      }
    },

    // Verificação de schema de dados
    dataSchema: {
      name: 'Data Schema Validation',
      critical: false,
      async check() {
        const errors = [];
        
        // Verificar memórias
        try {
          const data = await chrome.storage.local.get('whl_memory_system');
          if (data.whl_memory_system) {
            const parsed = JSON.parse(data.whl_memory_system);
            if (typeof parsed !== 'object') {
              errors.push('memory_system: formato inválido');
            }
          }
        } catch (e) {
          errors.push(`memory_system: ${e.message}`);
        }

        // Verificar confidence
        try {
          const data = await chrome.storage.local.get('whl_confidence_system');
          if (data.whl_confidence_system) {
            const parsed = typeof data.whl_confidence_system === 'string' 
              ? JSON.parse(data.whl_confidence_system) 
              : data.whl_confidence_system;
            if (typeof parsed.score !== 'number') {
              errors.push('confidence_system: score inválido');
            }
          }
        } catch (e) {
          errors.push(`confidence_system: ${e.message}`);
        }

        return { 
          passed: errors.length === 0, 
          message: errors.length === 0 ? 'Schemas válidos' : `${errors.length} erro(s)`,
          data: { errors }
        };
      }
    },

    // Verificação de sync queue
    syncQueue: {
      name: 'Sync Queue Status',
      critical: false,
      async check() {
        try {
          const data = await chrome.storage.local.get('whl_memory_sync_queue');
          const queue = data.whl_memory_sync_queue || [];
          const pending = Array.isArray(queue) ? queue.length : 0;
          
          return { 
            passed: true, 
            message: `${pending} item(s) pendente(s)`,
            data: { pending }
          };
        } catch (e) {
          return { passed: false, message: e.message };
        }
      }
    }
  };

  /**
   * Executa todas as verificações
   * @returns {Object} - Resultado completo
   */
  async function runIntegrityCheck() {
    console.log('\n╔═══════════════════════════════════════════════════════════╗');
    console.log('║         🔍 WhatsHybrid Integrity Check v1.0.0              ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

    const results = {
      timestamp: new Date().toISOString(),
      version: window.WHLVersion?.get?.() || 'unknown',
      checks: {},
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        critical: 0,
        warnings: 0
      }
    };

    for (const [key, check] of Object.entries(CHECKS)) {
      results.summary.total++;
      
      try {
        const result = await check.check();
        results.checks[key] = {
          name: check.name,
          critical: check.critical,
          ...result
        };

        const icon = result.passed ? '✅' : (check.critical ? '❌' : '⚠️');
        console.log(`${icon} ${check.name}: ${result.message}`);

        if (result.passed) {
          results.summary.passed++;
        } else if (check.critical) {
          results.summary.failed++;
          results.summary.critical++;
        } else {
          results.summary.warnings++;
        }

      } catch (error) {
        results.checks[key] = {
          name: check.name,
          critical: check.critical,
          passed: false,
          message: `Erro: ${error.message}`
        };
        console.log(`❌ ${check.name}: Erro - ${error.message}`);
        results.summary.failed++;
        if (check.critical) results.summary.critical++;
      }
    }

    // Resumo
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log(`📊 RESUMO: ${results.summary.passed}/${results.summary.total} verificações passaram`);
    
    if (results.summary.critical > 0) {
      console.log(`❌ ${results.summary.critical} falha(s) CRÍTICA(S) detectada(s)!`);
    }
    if (results.summary.warnings > 0) {
      console.log(`⚠️ ${results.summary.warnings} aviso(s)`);
    }
    
    const healthScore = Math.round((results.summary.passed / results.summary.total) * 100);
    console.log(`\n🏥 Health Score: ${healthScore}%`);
    console.log('═══════════════════════════════════════════════════════════\n');

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('integrity:check:complete', results);
    }

    return results;
  }

  /**
   * Executa verificação rápida (apenas críticos)
   */
  async function quickCheck() {
    const criticalChecks = Object.entries(CHECKS)
      .filter(([, check]) => check.critical);
    
    let allPassed = true;
    
    for (const [key, check] of criticalChecks) {
      try {
        const result = await check.check();
        if (!result.passed) {
          allPassed = false;
          console.error(`[IntegrityCheck] CRITICAL: ${check.name} - ${result.message}`);
        }
      } catch (error) {
        allPassed = false;
        console.error(`[IntegrityCheck] CRITICAL: ${check.name} - ${error.message}`);
      }
    }
    
    return allPassed;
  }

  // Exportar globalmente
  window.WHLIntegrityCheck = {
    run: runIntegrityCheck,
    quickCheck,
    CHECKS
  };

  console.log('[IntegrityCheck] ✅ Script carregado. Use WHLIntegrityCheck.run() para verificar.');
})();
