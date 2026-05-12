/**
 * WhatsHybrid Lite - Compatibility Manager
 * 
 * Gerencia compatibilidade entre versões do WhatsApp Web.
 * Detecta mudanças de UI e adapta seletores automaticamente.
 * 
 * @version 1.0.0
 * @depends version-detector.js
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURAÇÕES
  // ============================================

  const CONFIG = {
    AUTO_REPAIR: true,           // Tentar reparar seletores automaticamente
    NOTIFY_BREAKS: false,        // Desabilitado - muito ruído
    FALLBACK_ENABLED: true,      // Habilitar seletores de fallback
    HEALTH_CHECK_INTERVAL: 120000, // 2 minutos (era 30 segundos)
    REPAIR_COOLDOWN: 300000,     // 5 minutos entre tentativas (era 1 minuto)
    MAX_REPAIR_ATTEMPTS: 2,      // Máximo de tentativas (era 3)
    SILENT_MODE: true            // Modo silencioso - menos logs
  };

  // ============================================
  // ESTADO
  // ============================================

  const state = {
    initialized: false,
    healthCheckInterval: null,
    lastRepairAttempt: null,
    repairAttempts: 0,
    brokenSelectors: new Set(),
    repairedSelectors: new Map(),
    stats: {
      totalChecks: 0,
      breaksDetected: 0,
      successfulRepairs: 0,
      failedRepairs: 0
    }
  };

  // ============================================
  // SELETORES DE EMERGÊNCIA
  // ============================================

  // Seletores genéricos que funcionam em múltiplas versões
  const EMERGENCY_SELECTORS = {
    MESSAGE_INPUT: [
      // Genéricos baseados em atributos
      '[contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]',
      '[data-tab] [contenteditable="true"]',
      // Baseados em estrutura
      '#main footer div[contenteditable]',
      '.two div[contenteditable="true"]'
    ],
    SEND_BUTTON: [
      // Genéricos
      '[data-icon="send"]',
      'button[type="submit"]',
      'span[data-icon="send"]',
      // Baseados em posição
      'footer button:last-child',
      '#main footer span[role="button"]'
    ],
    CHAT_LIST: [
      '#pane-side',
      '[role="listbox"]',
      '[aria-label*="chat"]',
      '.two > div:first-child'
    ],
    ATTACH_BUTTON: [
      '[data-icon*="clip"]',
      '[data-icon*="attach"]',
      '[aria-label*="nexar"]',
      '[aria-label*="ttach"]'
    ]
  };

  // ============================================
  // DETECÇÃO DINÂMICA DE SELETORES
  // ============================================

  /**
   * Tenta descobrir seletores dinamicamente analisando o DOM
   * @param {string} elementType - Tipo de elemento a descobrir
   * @returns {string|null} - Seletor descoberto ou null
   */
  function discoverSelector(elementType) {
    console.log(`[Compatibility] 🔍 Descobrindo seletor para: ${elementType}`);

    switch (elementType) {
      case 'MESSAGE_INPUT':
        return discoverMessageInput();
      case 'SEND_BUTTON':
        return discoverSendButton();
      case 'CHAT_LIST':
        return discoverChatList();
      case 'ATTACH_BUTTON':
        return discoverAttachButton();
      default:
        return null;
    }
  }

  /**
   * Descobre seletor do campo de mensagem
   */
  function discoverMessageInput() {
    // Estratégia 1: Procurar contenteditable no footer
    const footer = document.querySelector('footer');
    if (footer) {
      const editables = footer.querySelectorAll('[contenteditable="true"]');
      for (const el of editables) {
        if (isMessageInputLike(el)) {
          return generateSelector(el);
        }
      }
    }

    // Estratégia 2: Procurar por role="textbox" visível
    const textboxes = document.querySelectorAll('[role="textbox"][contenteditable="true"]');
    for (const el of textboxes) {
      if (isMessageInputLike(el) && isVisible(el)) {
        return generateSelector(el);
      }
    }

    // Estratégia 3: Analisar elementos na parte inferior da tela
    const candidates = document.querySelectorAll('[contenteditable="true"]');
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      // Campo de mensagem geralmente está na parte inferior
      if (rect.bottom > window.innerHeight * 0.7 && isMessageInputLike(el)) {
        return generateSelector(el);
      }
    }

    return null;
  }

  /**
   * Verifica se elemento parece ser campo de mensagem
   */
  function isMessageInputLike(el) {
    if (!el) return false;
    
    // Verificar atributos
    const contentEditable = el.getAttribute('contenteditable') === 'true';
    const hasRole = el.getAttribute('role') === 'textbox';
    
    // Verificar tamanho (campo de mensagem tem largura considerável)
    const rect = el.getBoundingClientRect();
    const hasReasonableSize = rect.width > 200 && rect.height > 20 && rect.height < 200;
    
    // Verificar se não é um campo de busca
    const notSearchField = !el.closest('[data-testid*="search"]');
    
    return contentEditable && hasReasonableSize && notSearchField;
  }

  /**
   * Descobre seletor do botão de enviar
   */
  function discoverSendButton() {
    // Estratégia 1: Procurar ícone de enviar
    const sendIcons = document.querySelectorAll('[data-icon="send"], span[data-icon="send"]');
    for (const icon of sendIcons) {
      const button = icon.closest('button, [role="button"]');
      if (button && isVisible(button)) {
        return generateSelector(button);
      }
    }

    // Estratégia 2: Procurar no footer por botões
    const footer = document.querySelector('footer');
    if (footer) {
      const buttons = footer.querySelectorAll('button, [role="button"]');
      for (const btn of buttons) {
        // Botão de enviar geralmente está à direita
        const rect = btn.getBoundingClientRect();
        const footerRect = footer.getBoundingClientRect();
        if (rect.right > footerRect.right - 100) {
          return generateSelector(btn);
        }
      }
    }

    // Estratégia 3: Procurar por aria-label relacionado
    const ariaButtons = document.querySelectorAll('[aria-label*="nviar"], [aria-label*="end"]');
    for (const btn of ariaButtons) {
      if (isVisible(btn)) {
        return generateSelector(btn);
      }
    }

    return null;
  }

  /**
   * Descobre seletor da lista de chats
   */
  function discoverChatList() {
    // Estratégia 1: ID conhecido
    const paneSize = document.querySelector('#pane-side');
    if (paneSize) {
      return '#pane-side';
    }

    // Estratégia 2: Procurar por listbox ou lista
    const lists = document.querySelectorAll('[role="listbox"], [role="list"]');
    for (const list of lists) {
      // Lista de chats geralmente está à esquerda e é grande
      const rect = list.getBoundingClientRect();
      if (rect.left < 400 && rect.height > 300) {
        return generateSelector(list);
      }
    }

    // Estratégia 3: Procurar por estrutura de dois painéis
    const twoPane = document.querySelector('.two');
    if (twoPane) {
      const firstChild = twoPane.firstElementChild;
      if (firstChild) {
        return generateSelector(firstChild);
      }
    }

    return null;
  }

  /**
   * Descobre seletor do botão de anexar
   */
  function discoverAttachButton() {
    // Estratégia 1: Ícones conhecidos
    const clipIcons = document.querySelectorAll('[data-icon*="clip"], [data-icon*="attach"]');
    for (const icon of clipIcons) {
      const button = icon.closest('button, [role="button"], span');
      if (button && isVisible(button)) {
        return generateSelector(button);
      }
    }

    // Estratégia 2: aria-label
    const ariaButtons = document.querySelectorAll('[aria-label*="nexar"], [aria-label*="ttach"]');
    for (const btn of ariaButtons) {
      if (isVisible(btn)) {
        return generateSelector(btn);
      }
    }

    return null;
  }

  // ============================================
  // GERAÇÃO DE SELETORES
  // ============================================

  /**
   * Gera um seletor único para um elemento
   * @param {Element} el - Elemento DOM
   * @returns {string} - Seletor CSS
   */
  function generateSelector(el) {
    if (!el) return null;

    // Prioridade 1: data-testid
    const testId = el.getAttribute('data-testid');
    if (testId) {
      return `[data-testid="${testId}"]`;
    }

    // Prioridade 2: id
    if (el.id) {
      return `#${el.id}`;
    }

    // Prioridade 3: data-icon
    const dataIcon = el.getAttribute('data-icon');
    if (dataIcon) {
      return `[data-icon="${dataIcon}"]`;
    }

    // Prioridade 4: Combinação de classe e atributos
    const classes = Array.from(el.classList).slice(0, 2).join('.');
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');

    if (role && classes) {
      return `${el.tagName.toLowerCase()}.${classes}[role="${role}"]`;
    }

    if (ariaLabel) {
      return `[aria-label="${ariaLabel}"]`;
    }

    // Prioridade 5: Caminho no DOM (menos confiável)
    return generatePathSelector(el);
  }

  /**
   * Gera seletor baseado no caminho do DOM
   */
  function generatePathSelector(el, maxDepth = 3) {
    const path = [];
    let current = el;
    let depth = 0;

    while (current && depth < maxDepth) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        return `#${current.id} ${path.reverse().join(' > ')}`.trim();
      }

      // Adicionar atributos únicos
      const testId = current.getAttribute('data-testid');
      if (testId) {
        selector += `[data-testid="${testId}"]`;
      } else if (current.classList.length) {
        selector += '.' + Array.from(current.classList).slice(0, 1).join('.');
      }

      path.push(selector);
      current = current.parentElement;
      depth++;
    }

    return path.reverse().join(' > ');
  }

  // ============================================
  // VERIFICAÇÃO E REPARO
  // ============================================

  /**
   * Verifica e repara seletores quebrados
   */
  async function checkAndRepair() {
    if (!window.WHL_VersionDetector) {
      return;
    }

    state.stats.totalChecks++;

    // Testar saúde dos seletores
    const health = await window.WHL_VersionDetector.testSelectorHealth();

    if (health.broken.length === 0) {
      // Silencioso - não logar sucesso
      return;
    }

    state.stats.breaksDetected += health.broken.length;
    
    // Só logar se não for modo silencioso
    if (!CONFIG.SILENT_MODE) {
      console.log(`[Compatibility] ⚠️ ${health.broken.length} seletores quebrados detectados`);
    }

    // Tentar reparar se habilitado
    if (CONFIG.AUTO_REPAIR) {
      await repairBrokenSelectors(health.broken);
    }
  }

  /**
   * Tenta reparar seletores quebrados
   * @param {Array} brokenList - Lista de seletores quebrados
   */
  async function repairBrokenSelectors(brokenList) {
    // Verificar cooldown
    if (state.lastRepairAttempt && 
        Date.now() - state.lastRepairAttempt < CONFIG.REPAIR_COOLDOWN) {
      return;
    }

    // Verificar máximo de tentativas
    if (state.repairAttempts >= CONFIG.MAX_REPAIR_ATTEMPTS) {
      if (!CONFIG.SILENT_MODE) {
        console.warn('[Compatibility] ⛔ Máximo de tentativas de reparo atingido');
      }
      return;
    }

    state.lastRepairAttempt = Date.now();
    state.repairAttempts++;

    const repaired = [];
    const failed = [];

    for (const broken of brokenList) {
      // Tentar seletores de emergência primeiro
      let newSelector = tryEmergencySelectors(broken.name);

      // Se não funcionou, tentar descobrir dinamicamente
      if (!newSelector) {
        newSelector = discoverSelector(broken.name);
      }

      if (newSelector) {
        // Testar se o novo seletor funciona
        try {
          const el = document.querySelector(newSelector);
          if (el) {
            repaired.push({
              name: broken.name,
              oldSelectors: broken.selectors,
              newSelector: newSelector
            });

            // Atualizar seletores ativos
            updateActiveSelector(broken.name, newSelector);

            state.repairedSelectors.set(broken.name, newSelector);
            state.brokenSelectors.delete(broken.name);
            state.stats.successfulRepairs++;

            console.log(`[Compatibility] ✅ Reparado: ${broken.name} → ${newSelector}`);
          } else {
            throw new Error('Seletor não encontrou elemento');
          }
        } catch (e) {
          failed.push(broken);
          state.brokenSelectors.add(broken.name);
          state.stats.failedRepairs++;
          console.warn(`[Compatibility] ❌ Falha ao reparar: ${broken.name}`);
        }
      } else {
        failed.push(broken);
        state.brokenSelectors.add(broken.name);
        state.stats.failedRepairs++;
      }
    }

    // Resetar contador se tudo foi reparado
    if (failed.length === 0) {
      state.repairAttempts = 0;
      console.log('[Compatibility] 🎉 Todos os seletores reparados com sucesso!');
    }

    // Notificar sobre reparos
    if (repaired.length > 0 && CONFIG.NOTIFY_BREAKS) {
      notifyRepairs(repaired, failed);
    }

    return { repaired, failed };
  }

  /**
   * Tenta seletores de emergência
   */
  function tryEmergencySelectors(name) {
    const emergency = EMERGENCY_SELECTORS[name];
    if (!emergency) return null;

    for (const selector of emergency) {
      try {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          return selector;
        }
      } catch (e) {
        // Seletor inválido
      }
    }

    return null;
  }

  /**
   * Atualiza seletor ativo
   */
  function updateActiveSelector(name, newSelector) {
    if (window.WHL_VersionDetector) {
      const selectors = window.WHL_VersionDetector.getActiveSelectors();
      if (selectors && selectors[name]) {
        // Adicionar novo seletor no início
        selectors[name] = [newSelector, ...selectors[name]];
      }
    }

    // Atualizar WHL_CONSTANTS
    if (window.WHL_CONSTANTS?.WHL_SELECTORS?.[name]) {
      window.WHL_CONSTANTS.WHL_SELECTORS[name] = [
        newSelector,
        ...window.WHL_CONSTANTS.WHL_SELECTORS[name]
      ];
    }
  }

  // ============================================
  // UTILITÁRIOS
  // ============================================

  /**
   * Verifica se elemento está visível
   */
  function isVisible(el) {
    if (!el) return false;

    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0' &&
           rect.width > 0 &&
           rect.height > 0;
  }

  // ============================================
  // NOTIFICAÇÕES
  // ============================================

  /**
   * Notifica sobre reparos realizados
   */
  function notifyRepairs(repaired, failed) {
    const message = {
      type: 'selector-repair',
      repaired: repaired.length,
      failed: failed.length,
      details: { repaired, failed }
    };

    // Evento DOM
    window.dispatchEvent(new CustomEvent('whl-selector-repair', { detail: message }));

    // Log formatado
    console.group('[Compatibility] 📝 Relatório de Reparo');
    console.log(`✅ Reparados: ${repaired.length}`);
    console.log(`❌ Falharam: ${failed.length}`);
    if (repaired.length > 0) {
      console.table(repaired.map(r => ({ Nome: r.name, 'Novo Seletor': r.newSelector })));
    }
    console.groupEnd();
  }

  /**
   * Notifica sobre quebras persistentes
   */
  function notifyPersistentBreak(brokenList) {
    const message = {
      type: 'persistent-break',
      broken: brokenList,
      suggestion: 'O WhatsApp Web pode ter atualizado. Verifique se há uma nova versão da extensão.'
    };

    window.dispatchEvent(new CustomEvent('whl-persistent-break', { detail: message }));

    // Notificação visual se disponível
    if (window.NotificationsModule) {
      window.NotificationsModule.warning(
        '⚠️ Alguns elementos do WhatsApp Web mudaram. A extensão pode não funcionar corretamente.',
        { duration: 10000 }
      );
    }
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  /**
   * Inicia verificação periódica de saúde
   */
  function startHealthCheck() {
    if (state.healthCheckInterval) {
      clearInterval(state.healthCheckInterval);
    }

    state.healthCheckInterval = setInterval(() => {
      checkAndRepair();
    }, CONFIG.HEALTH_CHECK_INTERVAL);

    console.log('[Compatibility] 🏥 Verificação de saúde iniciada');
  }

  /**
   * Para verificação de saúde
   */
  function stopHealthCheck() {
    if (state.healthCheckInterval) {
      clearInterval(state.healthCheckInterval);
      state.healthCheckInterval = null;
      console.log('[Compatibility] 🛑 Verificação de saúde parada');
    }
  }

  /**
   * Inicializa o módulo
   */
  async function init() {
    if (state.initialized) return;

    console.log('[Compatibility] 🚀 Inicializando gerenciador de compatibilidade...');

    // Aguardar VersionDetector
    if (!window.WHL_VersionDetector) {
      console.log('[Compatibility] ⏳ Aguardando VersionDetector...');
      await new Promise(resolve => {
        const check = () => {
          if (window.WHL_VersionDetector?.isInitialized?.()) {
            resolve();
          } else {
            setTimeout(check, 500);
          }
        };
        check();
      });
    }

    // Executar verificação inicial
    await checkAndRepair();

    // Iniciar verificação periódica
    startHealthCheck();

    // Escutar mudanças de versão
    if (window.WHL_VersionDetector) {
      window.WHL_VersionDetector.onVersionChange((detection) => {
        console.log('[Compatibility] 📢 Versão mudou:', detection.version);
        state.repairAttempts = 0; // Resetar tentativas
        checkAndRepair();
      });
    }

    state.initialized = true;
    console.log('[Compatibility] ✅ Gerenciador de compatibilidade inicializado');
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  const CompatibilityManager = {
    init,
    
    // Verificação e reparo
    checkAndRepair,
    repairBrokenSelectors,
    discoverSelector,
    
    // Seletores
    getEmergencySelectors: () => EMERGENCY_SELECTORS,
    getRepairedSelectors: () => Object.fromEntries(state.repairedSelectors),
    getBrokenSelectors: () => Array.from(state.brokenSelectors),
    
    // Monitoramento
    startHealthCheck,
    stopHealthCheck,
    
    // Estatísticas
    getStats: () => ({ ...state.stats }),
    getState: () => ({ ...state }),
    
    // Configuração
    setConfig: (key, value) => {
      if (CONFIG.hasOwnProperty(key)) {
        CONFIG[key] = value;
      }
    },
    getConfig: () => ({ ...CONFIG }),

    // Utilitários
    generateSelector,
    isVisible
  };

  // Expor globalmente
  window.WHL_CompatibilityManager = CompatibilityManager;

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    stopHealthCheck();
  });

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, 3000); // Após VersionDetector
    });
  } else {
    setTimeout(init, 3000);
  }

  console.log('[Compatibility] 📦 Módulo carregado');

})(); // End IIFE
