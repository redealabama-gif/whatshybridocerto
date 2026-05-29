/**
 * 🛡️ Graceful Degradation System
 * Sistema de Modo Degradado Perfeito
 * 
 * Quando um seletor/funcionalidade quebra:
 * 1. Módulo se desativa automaticamente
 * 2. UI mostra mensagem clara ao usuário
 * 3. Sem botões mortos ou comportamento errático
 * 4. Logs para diagnóstico
 * 
 * @version 1.0.0
 */
(function() {
  'use strict';

  let degradationInterval = null;

  const STORAGE_KEY = 'whl_degradation_state';

  // ═══════════════════════════════════════════════════════════════════
  // CONFIGURAÇÃO DE MÓDULOS E DEPENDÊNCIAS
  // ═══════════════════════════════════════════════════════════════════

  const MODULE_CONFIG = {
    // Módulo: { selectors: [...], dependencies: [...], critical: bool }
    'copilot': {
      name: 'Copiloto IA',
      selectors: ['CHAT_INPUT', 'MESSAGE_LIST', 'SEND_BUTTON'],
      dependencies: ['AIService', 'CopilotEngine'],
      critical: false,
      fallbackMessage: 'Copiloto indisponível - WhatsApp pode ter atualizado'
    },
    'recover': {
      name: 'Recuperar Mensagens',
      selectors: ['MESSAGE_LIST', 'MSG_CONTAINER'],
      dependencies: ['RecoverAdvanced'],
      critical: false,
      fallbackMessage: 'Recuperação indisponível - aguarde atualização'
    },
    'crm': {
      name: 'CRM',
      selectors: ['CONTACT_INFO', 'CHAT_HEADER'],
      dependencies: ['CRM'],
      critical: false,
      fallbackMessage: 'CRM indisponível temporariamente'
    },
    'campaigns': {
      name: 'Campanhas',
      selectors: ['CHAT_INPUT', 'SEND_BUTTON'],
      dependencies: ['CampaignManager'],
      critical: false,
      fallbackMessage: 'Campanhas indisponíveis - verifique seletores'
    },
    'labels': {
      name: 'Etiquetas',
      selectors: ['CHAT_LIST_ITEM', 'CONTACT_INFO'],
      dependencies: ['Labels'],
      critical: false,
      fallbackMessage: 'Etiquetas indisponíveis'
    },
    'backup': {
      name: 'Backup',
      selectors: ['MESSAGE_LIST', 'MSG_CONTAINER'],
      dependencies: [],
      critical: false,
      fallbackMessage: 'Backup indisponível'
    },
    'team': {
      name: 'Equipe',
      selectors: ['CHAT_INPUT'],
      dependencies: ['teamSystem'],
      critical: false,
      fallbackMessage: 'Sistema de equipe indisponível'
    },
    'quickReplies': {
      name: 'Resposta Rápida',
      selectors: ['CHAT_INPUT'],
      dependencies: ['quickReplies'],
      critical: false,
      fallbackMessage: 'Resposta Rápida indisponível'
    },
    'analytics': {
      name: 'Analytics',
      selectors: [],
      dependencies: ['Analytics'],
      critical: false,
      fallbackMessage: 'Analytics indisponível'
    },
    'tasks': {
      name: 'Tarefas',
      selectors: [],
      dependencies: ['Tasks'],
      critical: false,
      fallbackMessage: 'Tarefas indisponíveis'
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // ESTADO
  // ═══════════════════════════════════════════════════════════════════

  const state = {
    initialized: false,
    modules: {}, // { moduleId: { status: 'active'|'degraded'|'disabled', reason: '', lastCheck: timestamp } }
    selectors: {}, // { selectorKey: { working: bool, lastCheck: timestamp, error: '' } }
    overallHealth: 'healthy', // healthy, degraded, critical
    lastHealthCheck: null
  };

  // ═══════════════════════════════════════════════════════════════════
  // MAPEAMENTO DE SELETORES
  // ═══════════════════════════════════════════════════════════════════

  const SELECTORS = {
    CHAT_INPUT: [
      'div[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][data-tab="1"]',
      'footer div[contenteditable="true"]',
      '#main footer div[contenteditable]'
    ],
    MESSAGE_LIST: [
      'div[data-testid="conversation-panel-messages"]',
      '#main div[role="application"]',
      '#main .message-list'
    ],
    MSG_CONTAINER: [
      'div[data-testid="msg-container"]',
      'div.message-in, div.message-out',
      '[data-id^="true_"], [data-id^="false_"]'
    ],
    SEND_BUTTON: [
      'button[data-testid="send"]',
      'span[data-testid="send"]',
      'button[aria-label*="Enviar"]'
    ],
    CHAT_HEADER: [
      '#main header',
      'div[data-testid="conversation-header"]'
    ],
    CHAT_LIST_ITEM: [
      'div[data-testid="cell-frame-container"]',
      'div[data-testid="chat-list"] > div'
    ],
    CONTACT_INFO: [
      'span[data-testid="conversation-info-header-chat-title"]',
      '#main header span[title]'
    ]
  };

  // ═══════════════════════════════════════════════════════════════════
  // VERIFICAÇÃO DE SELETORES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Testa se um seletor funciona
   */
  function testSelector(selectorKey) {
    const variants = SELECTORS[selectorKey];
    if (!variants) return { working: false, error: 'Seletor não definido' };

    for (const selector of variants) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return { working: true, selector, element };
        }
      } catch (e) {
        // Seletor inválido, tentar próximo
      }
    }

    return { working: false, error: `Nenhuma variante de ${selectorKey} encontrada` };
  }

  /**
   * Verifica todos os seletores
   */
  function checkAllSelectors() {
    const results = {};
    
    for (const key of Object.keys(SELECTORS)) {
      const result = testSelector(key);
      results[key] = {
        working: result.working,
        lastCheck: Date.now(),
        error: result.error || '',
        selector: result.selector || ''
      };
      
      state.selectors[key] = results[key];
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════════
  // VERIFICAÇÃO DE DEPENDÊNCIAS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Verifica se uma dependência está disponível
   */
  function checkDependency(depName) {
    try {
      const dep = window[depName];
      if (!dep) return { available: false, reason: `${depName} não carregado` };
      
      // Verifica se tem método init ou está funcional
      if (typeof dep === 'object' || typeof dep === 'function') {
        return { available: true };
      }
      
      return { available: false, reason: `${depName} tipo inválido` };
    } catch (e) {
      return { available: false, reason: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // VERIFICAÇÃO DE MÓDULOS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Verifica status de um módulo
   */
  function checkModule(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    if (!config) return { status: 'unknown', reason: 'Módulo não configurado' };

    const issues = [];

    // Verificar seletores
    for (const selectorKey of config.selectors) {
      const result = testSelector(selectorKey);
      if (!result.working) {
        issues.push(`Seletor ${selectorKey} não encontrado`);
      }
    }

    // Verificar dependências
    for (const depName of config.dependencies) {
      const result = checkDependency(depName);
      if (!result.available) {
        issues.push(result.reason);
      }
    }

    if (issues.length === 0) {
      return { status: 'active', reason: '' };
    } else if (issues.length < (config.selectors.length + config.dependencies.length)) {
      return { status: 'degraded', reason: issues.join('; ') };
    } else {
      return { status: 'disabled', reason: issues.join('; ') };
    }
  }

  /**
   * Verifica todos os módulos
   */
  function checkAllModules() {
    const results = {};
    let degradedCount = 0;
    let disabledCount = 0;

    for (const moduleId of Object.keys(MODULE_CONFIG)) {
      const result = checkModule(moduleId);
      results[moduleId] = {
        ...result,
        lastCheck: Date.now(),
        config: MODULE_CONFIG[moduleId]
      };
      
      state.modules[moduleId] = results[moduleId];

      if (result.status === 'degraded') degradedCount++;
      if (result.status === 'disabled') disabledCount++;
    }

    // Atualizar saúde geral
    if (disabledCount > Object.keys(MODULE_CONFIG).length / 2) {
      state.overallHealth = 'critical';
    } else if (degradedCount > 0 || disabledCount > 0) {
      state.overallHealth = 'degraded';
    } else {
      state.overallHealth = 'healthy';
    }

    state.lastHealthCheck = Date.now();

    return results;
  }

  // ═══════════════════════════════════════════════════════════════════
  // UI DE DEGRADAÇÃO
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Desabilita um elemento UI com mensagem
   */
  function disableUIElement(element, message) {
    if (!element) return;

    element.classList.add('whl-degraded');
    element.setAttribute('data-degraded', 'true');
    element.setAttribute('data-degraded-message', message);
    element.style.opacity = '0.5';
    element.style.pointerEvents = 'none';
    element.title = message;
  }

  /**
   * Reabilita um elemento UI
   */
  function enableUIElement(element) {
    if (!element) return;

    element.classList.remove('whl-degraded');
    element.removeAttribute('data-degraded');
    element.removeAttribute('data-degraded-message');
    element.style.opacity = '';
    element.style.pointerEvents = '';
    element.title = '';
  }

  /**
   * Mostra banner de degradação
   */
  function showDegradationBanner(message) {
    let banner = document.getElementById('whl-degradation-banner');
    
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'whl-degradation-banner';
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(90deg, #ff6b35, #f7931e);
        color: white;
        padding: 8px 16px;
        text-align: center;
        font-size: 13px;
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      `;
      document.body.prepend(banner);
    }

    banner.innerHTML = `
      <span>⚠️</span>
      <span>${message}</span>
      <button onclick="this.parentElement.remove()" style="
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        padding: 4px 12px;
        border-radius: 4px;
        cursor: pointer;
        margin-left: 10px;
      ">Entendi</button>
    `;
  }

  /**
   * Remove banner de degradação
   */
  function hideDegradationBanner() {
    const banner = document.getElementById('whl-degradation-banner');
    if (banner) banner.remove();
  }

  /**
   * Atualiza UI baseado no status dos módulos
   */
  function updateUIState() {
    // Injetar CSS se necessário
    if (!document.getElementById('whl-degradation-styles')) {
      const style = document.createElement('style');
      style.id = 'whl-degradation-styles';
      style.textContent = `
        .whl-degraded {
          position: relative !important;
        }
        .whl-degraded::after {
          content: attr(data-degraded-message);
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          background: #333;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          white-space: nowrap;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s;
          z-index: 9999;
        }
        .whl-degraded:hover::after {
          opacity: 1;
        }
        .whl-module-status {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 11px;
        }
        .whl-module-status.active { background: #22c55e20; color: #22c55e; }
        .whl-module-status.degraded { background: #f59e0b20; color: #f59e0b; }
        .whl-module-status.disabled { background: #ef444420; color: #ef4444; }
      `;
      document.head.appendChild(style);
    }

    // Verificar se precisa mostrar banner
    const disabledModules = Object.entries(state.modules)
      .filter(([_, m]) => m.status === 'disabled')
      .map(([id, m]) => m.config.name);

    if (disabledModules.length > 0) {
      showDegradationBanner(
        `Alguns recursos estão temporariamente indisponíveis: ${disabledModules.join(', ')}. O WhatsApp pode ter atualizado.`
      );
    } else {
      hideDegradationBanner();
    }

    // Emitir evento
    if (window.EventBus) {
      window.EventBus.emit('degradation:status_updated', {
        modules: state.modules,
        overallHealth: state.overallHealth
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // GUARD FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Verifica se módulo pode executar ação
   * @param {string} moduleId - ID do módulo
   * @param {boolean} showMessage - Se deve mostrar mensagem ao usuário
   * @returns {boolean} - Se pode executar
   */
  function canExecute(moduleId, showMessage = true) {
    const moduleState = state.modules[moduleId];
    
    if (!moduleState) {
      // Módulo não verificado, fazer check
      const result = checkModule(moduleId);
      state.modules[moduleId] = { ...result, lastCheck: Date.now() };
    }

    const status = state.modules[moduleId]?.status;

    if (status === 'active') {
      return true;
    }

    if (status === 'degraded') {
      // Permite mas com aviso
      console.warn(`[GracefulDegradation] Módulo ${moduleId} em modo degradado`);
      return true;
    }

    if (status === 'disabled' && showMessage) {
      const config = MODULE_CONFIG[moduleId];
      if (config?.fallbackMessage) {
        showNotification(config.fallbackMessage, 'warning');
      }
    }

    return status !== 'disabled';
  }

  /**
   * Wrapper para funções com degradação
   */
  function withGracefulDegradation(moduleId, fn, fallbackValue = null) {
    return async function(...args) {
      if (!canExecute(moduleId)) {
        console.log(`[GracefulDegradation] ${moduleId} desabilitado, retornando fallback`);
        return fallbackValue;
      }

      try {
        return await fn.apply(this, args);
      } catch (error) {
        console.error(`[GracefulDegradation] Erro em ${moduleId}:`, error);
        
        // Recheck módulo
        const result = checkModule(moduleId);
        state.modules[moduleId] = { ...result, lastCheck: Date.now() };
        
        if (result.status === 'disabled') {
          updateUIState();
        }
        
        return fallbackValue;
      }
    };
  }

  /**
   * Mostra notificação para o usuário
   */
  function showNotification(message, type = 'info') {
    if (window.NotificationsModule?.show) {
      window.NotificationsModule.show(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // PERSISTÊNCIA
  // ═══════════════════════════════════════════════════════════════════

  async function saveState() {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY]: JSON.stringify({
          modules: state.modules,
          selectors: state.selectors,
          overallHealth: state.overallHealth,
          lastHealthCheck: state.lastHealthCheck
        })
      });
    } catch (e) {
      console.warn('[GracefulDegradation] Erro ao salvar estado:', e);
    }
  }

  async function loadState() {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      if (data[STORAGE_KEY]) {
        const saved = JSON.parse(data[STORAGE_KEY]);
        // Não restaurar estado antigo (mais de 5 minutos)
        if (Date.now() - saved.lastHealthCheck < 300000) {
          Object.assign(state, saved);
        }
      }
    } catch (e) {
      console.warn('[GracefulDegradation] Erro ao carregar estado:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // INICIALIZAÇÃO
  // ═══════════════════════════════════════════════════════════════════

  async function init() {
    if (state.initialized) return;
    
    console.log('[GracefulDegradation] Inicializando sistema de degradação...');

    await loadState();

    // Verificação inicial
    checkAllSelectors();
    checkAllModules();
    updateUIState();
    await saveState();

    // Verificação periódica (a cada 2 minutos)
    if (degradationInterval) clearInterval(degradationInterval);
    degradationInterval = setInterval(async () => {
      checkAllSelectors();
      checkAllModules();
      updateUIState();
      await saveState();
    }, 120000);

    state.initialized = true;
    console.log('[GracefulDegradation] ✅ Sistema inicializado');
    console.log(`[GracefulDegradation] Saúde geral: ${state.overallHealth}`);

    // Registrar no EventBus
    if (window.EventBus) {
      window.EventBus.emit('module:ready', { module: 'GracefulDegradation' });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════

  const GracefulDegradation = {
    init,
    
    // Verificações
    checkModule,
    checkAllModules,
    checkAllSelectors,
    testSelector,
    checkDependency,
    
    // Guards
    canExecute,
    withGracefulDegradation,
    
    // UI
    disableUIElement,
    enableUIElement,
    showDegradationBanner,
    hideDegradationBanner,
    updateUIState,
    
    // Status
    getModuleStatus: (moduleId) => state.modules[moduleId],
    getAllModulesStatus: () => ({ ...state.modules }),
    getSelectorStatus: (key) => state.selectors[key],
    getAllSelectorsStatus: () => ({ ...state.selectors }),
    getOverallHealth: () => state.overallHealth,
    getLastHealthCheck: () => state.lastHealthCheck,
    
    // Configuração
    MODULE_CONFIG,
    SELECTORS,
    
    // Forçar recheck
    forceRecheck: async () => {
      checkAllSelectors();
      checkAllModules();
      updateUIState();
      await saveState();
      return state;
    }
  };

  window.addEventListener('beforeunload', () => {
    if (degradationInterval) {
      clearInterval(degradationInterval);
      degradationInterval = null;
    }
  });

  window.GracefulDegradation = GracefulDegradation;

  // Auto-init após DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
  } else {
    setTimeout(init, 2000);
  }

  console.log('[GracefulDegradation] 🛡️ Módulo carregado');

})();
