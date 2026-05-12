/**
 * 🔍 WhatsApp DOM Monitor (RISK-001)
 *
 * Monitora mudanças estruturais no DOM do WhatsApp Web para:
 * - Detectar alterações que quebram seletores CSS
 * - Alertar sobre elementos críticos indisponíveis
 * - Registrar telemetria de mudanças estruturais
 * - Acionar fallback automático para seletores alternativos
 *
 * @version 1.0.0
 */

class WhatsAppDOMMonitor {
  constructor() {
    this.observers = new Map();
    this.criticalSelectors = new Map();
    this.changeLog = [];
    this.maxLogSize = 100;
    this.checkInterval = null;
    this.telemetryEnabled = true;

    // Estruturas críticas do WhatsApp Web.
    //
    // Ordem dentro de cada `selectors` = preferência. Em WA 2.3000.x quase
    // todos os `data-testid` foram removidos; mantemos como último recurso
    // pra builds antigos, mas as âncoras estáveis (ID #app/#pane-side/#main,
    // aria-label, role=textbox, data-lexical-editor, span[data-icon])
    // vêm primeiro.
    //
    // `needsChat: true` significa "esse elemento só existe quando o
    // usuário tem um chat aberto" — a checagem só reporta missing se
    // detectarmos um chat aberto (`#main [role="row"]` ou `#main header`).
    this.criticalElements = {
      chatList: {
        selectors: [
          '#pane-side',
          '#side',
          '[aria-label="Lista de conversas"]',
          '[aria-label="Chat list"]',
          'div[aria-label*="conversa" i]',
          '[data-testid="chat-list"]',
          '[data-testid="chatlist"]',
        ],
        required: true,
        needsChat: false,
        lastFound: null
      },
      messageInput: {
        selectors: [
          'footer div[contenteditable="true"][role="textbox"]',
          'footer div[contenteditable="true"][data-lexical-editor="true"]',
          '[data-lexical-editor="true"][contenteditable="true"]',
          '#main footer div[contenteditable="true"]',
          'footer div[contenteditable="true"]',
          // legacy
          'div[contenteditable="true"][data-tab="10"]',
          'div[contenteditable="true"][data-tab="1"]',
          '[data-testid="conversation-compose-box-input"]',
        ],
        required: true,
        needsChat: true,
        lastFound: null
      },
      sendButton: {
        selectors: [
          // span[data-icon] sobreviveu na 2.3000.x
          'span[data-icon="send"]',
          'span[data-icon="wds-ic-send-filled"]',
          'footer button[aria-label*="Enviar" i]',
          'footer button[aria-label*="Send" i]',
          'footer button[aria-label*="enviar" i]',
          // legacy
          'button[data-testid="compose-btn-send"]',
          '[data-testid="send"]',
        ],
        required: true,
        needsChat: true,
        lastFound: null
      },
      contactName: {
        selectors: [
          '#main header span[title]',
          '#main header span[dir="auto"]',
          '#main header h1',
          // legacy
          '[data-testid="conversation-info-header-chat-title"]',
          '[data-testid="conversation-header"] span',
        ],
        required: false,
        needsChat: true,
        lastFound: null
      },
      messageContainer: {
        selectors: [
          '#main [role="row"]',
          '#main [data-id]',
          '#main .copyable-area',
          '#main [role="application"]',
          // legacy
          'div[data-testid="conversation-panel-messages"]',
          'div.copyable-area',
        ],
        required: true,
        needsChat: true,
        lastFound: null
      }
    };
  }

  /**
   * Detecta se o usuário tem um chat aberto. Usado pra suprimir os
   * "elemento crítico ausente: messageInput/sendButton/messageContainer"
   * quando o usuário ainda não clicou em nenhum chat — eles realmente
   * não existem ali, e gritar todo polling era ruído puro.
   */
  hasChatOpen() {
    try {
      const main = document.querySelector('#main');
      if (!main) return false;
      // #main fica no DOM com header preenchido quando há chat ativo.
      return !!(main.querySelector('header') || main.querySelector('[role="row"]'));
    } catch (_) { return false; }
  }

  /**
   * Inicia o monitoramento
   */
  start(options = {}) {
    this.telemetryEnabled = options.telemetry !== false;
    const checkIntervalMs = options.checkInterval || 30000; // 30s padrão

    console.log('[DOM Monitor] Iniciando monitoramento WhatsApp DOM...');

    // Check inicial
    this.checkCriticalElements();

    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.checkCriticalElements();
    }, checkIntervalMs);

    // MutationObserver para mudanças estruturais
    this.observeStructuralChanges();

    console.log('[DOM Monitor] Monitoramento ativo');
  }

  /**
   * Para o monitoramento
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.observers.forEach(observer => observer.disconnect());
    this.observers.clear();

    console.log('[DOM Monitor] Monitoramento parado');
  }

  /**
   * Verifica disponibilidade dos elementos críticos
   */
  checkCriticalElements() {
    const results = {
      timestamp: Date.now(),
      missing: [],
      changed: [],
      healthy: true
    };

    const chatOpen = this.hasChatOpen();
    results.chatOpen = chatOpen;

    for (const [name, config] of Object.entries(this.criticalElements)) {
      const found = this.findElement(config.selectors);

      // Skip "missing" reports for elements that legitimately don't exist
      // when no chat is open (messageInput, sendButton, messageContainer,
      // contactName). They are not really critical until the user picks
      // a chat — reporting them every poll just spams the console.
      const isMissingAndCritical = !found && config.required && (!config.needsChat || chatOpen);
      if (isMissingAndCritical) {
        results.missing.push(name);
        results.healthy = false;

        this.logChange({
          type: 'MISSING_CRITICAL',
          element: name,
          selectors: config.selectors,
          chatOpen,
          timestamp: Date.now()
        });
      } else if (found && config.lastFound !== found) {
        // Seletor mudou (elemento encontrado com seletor diferente)
        results.changed.push({
          name,
          oldSelector: config.lastFound,
          newSelector: found
        });

        this.logChange({
          type: 'SELECTOR_CHANGED',
          element: name,
          from: config.lastFound,
          to: found,
          timestamp: Date.now()
        });
      }

      config.lastFound = found;
    }

    // Enviar telemetria se houver problemas
    if (!results.healthy && this.telemetryEnabled) {
      this.sendTelemetry(results);
    }

    return results;
  }

  /**
   * Encontra elemento usando lista de seletores (fallback)
   */
  findElement(selectors) {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return selector; // Retorna o seletor que funcionou
        }
      } catch (e) {
        console.warn(`[DOM Monitor] Seletor inválido: ${selector}`, e);
      }
    }
    return null;
  }

  /**
   * Observa mudanças estruturais significativas
   */
  observeStructuralChanges() {
    // CORREÇÃO P2: Usar ObserverRegistry central em vez de MutationObserver direto
    if (typeof ObserverRegistry !== 'undefined' && ObserverRegistry.on) {
      this._unregisterStructural = ObserverRegistry.on(
        'root',
        'dom:structural',
        (mutations) => {
          const significantChanges = mutations.filter(m =>
            m.type === 'childList' &&
            (m.addedNodes.length > 5 || m.removedNodes.length > 5)
          );
          if (significantChanges.length > 0) {
            this.logChange({ type: 'STRUCTURAL_CHANGE', mutations: significantChanges.length, timestamp: Date.now() });
            setTimeout(() => this.checkCriticalElements(), 1000);
          }
        },
        { childList: true, subtree: true, attributes: false }
      );
      this.observers.set('structural', { disconnect: () => this._unregisterStructural?.() });
    } else {
      // Fallback: MutationObserver direto se ObserverRegistry não estiver disponível
      const observer = new MutationObserver((mutations) => {
        const significantChanges = mutations.filter(m =>
          m.type === 'childList' && (m.addedNodes.length > 5 || m.removedNodes.length > 5)
        );
        if (significantChanges.length > 0) {
          this.logChange({ type: 'STRUCTURAL_CHANGE', mutations: significantChanges.length, timestamp: Date.now() });
          setTimeout(() => this.checkCriticalElements(), 1000);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: false });
      this.observers.set('structural', observer);
    }
  }

  /**
   * Registra mudança no log
   */
  logChange(change) {
    this.changeLog.push(change);

    // Manter apenas últimas N entradas
    if (this.changeLog.length > this.maxLogSize) {
      this.changeLog = this.changeLog.slice(-this.maxLogSize);
    }

    // Log crítico no console
    if (change.type === 'MISSING_CRITICAL') {
      console.error(`[DOM Monitor] ⚠️ Elemento crítico ausente: ${change.element}`, change);
    } else if (change.type === 'SELECTOR_CHANGED') {
      console.warn(`[DOM Monitor] 🔄 Seletor mudou: ${change.element}`, change);
    }
  }

  /**
   * Envia telemetria para o backend
   */
  async sendTelemetry(results) {
    try {
      // FIX PEND-MED-010: Check user consent before sending telemetry
      const consentData = await chrome.storage.local.get('whl_telemetry_consent');
      if (consentData.whl_telemetry_consent !== true) {
        return; // User has not consented
      }

      const config = await chrome.storage.local.get(['whl_backend_url', 'whl_auth_token']);

      if (!config.whl_backend_url || !config.whl_auth_token) {
        return; // Backend não configurado
      }

      await fetch(`${config.whl_backend_url}/api/v1/analytics/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.whl_auth_token}`
        },
        body: JSON.stringify({
          type: 'dom_monitor',
          event: 'health_check',
          data: {
            healthy: results.healthy,
            missing: results.missing,
            changed: results.changed,
            // Anonymized: only send domain, not full URL with chat IDs
            domain: window.location.hostname,
            // Anonymized: only browser name/version, not full UA string
            browser: navigator.userAgent.match(/(Chrome|Firefox|Safari|Edge)\/[\d.]+/)?.[0] || 'unknown',
            timestamp: results.timestamp
          }
        })
      });
    } catch (error) {
      console.warn('[DOM Monitor] Erro ao enviar telemetria:', error);
    }
  }

  /**
   * Obtém o log de mudanças
   */
  getChangeLog(limit = 50) {
    return this.changeLog.slice(-limit);
  }

  /**
   * Obtém status atual de saúde
   */
  getHealthStatus() {
    const status = {
      healthy: true,
      elements: {},
      lastCheck: Date.now()
    };

    const chatOpen = this.hasChatOpen();
    status.chatOpen = chatOpen;

    for (const [name, config] of Object.entries(this.criticalElements)) {
      const available = !!config.lastFound;
      status.elements[name] = {
        available,
        required: config.required,
        needsChat: !!config.needsChat,
        currentSelector: config.lastFound
      };

      // Apenas marca a saúde geral como ruim se o elemento é realmente
      // necessário no contexto atual (chatList sempre; messageInput etc.
      // só quando há chat aberto).
      const isBlocking = config.required && !available && (!config.needsChat || chatOpen);
      if (isBlocking) status.healthy = false;
    }

    return status;
  }

  /**
   * Tenta recuperar elemento usando seletores alternativos
   */
  async attemptRecovery(elementName) {
    const config = this.criticalElements[elementName];
    if (!config) return null;

    console.log(`[DOM Monitor] Tentando recuperar: ${elementName}...`);

    // Aguardar um pouco para o DOM estabilizar
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Tentar cada seletor
    for (const selector of config.selectors) {
      const element = document.querySelector(selector);
      if (element) {
        console.log(`[DOM Monitor] ✅ Recuperado com: ${selector}`);
        config.lastFound = selector;
        return element;
      }
    }

    console.error(`[DOM Monitor] ❌ Não foi possível recuperar: ${elementName}`);
    return null;
  }

  /**
   * Adiciona seletor customizado para monitorar
   */
  addCustomSelector(name, selectors, required = false) {
    this.criticalElements[name] = {
      selectors: Array.isArray(selectors) ? selectors : [selectors],
      required,
      lastFound: null
    };
  }

  /**
   * Remove seletor customizado
   */
  removeCustomSelector(name) {
    delete this.criticalElements[name];
  }
}

// Singleton instance
let monitorInstance = null;

/**
 * Obtém instância singleton do monitor
 */
function getDOMMonitor() {
  if (!monitorInstance) {
    monitorInstance = new WhatsAppDOMMonitor();
  }
  return monitorInstance;
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WhatsAppDOMMonitor, getDOMMonitor };
} else {
  window.WhatsAppDOMMonitor = WhatsAppDOMMonitor;
  window.getDOMMonitor = getDOMMonitor;
}
