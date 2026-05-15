/**
 * @file content/content-parts/01-bootstrap.js
 * @description Slice 1-1500 do content.js original (refactor v9.0.0)
 * @lines 1500
 */


(() => {
  'use strict';

  // FIX CRÍTICO: window.__WHL_SINGLE_TAB__ persiste em SPA navigation do WhatsApp.
  // Quando o WA recarrega o frame parcialmente (ex: troca de conversa), a flag
  // permanece no objeto window da sessão anterior e bloqueia a reinicialização.
  //
  // Solução: usa sessionStorage (vinculado ao documento, não ao objeto window)
  // combinado com um timestamp de sessão para detectar recargas genuínas vs.
  // tentativas de dupla-inicialização no mesmo carregamento de página.
  const SESSION_KEY  = '__whl_init_session__';
  const currentLoad  = performance.now().toFixed(0); // único por carregamento de página
  const existingLoad = sessionStorage.getItem(SESSION_KEY);

  if (existingLoad === currentLoad) {
    // Mesmo carregamento de página — dupla execução real, bloqueia
    return;
  }
  // Novo carregamento (ou SPA reset) — permite inicialização
  sessionStorage.setItem(SESSION_KEY, currentLoad);

  // Mantém window flag como compatibilidade com código legado que a leia
  window.__WHL_SINGLE_TAB__ = true;

  // ===== WORKER TAB DETECTION =====
  // FIX: detecção via URL params é frágil — redirects internos do WA removem
  // os params. Agora verifica também via sessionStorage (flag persistida pelo SW)
  // e via hash, que sobrevive a redirects SPA.
  const urlParams    = new URLSearchParams(window.location.search);
  const urlHash      = window.location.hash || '';
  const swFlaggedKey = '__whl_worker_tab__';

  const isWorkerTab = (
    urlParams.has('whl_worker') ||
    window.location.href.includes('whl_worker=true') ||
    urlHash.includes('whl_worker') ||
    sessionStorage.getItem(swFlaggedKey) === 'true'
  );

  // Se detectado como worker via URL, persiste no sessionStorage como backup
  // para sobreviver a possíveis redirects internos do WA nesta sessão
  if (urlParams.has('whl_worker') || window.location.href.includes('whl_worker=true')) {
    try { sessionStorage.setItem(swFlaggedKey, 'true'); } catch (_) {}
  }

  // Item 20: Minimize console log pollution based on environment
  const WHL_DEBUG = localStorage.getItem('whl_debug') === 'true';
  
  function escapeHtml(str) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(str);
    if (str === undefined || str === null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (isWorkerTab) {
    if (WHL_DEBUG) console.log('[WHL] This is the worker tab, UI disabled');
    // Worker content script will handle this tab
    return;
  }

  // Use centralized logging from logger.js
  const whlLog = window.whlLog || {
    debug: (...args) => { if (WHL_DEBUG) console.log('[WHL DEBUG]', ...args); },
    info: (...args) => console.log('[WHL]', ...args),
    warn: (...args) => console.warn('[WHL]', ...args),
    error: (...args) => console.error('[WHL]', ...args)
  };

  // ===== DOM SELECTORS =====
  // Centralized selector constants for better maintainability
  // UPDATED 2024/2025 - Seletores atualizados baseados no projeto funcional
  const WHL_SELECTORS = {
    // Message input - Ordem atualizada para 2024/2025 (Lexical editor primeiro)
    MESSAGE_INPUT: [
      '[data-testid="conversation-compose-box-input"]',
      'footer div[contenteditable="true"][data-lexical-editor="true"]',
      '[data-lexical-editor="true"]',
      'div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"][role="textbox"]',
      '#main footer div[contenteditable="true"]',
      'footer div[contenteditable="true"]',
      '#main footer [contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]'
    ],
    // Send button - Atualizado com novos seletores 2024/2025
    SEND_BUTTON: [
      '[data-testid="compose-btn-send"]',
      'span[data-icon="wds-ic-send-filled"]',
      'footer button span[data-icon="send"]',
      'footer button span[data-icon="send-light"]',
      '[data-testid="send"]',
      'button span[data-icon="send"]',
      '[aria-label="Enviar"]',
      'button[aria-label*="Send"]',
      'footer button[aria-label*="Enviar"]',
      'footer button[aria-label*="Send"]'
    ],
    // Attach menu
    ATTACH_BUTTON: [
      'footer button[aria-label*="Anexar"]',
      'footer button[title*="Anexar"]',
      '[data-testid="attach-clip"]',
      '[data-testid="clip"]',
      'footer span[data-icon="attach-menu-plus"]',
      'footer span[data-icon="clip"]',
      'footer span[data-icon="attach"]',
      '[aria-label="Anexar"]'
    ],
    // Media attach
    ATTACH_IMAGE: [
      '[data-testid="attach-image"]',
      '[data-testid="mi-attach-media"]',
      '[data-testid="attach-photo"]'
    ],
    // Caption input - Atualizado para 2024/2025
    CAPTION_INPUT: [
      '[data-testid="media-caption-input"]',
      'div[aria-label*="legenda"][contenteditable="true"]',
      'div[aria-label*="Legenda"][contenteditable="true"]',
      'div[aria-label*="caption"][contenteditable="true"]',
      'div[aria-label*="Caption"][contenteditable="true"]',
      'div[aria-label*="Adicionar"][contenteditable="true"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'footer div[contenteditable="true"]'
    ],
    // Chat header - Novo
    CHAT_HEADER: [
      'header span[title]',
      'header [title]',
      '#main header span[dir="auto"]',
      '[data-testid="conversation-header"]',
      '#main header'
    ],
    // Search box - Novo para 2024/2025
    SEARCH_BOX: [
      '[contenteditable="true"][data-tab="3"]',
      'div[role="textbox"][data-tab="3"]',
      '#side div[contenteditable="true"]',
      'div[aria-label="Caixa de texto de pesquisa"]',
      'div[aria-label="Search input textbox"]',
      '[data-testid="chat-list-search"]',
      '[data-testid="chat-list-search"] div[contenteditable="true"]'
    ],
    // Search results
    SEARCH_RESULTS: [
      '[data-testid="cell-frame-container"]',
      '#pane-side [role="listitem"]',
      '#pane-side [role="row"]',
      '[data-testid="chat-list"] [role="row"]'
    ],
    // Messages container
    MESSAGES_CONTAINER: [
      '[data-testid="conversation-panel-messages"]',
      '#main div[role="application"]',
      '#main'
    ]
  };

  // ===== CONFIGURAÇÃO GLOBAL =====
  // Flag para habilitar envio via API direta (WPP Boladão) ou URL tradicional
  // true = API direta com métodos validados (SEM reload, resultados confirmados)
  // false = URL mode (fallback, com reload de página)
  const WHL_CONFIG = {
    USE_DIRECT_API: true,  // HABILITADO: Usa métodos testados e validados (enviarMensagemAPI e enviarImagemDOM)
    API_RETRY_ON_FAIL: true,  // Se API falhar, tentar URL mode
    USE_WORKER_FOR_SENDING: false,  // DISABLED: Hidden Worker Tab não funciona - usar API direta
    USE_INPUT_ENTER_METHOD: false,  // DESABILITADO: Causa reload - usar API direta ao invés
  };
  
  // Performance optimization constants
  const PERFORMANCE_LIMITS = {
    MAX_RESPONSE_SIZE: 100 * 1024,      // 100KB - Skip network extraction for large responses
    MAX_WEBSOCKET_SIZE: 50 * 1024,      // 50KB - Skip WebSocket extraction for large messages
    NETWORK_EXTRACT_THROTTLE: 1000      // 1 second - Throttle network extraction interval
  };

  // Injetar wpp-hooks.js no contexto da página
  function injectWppHooks() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/wpp-hooks.js');
    script.onload = () => {
      whlLog.info('WPP Hooks injetados');
    };
    script.onerror = () => {
      whlLog.error('Erro ao injetar WPP Hooks');
    };
    (document.head || document.documentElement).appendChild(script);
  }
  
  // Injetar os hooks imediatamente
  injectWppHooks();

  // Helper function to safely get icon URLs
  function getIconURL(iconName) {
    try {
      if (chrome?.runtime?.id) {
        return chrome.runtime.getURL(`icons/${iconName}`);
      }
    } catch (e) {
      console.warn('[WHL] Não foi possível obter URL do ícone:', e);
    }
    return ''; // fallback
  }

  // ===== SAFE CHROME WRAPPER =====
  // Handles "Extension context invalidated" errors gracefully
  function safeChrome(fn) {
    try {
      if (!chrome?.runtime?.id) {
        console.warn('[WHL] ⚠️ Extensão invalidada - recarregue a página (F5)');
        showExtensionInvalidatedWarning();
        return null;
      }
      return fn();
    } catch (e) {
      if (e.message && e.message.includes('Extension context invalidated')) {
        console.warn('[WHL] ⚠️ Recarregue a página do WhatsApp Web (F5)');
        showExtensionInvalidatedWarning();
      }
      return null;
    }
  }
  
  // Show warning in UI when extension is invalidated
  function showExtensionInvalidatedWarning() {
    try {
      const panel = document.getElementById('whlPanel');
      if (panel) {
        // Check if warning already exists
        const existingWarning = panel.querySelector('.whl-extension-warning');
        if (existingWarning) return;
        
        const warning = document.createElement('div');
        warning.className = 'whl-extension-warning';
        warning.style.cssText = 'background:#ff4444;color:#fff;padding:10px;text-align:center;font-weight:bold;border-radius:8px;margin-bottom:10px';
        warning.textContent = '⚠️ Extensão atualizada! Recarregue a página (F5)';
        panel.prepend(warning);
      }
    } catch (err) {
      whlLog.caught('showExtensionInvalidatedWarning', err);
    }
  }

  // ======= Validador e repositório dos telefones extraídos =======
  const HarvesterStore = {
    _phones: new Map(), // Map<numero, {origens:Set, conf:number, meta:Object}>
    _valid: new Set(),
    _meta: {},
    PATTERNS: {
      BR_MOBILE: /\b(?:\+?55)?\s?\(?[1-9][0-9]\)?\s?9[0-9]{4}-?[0-9]{4}\b/g,
      BR_LAND: /\b(?:\+?55)?\s?\(?[1-9][0-9]\)?\s?[2-8][0-9]{3}-?[0-9]{4}\b/g,
      RAW: /\b\d{8,15}\b/g
    },
    ORIGINS: {
      DOM: 'dom',
      STORE: 'store',
      GROUP: 'group',
      WS: 'websocket',
      NET: 'network',
      LS: 'local_storage'
    },
    processPhone(num, origin, meta = {}) {
      if (!num) return null;
      let n = num.replace(/\D/g, '');
      if (n.length < 8 || n.length > 15) return null;
      if (n.length === 11 && n[2] === '9') n = '55' + n;
      if ((n.length === 10 || n.length === 11) && !n.startsWith('55')) n = '55' + n;
      if (!this._phones.has(n)) this._phones.set(n, {origens: new Set(), conf: 0, meta: {}});
      let item = this._phones.get(n);
      item.origens.add(origin);
      Object.assign(item.meta, meta);
      this._meta[n] = {...item.meta};
      item.conf = this.calcScore(item);
      if (item.conf >= 60) this._valid.add(n);
      return n;
    },
    calcScore(item) {
      let score = 10;
      if (item.origens.size > 1) score += 30;
      if (item.origens.has(this.ORIGINS.STORE)) score += 30;
      if (item.origens.has(this.ORIGINS.GROUP)) score += 10;
      if (item.meta?.nome) score += 15;
      if (item.meta?.isGroup) score += 5;
      if (item.meta?.isActive) score += 10;
      return Math.min(score, 100);
    },
    stats() {
      const or = {};
      Object.values(this.ORIGINS).forEach(o => or[o] = 0);
      this._phones.forEach(item => { item.origens.forEach(o => or[o]++); });
      return or;
    },
    save() {
      try {
        if (chrome?.runtime?.id) {
          chrome.storage.local.set({
            contacts: Array.from(this._phones.keys()),
            valid: Array.from(this._valid),
            meta: this._meta
          }).catch(err => {
            whlLog.error('Erro ao salvar contatos no storage:', err);
          });
        }
      } catch (e) {
        whlLog.error('Erro ao preparar dados para salvar:', e);
      }
    },
    clear() {
      this._phones.clear();
      this._valid.clear();
      this._meta = {};
      localStorage.removeItem('wa_extracted_numbers');
      this.save();
    }
  };

  // Expor HarvesterStore globalmente para acesso do background script
  window.HarvesterStore = HarvesterStore;

  // ========== Extração ==========
  const WAExtractor = {
    _saveTimeout: null, // For debounced saves
    
    async start() {
      await this.waitLoad();
      this.observerChats();
      this.hookNetwork();
      this.localStorageExtract();
      
      // Debounced periodic save - only save if data changed
      const harvesterSaveInterval = setInterval(() => {
        try {
          // Only save if there are contacts
          if (HarvesterStore._phones.size > 0) {
            HarvesterStore.save();
          }
        } catch(e) {
          whlLog.error('Erro ao salvar periodicamente:', e);
        }
      }, 12000);
      
      // Registrar para cleanup global
      if (window.__whlIntervals) window.__whlIntervals.push(harvesterSaveInterval);
    },
    async waitLoad() {
      return new Promise(ok => {
        function loop() {
          if (document.querySelector('#pane-side') || window.Store) ok();
          else setTimeout(loop, 600);
        }
        loop();
      });
    },
    exposeStore() {
      // DESABILITADO: CSP do WhatsApp Web bloqueia scripts inline
      whlLog.debug('exposeStore desabilitado (CSP blocking)');
      return;
    },
    fromStore() {
      if (!window.Store?.Chat || !window.Store?.Contact) {
        whlLog.warn('Store não disponível para extração');
        return;
      }
      try {
        let chats = window.Store?.Chat?.models || [];
        chats.forEach(chat => {
          let id = chat.id._serialized;
          if (id.endsWith('@c.us')) {
            let fone = id.replace('@c.us', '');
            HarvesterStore.processPhone(fone, HarvesterStore.ORIGINS.STORE, {nome: chat.name, isActive: true});
          }
          if (id.endsWith('@g.us')) this.fromGroup(chat);
        });
        let contacts = window.Store?.Contact?.models || [];
        contacts.forEach(c => {
          let id = c.id._serialized;
          if (id.endsWith('@c.us')) HarvesterStore.processPhone(id.replace('@c.us',''), HarvesterStore.ORIGINS.STORE, {nome: c.name});
        });
      } catch(e) {
        whlLog.caught('fromStore', e);
      }
    },
    fromGroup(chat) {
      try {
        let members = chat.groupMetadata?.participants || [];
        members.forEach(m => {
          let id = m.id._serialized;
          if (id.endsWith('@c.us')) HarvesterStore.processPhone(id.replace('@c.us',''), HarvesterStore.ORIGINS.GROUP, {isGroup:true});
        });
      } catch(err) {
        whlLog.caught('fromGroup', err);
      }
    },
    observerChats() {
      let pane = document.querySelector('#pane-side');
      if (!pane) return;
      const obs = new MutationObserver(muts => {
        muts.forEach(m => m.addedNodes.forEach(n => {
          if (n.nodeType === 1) this.extractElement(n);
        }));
      });
      obs.observe(pane, {childList:true, subtree:true});
      // Registrar para cleanup
      window.__whlObservers = window.__whlObservers || [];
      window.__whlObservers.push(obs);
      this.extractElement(pane);
    },
    extractElement(el) {
      try {
        if (el.textContent) this.findPhones(el.textContent, HarvesterStore.ORIGINS.DOM);
        Array.from(el.querySelectorAll?.('span,div')).forEach(e => this.findPhones(e.textContent, HarvesterStore.ORIGINS.DOM));
      } catch(err) {
        whlLog.caught('extractElement', err);
      }
    },
    findPhones(text, origin) {
      if (!text) return;
      let res = [...text.matchAll(HarvesterStore.PATTERNS.BR_MOBILE)]
        .concat([...text.matchAll(HarvesterStore.PATTERNS.BR_LAND)])
        .concat([...text.matchAll(HarvesterStore.PATTERNS.RAW)]);
      res.forEach(m => HarvesterStore.processPhone(m[0], origin));
    },
    hookNetwork() {
      // Throttle phone extraction to reduce performance impact
      let lastExtractTime = 0;
      
      const throttledExtract = (data, origin) => {
        const now = Date.now();
        if (now - lastExtractTime < PERFORMANCE_LIMITS.NETWORK_EXTRACT_THROTTLE) return;
        lastExtractTime = now;
        WAExtractor.findPhones(data, origin);
      };
      
      // fetch
      let f0 = window.fetch;
      window.fetch = async function(...a) {
        let r = await f0.apply(this,a);
        // Only extract from successful responses
        if (r.ok) {
          let data = await r.clone().text().catch(()=>null);
          if (data && data.length < PERFORMANCE_LIMITS.MAX_RESPONSE_SIZE) {
            throttledExtract(data, HarvesterStore.ORIGINS.NET);
          }
        }
        return r;
      };
      
      // XHR
      let oOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(...a) {
        this._wa_url = a[1];
        return oOpen.apply(this,a);
      };
      let oSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send = function(...a) {
        this.addEventListener('load',function(){
          // Secure URL validation using URL parsing
          if(this._wa_url && this.status === 200) {
            try {
              const url = new URL(this._wa_url);
              if(url.hostname === 'web.whatsapp.com' || 
                 url.hostname.endsWith('.whatsapp.com') || 
                 url.hostname.endsWith('.whatsapp.net')) {
                const text = this.responseText;
                if (text && text.length < PERFORMANCE_LIMITS.MAX_RESPONSE_SIZE) {
                  throttledExtract(text, HarvesterStore.ORIGINS.NET);
                }
              }
            } catch(e) {
              // Invalid URL, ignore
            }
          }
        });
        return oSend.apply(this,a);
      };
      
      // WebSocket - also throttled
      let WSOld = window.WebSocket;
      window.WebSocket = function(...args) {
        let ws = new WSOld(...args);
        ws.addEventListener('message',e=>{
          if (typeof e.data === 'string' && e.data.length < PERFORMANCE_LIMITS.MAX_WEBSOCKET_SIZE) {
            throttledExtract(e.data, HarvesterStore.ORIGINS.WS);
          }
        });
        return ws;
      };
    },
    localStorageExtract() {
      try {
        Object.keys(localStorage).forEach(k=>{
          if (k.includes('chat')||k.includes('contact')||k.includes('wa')) {
            let v = localStorage.getItem(k);
            if (v) this.findPhones(v, HarvesterStore.ORIGINS.LS);
          }
        });
      } catch(err) {
        whlLog.caught('localStorageExtract', err);
      }
    },
    async autoScroll() {
      let pane = document.querySelector('#pane-side');
      if (!pane) return;
      for (let i=0;i<25;i++) {
        pane.scrollTop = pane.scrollHeight;
        await new Promise(ok=>setTimeout(ok,600+Math.random()*600));
        this.extractElement(pane);
      }
    }
  };

  // Cleanup de MutationObservers e Intervals registrados
  window.__whlObservers = window.__whlObservers || [];
  window.__whlIntervals = window.__whlIntervals || [];
  window.addEventListener('beforeunload', () => {
    try {
      window.__whlObservers.forEach(obs => obs?.disconnect?.());
      window.__whlObservers = [];
      window.__whlIntervals.forEach(id => clearInterval(id));
      window.__whlIntervals = [];
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  });

  // Listener para mensagens do background/popup relacionadas ao Harvester
  chrome.runtime.onMessage.addListener((msg,_,resp)=>{
    // ===== ONBOARDING HIGHLIGHT HANDLER =====
    if (msg.action === 'WHL_ONBOARDING_HIGHLIGHT') {
      handleOnboardingHighlight(msg.buttonIndex, msg.show);
      resp({ success: true });
      return true;
    }
    
    if(msg.action==='getStats'){
      resp({
        total: HarvesterStore._phones.size,
        valid: HarvesterStore._valid.size,
        sources: HarvesterStore.stats()
      });
      return true;
    }
    if(msg.action==='forceExtract'){
      WAExtractor.fromStore();
      WAExtractor.autoScroll();
      resp({success:true});
      return true;
    }
    if(msg.action==='exportData'){
      resp({
        data: {
          numbers: Array.from(HarvesterStore._phones.keys()),
          valid: Array.from(HarvesterStore._valid),
          meta: HarvesterStore._meta
        }
      });
      return true;
    }
    if(msg.action==='clearData'){
      HarvesterStore.clear();
      resp({success:true});
      return true;
    }
    if(msg.type==='netPhones' && msg.phones){
      msg.phones.forEach(p => HarvesterStore.processPhone(p, HarvesterStore.ORIGINS.NET));
      return true;
    }

    // ===== ABRIR CHAT NA MESMA ABA =====
    if(msg.type === 'WHL_OPEN_CHAT' && msg.phone) {
      const phone = String(msg.phone).replace(/\D/g, '');
      openChatByPhone(phone)
        .then(success => {
          resp({ success });
        })
        .catch(err => {
          console.error('[WHL] Erro ao abrir chat:', err);
          resp({ success: false, error: err.message });
        });
      return true; // Indica que a resposta será assíncrona
    }

    // ===== RECOVER DOWNLOAD - Abre chat, vai até mensagem apagada e baixa item anterior =====
    if(msg.type === 'WHL_RECOVER_DOWNLOAD' && msg.payload) {
      const { chatId, messageId, timestamp, from, to } = msg.payload;
      
      (async () => {
        try {
          console.log('[WHL] 📥 Iniciando Recover Download para:', { chatId, messageId, from, to });
          
          // FIX: Extrair número do telefone de múltiplas fontes
          let phone = '';
          if (chatId) {
            phone = chatId.replace('@c.us', '').replace('@g.us', '').replace('@lid', '').replace('@s.whatsapp.net', '').replace(/\D/g, '');
          }
          if (!phone && from) {
            phone = String(from).replace(/\D/g, '');
          }
          if (!phone && to) {
            phone = String(to).replace(/\D/g, '');
          }
          
          if (!phone || phone.length < 10) {
            console.error('[WHL] ❌ Número de telefone inválido:', { chatId, from, to });
            resp({ success: false, error: 'Número de telefone inválido' });
            return;
          }
          
          console.log('[WHL] 📱 Navegando para chat:', phone);
          
          // 1. Abrir o chat - tentar múltiplas vezes se necessário
          let chatOpened = false;
          for (let attempt = 0; attempt < 3 && !chatOpened; attempt++) {
            chatOpened = await openChatByPhone(phone);
            if (!chatOpened) {
              console.log(`[WHL] Tentativa ${attempt + 1}/3 de abrir chat falhou, aguardando...`);
              await new Promise(r => setTimeout(r, 1000));
            }
          }
          
          if (!chatOpened) {
            console.error('[WHL] ❌ Não foi possível abrir o chat após 3 tentativas');
            resp({ success: false, error: 'Não foi possível abrir o chat. Verifique se o número está correto.' });
            return;
          }
          
          // FIX: Aguardar mais tempo para o chat carregar completamente
          await new Promise(r => setTimeout(r, 3000));
          
          // 2. Encontrar mensagem apagada no chat - tentar múltiplos seletores
          let deletedMsg = null;
          const deletedSelectors = [
            '[data-testid="recalled-msg"]',
            'span[data-icon="recalled"]',
            '[data-testid="msg-revoked"]',
            '.message-revoked',
            '[data-icon="status-deleted"]'
          ];
          
          for (const selector of deletedSelectors) {
            deletedMsg = document.querySelector(selector);
            if (deletedMsg) break;
          }
          
          // FIX: Se não encontrou por seletor, procurar por texto indicativo
          if (!deletedMsg) {
            const allMsgs = document.querySelectorAll('[data-id^="true_"], [data-id^="false_"]');
            for (const msgEl of allMsgs) {
              const text = msgEl.textContent || '';
              if (text.includes('Mensagem apagada') || text.includes('This message was deleted') || 
                  text.includes('mensagem foi apagada') || text.includes('Aguardando esta mensagem')) {
                deletedMsg = msgEl;
                break;
              }
            }
          }
          
          if (!deletedMsg) {
            console.log('[WHL] ⚠️ Nenhuma mensagem apagada encontrada neste chat');
            // FIX: Tentar scroll para cima para encontrar mensagens mais antigas
            const mainPanel = document.querySelector('#main [role="application"]') ||
                             document.querySelector('[data-testid="conversation-panel-messages"]');
            if (mainPanel) {
              console.log('[WHL] 🔄 Tentando scroll para encontrar mensagem apagada...');
              for (let i = 0; i < 5; i++) {
                mainPanel.scrollTop -= 500;
                await new Promise(r => setTimeout(r, 500));
                
                for (const selector of deletedSelectors) {
                  deletedMsg = document.querySelector(selector);
                  if (deletedMsg) break;
                }
                if (deletedMsg) break;
              }
            }
          }
          
          if (!deletedMsg) {
            console.log('[WHL] ⚠️ Mensagem apagada não encontrada após scroll');
            resp({ success: false, error: 'Mensagem apagada não encontrada neste chat' });
            return;
          }
          
          console.log('[WHL] ✅ Mensagem apagada encontrada');
          
          // 3. Encontrar posição da mensagem apagada
          const deletedRect = deletedMsg.getBoundingClientRect();
          const allRows = Array.from(document.querySelectorAll('[data-id^="true_"], [data-id^="false_"]'));
          
          // Ordenar por posição Y
          allRows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
          
          // Encontrar índice mais próximo
          let closestIdx = -1;
          let closestDistance = Infinity;
          
          allRows.forEach((row, idx) => {
            const rowRect = row.getBoundingClientRect();
            const distance = Math.abs(deletedRect.top - rowRect.top);
            if (distance < closestDistance) {
              closestDistance = distance;
              closestIdx = idx;
            }
          });
          
          console.log('[WHL] Índice da mensagem apagada:', closestIdx, 'de', allRows.length);
          
          // 4. Pegar o row ANTERIOR (item a ser baixado)
          if (closestIdx > 0) {
            const prevRow = allRows[closestIdx - 1];
            console.log('[WHL] 📥 Row anterior para download:', prevRow.getAttribute('data-id'));
            
            // Scroll até o item
            prevRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Destacar visualmente
            prevRow.style.border = '3px solid #fbbf24';
            prevRow.style.background = 'rgba(251, 191, 36, 0.2)';
            
            // 5. Detectar tipo de conteúdo e baixar apropriadamente
            const hasImg = prevRow.querySelector('img[src^="blob:"]');
            const hasVideo = prevRow.querySelector('video');
            const hasAudio = prevRow.querySelector('span[data-icon="audio-play"]') || 
                            prevRow.querySelector('span[data-icon="audio-file"]');
            const hasDoc = prevRow.querySelector('span[data-icon*="document-"]') ||
                          prevRow.querySelector('[data-testid*="document"]');
            const hasText = prevRow.querySelector('.selectable-text, [data-testid="msg-text"]');
            
            let downloaded = false;
            
            // === IMAGEM ===
            if (hasImg && !downloaded) {
              console.log('[WHL] 🖼️ Tipo: IMAGEM - abrindo preview...');
              hasImg.click();
              await new Promise(r => setTimeout(r, 1500));
              
              const downloadBtn = document.querySelector('span[data-icon="ic-download"]')?.closest('div[role="button"]') ||
                                 document.querySelector('span[data-icon="ic-download"]')?.parentElement;
              
              if (downloadBtn) {
                downloadBtn.click();
                console.log('[WHL] ✅ Download de imagem iniciado!');
                downloaded = true;
                
                await new Promise(r => setTimeout(r, 2000));
                const closeBtn = document.querySelector('span[data-icon="ic-close"]')?.closest('div[role="button"]') ||
                                document.querySelector('span[data-icon="ic-close"]')?.parentElement;
                if (closeBtn) closeBtn.click();
              }
            }
            
            // === VÍDEO ===
            if (hasVideo && !downloaded) {
              console.log('[WHL] 🎬 Tipo: VÍDEO - abrindo preview...');
              hasVideo.click();
              await new Promise(r => setTimeout(r, 1500));
              
              const downloadBtn = document.querySelector('span[data-icon="ic-download"]')?.closest('div[role="button"]') ||
                                 document.querySelector('span[data-icon="ic-download"]')?.parentElement;
              
              if (downloadBtn) {
                downloadBtn.click();
                console.log('[WHL] ✅ Download de vídeo iniciado!');
                downloaded = true;
                
                await new Promise(r => setTimeout(r, 2000));
                const closeBtn = document.querySelector('span[data-icon="ic-close"]')?.closest('div[role="button"]') ||
                                document.querySelector('span[data-icon="ic-close"]')?.parentElement;
                if (closeBtn) closeBtn.click();
              }
            }
            
            // === ÁUDIO ===
            if (hasAudio && !downloaded) {
              console.log('[WHL] 🎤 Tipo: ÁUDIO - procurando link de download...');
              
              // Método 1: Link escondido com download
              const audioLink = prevRow.querySelector('a[download][href^="blob:"]');
              if (audioLink) {
                const a = document.createElement('a');
                a.href = audioLink.href;
                a.download = audioLink.download || 'audio.ogg';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                console.log('[WHL] ✅ Download de áudio iniciado!');
                downloaded = true;
              }
              
              // Método 2: Botão audio-download
              if (!downloaded) {
                const audioDownload = prevRow.querySelector('span[data-icon="audio-download"]')?.parentElement;
                if (audioDownload) {
                  audioDownload.click();
                  console.log('[WHL] ✅ Download de áudio via botão!');
                  downloaded = true;
                }
              }
            }
            
            // === DOCUMENTO ===
            if (hasDoc && !downloaded) {
              console.log('[WHL] 📄 Tipo: DOCUMENTO - procurando download...');
              
              // Procurar botão de download no documento
              const docDownload = prevRow.querySelector('span[data-icon="audio-download"]')?.parentElement ||
                                 prevRow.querySelector('span[data-icon*="download"]')?.parentElement;
              
              if (docDownload) {
                docDownload.click();
                console.log('[WHL] ✅ Download de documento iniciado!');
                downloaded = true;
              } else {
                // Tentar clicar no documento para abrir
                const docClick = prevRow.querySelector('span[data-icon*="document-"]')?.closest('div[role="button"]') ||
                                hasDoc.closest('div[role="button"]');
                if (docClick) {
                  docClick.click();
                  console.log('[WHL] 📄 Documento clicado - verifique se abriu');
                  downloaded = true;
                }
              }
            }
            
            // === TEXTO (fallback) ===
            if (hasText && !downloaded) {
              console.log('[WHL] 📝 Tipo: TEXTO - copiando conteúdo...');
              const textContent = hasText.textContent || '';
              
              // Copiar para clipboard
              try {
                await navigator.clipboard.writeText(textContent);
                console.log('[WHL] ✅ Texto copiado para área de transferência!');
                downloaded = true;
              } catch (e) {
                // Fallback: baixar como arquivo
                const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `mensagem_${Date.now()}.txt`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                console.log('[WHL] ✅ Texto baixado como arquivo!');
                downloaded = true;
              }
            }
            
            if (!downloaded) {
              console.log('[WHL] ⚠️ Não foi possível identificar o tipo de conteúdo');
            }
            
            // Remover destaque após 5 segundos
            setTimeout(() => {
              prevRow.style.border = '';
              prevRow.style.background = '';
            }, 5000);
            
            resp({ success: downloaded });
          } else {
            console.log('[WHL] ⚠️ Não há mensagem anterior para baixar');
            resp({ success: false, error: 'Sem mensagem anterior' });
          }
          
        } catch (err) {
          console.error('[WHL] ❌ Erro no Recover Download:', err);
          resp({ success: false, error: err.message });
        }
      })();
      
      return true;
    }

    // ===== ENVIAR TEXTO DIRETO PARA NÚMERO =====
    if(msg.type === 'WHL_SEND_TEXT_DIRECT' && msg.phone && msg.message) {
      (async () => {
        try {
          console.log('[WHL] 📤 Enviando texto para:', msg.phone);

          // 0. Tentar envio via API interna (mais confiável para números fora da lista de chats)
          try {
            const phoneClean = String(msg.phone).replace(/\D/g, '');
            const requestId = `whl_direct_${Date.now()}_${Math.random().toString(16).slice(2)}`;

            const apiResult = await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                window.removeEventListener('message', onMessage);
                resolve({ success: false, error: 'timeout' });
              }, 25000);

              function onMessage(event) {
                if (event.source !== window) return;
                const data = event.data || {};
                if (data.type === 'WHL_SEND_MESSAGE_API_RESULT' && data.requestId === requestId) {
                  clearTimeout(timeout);
                  window.removeEventListener('message', onMessage);
                  resolve({ success: !!data.success, error: data.error });
                }
              }

              window.addEventListener('message', onMessage);
              window.postMessage({
                type: 'WHL_SEND_MESSAGE_API',
                phone: phoneClean,
                message: msg.message,
                requestId
              }, window.location.origin);
            });

            if (apiResult?.success) {
              console.log('[WHL] ✅ Enviado via API interna');
              resp({ success: true });
              return;
            } else {
              console.warn('[WHL] ⚠️ API interna falhou, fallback DOM:', apiResult?.error);
            }
          } catch (apiErr) {
            console.warn('[WHL] ⚠️ Erro ao tentar API interna, fallback DOM:', apiErr);
          }
          
          // 1. Abrir o chat
          const success = await openChatByPhone(msg.phone);
          if (!success) {
            resp({ success: false, error: 'Não foi possível abrir o chat' });
            return;
          }
          
          await new Promise(r => setTimeout(r, 1500));
          
          // 2. Encontrar o campo de texto
          const composer = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                          document.querySelector('footer div[contenteditable="true"]') ||
                          document.querySelector('div[contenteditable="true"][data-tab="10"]');
          
          if (!composer) {
            resp({ success: false, error: 'Campo de texto não encontrado' });
            return;
          }
          
          // 3. Inserir o texto
          composer.focus();
          await new Promise(r => setTimeout(r, 100));
          
          // Limpar e inserir
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          document.execCommand('insertText', false, msg.message);
          composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
          
          await new Promise(r => setTimeout(r, 300));
          
          // 4. Clicar no botão enviar
          const sendBtn = document.querySelector('[data-testid="send"]') ||
                         document.querySelector('span[data-icon="send"]')?.closest('button') ||
                         document.querySelector('button[aria-label="Enviar"]');
          
          if (sendBtn) {
            sendBtn.click();
            console.log('[WHL] ✅ Mensagem enviada para:', msg.phone);
            await new Promise(r => setTimeout(r, 1000));
            resp({ success: true });
          } else {
            resp({ success: false, error: 'Botão enviar não encontrado' });
          }
          
        } catch (err) {
          console.error('[WHL] ❌ Erro ao enviar texto:', err);
          resp({ success: false, error: err.message });
        }
      })();
      
      return true;
    }
  });

  // ===== ONBOARDING HIGHLIGHT SYSTEM =====
  // Cria overlays no Top Panel para destacar botões durante o tutorial
  
  const ONBOARDING_OVERLAY_ID = 'whl-onboarding-overlay';
  
  function handleOnboardingHighlight(buttonIndex, show) {
    // Remove overlay existente
    const existingOverlay = document.getElementById(ONBOARDING_OVERLAY_ID);
    if (existingOverlay) {
      existingOverlay.remove();
    }
    
    // Se show é false ou buttonIndex é null, só remove
    if (!show || buttonIndex === null || buttonIndex === undefined) {
      // Restaurar opacidade dos botões
      document.querySelectorAll('.top-panel-tab').forEach(btn => {
        btn.style.opacity = '';
        btn.style.transform = '';
        btn.style.boxShadow = '';
        btn.style.zIndex = '';
      });
      return;
    }
    
    // Encontrar o botão no Top Panel
    const topPanel = document.getElementById('wa-extractor-top-panel');
    if (!topPanel) {
      console.log('[WHL] Top Panel não encontrado para highlight');
      return;
    }
    
    const buttons = topPanel.querySelectorAll('.top-panel-tab');
    if (buttonIndex >= buttons.length) {
      console.log('[WHL] Button index inválido:', buttonIndex);
      return;
    }
    
    const targetButton = buttons[buttonIndex];
    if (!targetButton) return;
    
    // Diminuir opacidade dos outros botões
    buttons.forEach((btn, i) => {
      if (i !== buttonIndex) {
        btn.style.opacity = '0.3';
        btn.style.transform = 'scale(0.95)';
      } else {
        btn.style.opacity = '1';
        btn.style.transform = 'scale(1.1)';
        btn.style.boxShadow = '0 0 20px rgba(139, 92, 246, 0.8), 0 0 40px rgba(139, 92, 246, 0.4)';
        btn.style.zIndex = '10';
      }
    });
    
    // Criar overlay com seta
    const rect = targetButton.getBoundingClientRect();
    
    // Calcular centro do botão
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    
    // Tamanhos dos elementos
    const ringPadding = 8;
    const glowPadding = 40;
    const arrowTopOffset = 12;
    
    const overlay = document.createElement('div');
    overlay.id = ONBOARDING_OVERLAY_ID;
    overlay.innerHTML = `
      <style>
        #${ONBOARDING_OVERLAY_ID} {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 999998;
        }
        
        .whl-highlight-ring {
          position: fixed;
          border: 3px solid #8b5cf6;
          border-radius: 12px;
          animation: whlRingPulse 1.5s ease-in-out infinite;
          box-shadow: 0 0 30px rgba(139, 92, 246, 0.6);
        }
        
        @keyframes whlRingPulse {
          0%, 100% { 
            opacity: 1; 
            box-shadow: 0 0 30px rgba(139, 92, 246, 0.6);
          }
          50% { 
            opacity: 0.8; 
            box-shadow: 0 0 50px rgba(139, 92, 246, 0.8);
          }
        }
        
        .whl-highlight-arrow-container {
          position: fixed;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        
        .whl-highlight-arrow-bounce {
          animation: whlArrowBounce 0.8s ease-in-out infinite;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        
        @keyframes whlArrowBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(8px); }
        }
        
        .whl-highlight-arrow-icon {
          font-size: 32px;
          filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.5));
          line-height: 1;
        }
        
        .whl-highlight-arrow-text {
          background: linear-gradient(135deg, #8b5cf6, #6366f1);
          color: white;
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 700;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          box-shadow: 0 4px 15px rgba(139, 92, 246, 0.5);
          white-space: nowrap;
        }
        
        .whl-highlight-glow {
          position: fixed;
          background: radial-gradient(circle, rgba(139, 92, 246, 0.4) 0%, transparent 70%);
          border-radius: 50%;
          animation: whlGlowPulse 2s ease-in-out infinite;
          pointer-events: none;
        }
        
        @keyframes whlGlowPulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      </style>
      
      <!-- Glow atrás do botão (centralizado) -->
      <div class="whl-highlight-glow" style="
        top: ${centerY - glowPadding}px;
        left: ${centerX - glowPadding}px;
        width: ${glowPadding * 2}px;
        height: ${glowPadding * 2}px;
      "></div>
      
      <!-- Anel de destaque (centralizado no botão) -->
      <div class="whl-highlight-ring" style="
        top: ${rect.top - ringPadding}px;
        left: ${rect.left - ringPadding}px;
        width: ${rect.width + (ringPadding * 2)}px;
        height: ${rect.height + (ringPadding * 2)}px;
      "></div>
      
      <!-- Seta com texto (centralizada abaixo do botão) -->
      <div class="whl-highlight-arrow-container" style="
        top: ${rect.bottom + arrowTopOffset}px;
        left: ${centerX}px;
        transform: translateX(-50%);
      ">
        <div class="whl-highlight-arrow-bounce">
          <div class="whl-highlight-arrow-icon">⬆️</div>
          <div class="whl-highlight-arrow-text">Clique aqui!</div>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    console.log('[WHL] Onboarding highlight ativo para botão:', buttonIndex, 'centerX:', centerX);
  }

  /**
   * Abre um chat pelo número de telefone usando a API interna do WhatsApp
   * Baseado em: Mapa de Seletores e API Interna WhatsApp Web v3
   * FIX: Adicionados métodos mais robustos para abrir chats que não estão visíveis
   */
  async function openChatByPhone(phone) {
    const cleanPhone = String(phone).replace(/\D/g, '');
    const chatId = cleanPhone.includes('@') ? cleanPhone : `${cleanPhone}@c.us`;

    console.log('[WHL] Abrindo chat:', chatId);

    // Método 0 (NOVO): WPP.chat.openChatFromId — quando o WPP global está
    // carregado, é o método mais estável em WA 2.3000.x. Tenta antes de tudo.
    try {
      if (window.WPP?.chat?.openChatFromId) {
        await window.WPP.chat.openChatFromId(chatId);
        await new Promise(r => setTimeout(r, 400));
        console.log('[WHL] ✅ Chat aberto via WPP.chat.openChatFromId');
        return true;
      }
    } catch (e) {
      console.warn('[WHL] Método 0 (WPP) falhou:', e?.message || e);
    }

    // Método 1: Usar WAWebCmd.openChatAt via Store
    if (window.Store?.Chat?.find && window.Store?.Cmd?.openChatAt) {
      try {
      const chat = await window.Store?.Chat?.find?.(chatId);
        if (chat) {
        await window.Store?.Cmd?.openChatAt?.(chat);
          console.log('[WHL] ✅ Chat aberto via Store.Cmd.openChatAt');
          return true;
        }
      } catch (e) {
        // Silencioso - tentar próximo método
      }
    }

    // Método 2: Usar WAWebChatCollection via require (Webpack)
    try {
      if (window.require) {
        const ChatCollection = window.require('WAWebChatCollection')?.ChatCollection;
        const Cmd = window.require('WAWebCmd');
        if (ChatCollection && Cmd?.openChatAt) {
          const chat = ChatCollection.get(chatId);
          if (chat) {
            await Cmd.openChatAt(chat);
            console.log('[WHL] ✅ Chat aberto via WAWebCmd.openChatAt');
            return true;
          }
        }
      }
    } catch (e) {
      // Módulos não disponíveis - tentar próximo método
    }

    // Método 3: Usar WAPI se disponível (biblioteca externa)
    if (window.WAPI?.openChatById) {
      try {
        await window.WAPI.openChatById(chatId);
        console.log('[WHL] ✅ Chat aberto via WAPI');
        return true;
      } catch (e) {
        // Falhou - tentar próximo método
      }
    }

    // Método 4: Clicar no contato na lista de chats (DOM).
    // Seletores atualizados para WA 2024-2026 — antes só tinha 3 e nenhum
    // pegava builds recentes onde data-testid e data-id sumiram da row.
    const chatSelectors = [
      '[data-testid="cell-frame-container"]',
      '[role="listitem"]',
      '[data-id]',
      'div[role="row"][tabindex]',
      '#pane-side div[role="listitem"]',
      'div[aria-label*="conversa" i]'
    ];
    
    for (const selector of chatSelectors) {
      const chatItems = document.querySelectorAll(selector);
      for (const chatItem of chatItems) {
        const dataId = chatItem.getAttribute('data-id') || '';
        const innerHTML = chatItem.innerHTML || '';
        if (dataId.includes(cleanPhone) || innerHTML.includes(cleanPhone)) {
          chatItem.click();
          console.log('[WHL] ✅ Chat aberto via clique no DOM');
          return true;
        }
      }
    }

    // FIX Método 5: Usar a busca interna do WhatsApp para encontrar e abrir o chat
    try {
      // Focar na caixa de busca
      const searchBox = document.querySelector('[data-testid="chat-list-search"]') ||
                       document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
                       document.querySelector('input[title*="Buscar"]') ||
                       document.querySelector('input[title*="Search"]');
      
      if (searchBox) {
        searchBox.focus();
        searchBox.click();
        
        // Limpar e digitar o número
        const editableDiv = document.querySelector('div[contenteditable="true"][data-tab="3"]');
        if (editableDiv) {
          editableDiv.innerHTML = '';
          editableDiv.textContent = cleanPhone;
          editableDiv.dispatchEvent(new InputEvent('input', { bubbles: true }));
          
          // Aguardar resultados
          await new Promise(r => setTimeout(r, 1500));
          
          // Clicar no primeiro resultado
          const firstResult = document.querySelector('[data-testid="cell-frame-container"]') ||
                             document.querySelector('[role="listitem"]');
          if (firstResult) {
            firstResult.click();
            console.log('[WHL] ✅ Chat aberto via busca');
            
            // Limpar a busca
            const clearBtn = document.querySelector('[data-testid="x-alt"]') ||
                            document.querySelector('span[data-icon="x-alt"]')?.parentElement;
            if (clearBtn) clearBtn.click();
            
            return true;
          }
        }
      }
    } catch (e) {
      console.warn('[WHL] Método 5 (busca) falhou:', e.message);
    }

    // FIX Método 6: Usar Store.Chat.getChat diretamente se disponível
    try {
      if (window.Store?.Chat?.getChat) {
      const chat = await window.Store?.Chat?.getChat?.(chatId);
        if (chat && window.Store?.Cmd?.openChatBottom) {
        await window.Store?.Cmd?.openChatBottom?.(chat);
          console.log('[WHL] ✅ Chat aberto via Store.Chat.getChat');
          return true;
        }
      }
    } catch (e) {
      // Silencioso
    }

    // Método 7 (NOVO, último recurso): mudar o location.hash. WA Web faz
    // roteamento via hash interno; alterar #/send?phone=... aciona o router
    // sem reload da página. Mais robusto que window.open(...) que abria nova
    // aba.
    try {
      window.location.hash = `#/send?phone=${cleanPhone}`;
      await new Promise(r => setTimeout(r, 2000));
      console.log('[WHL] ✅ Chat aberto via location.hash (#/send)');
      return true;
    } catch (e) {
      console.warn('[WHL] Método 7 (hash) falhou:', e?.message || e);
    }

    console.warn('[WHL] ❌ Nenhum método de abertura de chat funcionou');
    console.warn('[WHL] Dica: Verifique se o chat existe ou se o número está correto');
    return false;
  }

  // Iniciar extrator quando documento carregar
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',()=>WAExtractor.start());
  }else{
    WAExtractor.start();
  }

  const KEY = 'whl_campaign_state_v1';

  // Use centralized phone sanitization from phone-validator.js
  const sanitizePhone = window.WHL_PhoneValidator?.sanitizePhone || ((v) => String(v || '').replace(/\D/g, ''));
  const enc = (t) => encodeURIComponent(String(t || ''));
  const chatUrl = (phone, msg) => `https://web.whatsapp.com/send?phone=${phone}&text=${enc(msg)}`;

  let campaignInterval = null;

  async function getState() {
    const defaultState = {
      numbersText: '',
      message: '',
      queue: [],
      index: 0,
      openInNewTab: false,
      // Fusion UI: central overlay stays hidden by default (Top Panel + Side Panel are the UI)
      panelVisible: false,
      isRunning: false,
      isPaused: false,
      delayMin: 2,
      delayMax: 6,
      continueOnError: true,
      imageData: null,
      fileData: null,
      fileName: null,
      fileMimeType: null,
      audioData: null,
      audioFilename: null,
      audioMimeType: null,
      audioDuration: 0,
      retryMax: 0,
      scheduleAt: '',
      typingEffect: true,
      typingDelayMs: 35,
      urlNavigationInProgress: false,
      currentPhoneNumber: '',
      currentMessage: '',
      drafts: {},
      lastReport: null,
      selectorHealth: { ok: true, issues: [] },
      stats: { sent: 0, failed: 0, pending: 0 },
      useWorker: true  // NEW: Enable worker mode by default
    };
    
    const result = await safeChrome(() => chrome.storage.local.get([KEY]));
    if (!result) return defaultState;
    return result[KEY] || defaultState;
  }
  
  async function setState(next) {
    const result = safeChrome(() => chrome.storage.local.set({ [KEY]: next }));
    if (!result) return next;
    await result;
    
    // Item 3 & 21: Persist stats in chrome.storage and auto-sync with popup
    await syncStatsToStorage(next.stats);
    
    return next;
  }
  
  // Item 3 & 21: Sync stats to chrome.storage for popup consistency
  async function syncStatsToStorage(stats) {
    if (!stats) return;
    try {
      await safeChrome(() => chrome.storage.local.set({ 
        whl_stats: {
          sent: stats.sent || 0,
          pending: stats.pending || 0,
          success: stats.sent || 0, // success = sent for simplicity
          failed: stats.failed || 0
        }
      }));
    } catch (e) {
      console.warn('[WHL] Failed to sync stats:', e);
    }
  }
  
  // ========= ANTI-BAN INTEGRADO NO CONTENT.JS =========
  
  /**
   * Verifica se pode enviar mensagem agora (limite diário e horário comercial)
   */
  async function canSendMessageNow() {
    try {
      const data = await safeChrome(() => chrome.storage.local.get('whl_anti_ban_data'));
      const antiBan = data?.whl_anti_ban_data || { sentToday: 0, dailyLimit: 200, businessHoursOnly: false };
      
      // Verificar reset diário
      const today = new Date().toISOString().split('T')[0];
      if (antiBan.lastResetDate !== today) {
        antiBan.sentToday = 0;
        antiBan.lastResetDate = today;
        await safeChrome(() => chrome.storage.local.set({ whl_anti_ban_data: antiBan }));
      }
      
      // Verificar limite diário
      if (antiBan.sentToday >= antiBan.dailyLimit) {
        console.warn(`[WHL Anti-Ban] ⛔ Limite diário atingido: ${antiBan.sentToday}/${antiBan.dailyLimit}`);
        return {
          allowed: false,
          reason: 'daily_limit',
          message: `Limite diário atingido (${antiBan.sentToday}/${antiBan.dailyLimit}). Envios pausados.`
        };
      }
      
      // Verificar horário comercial (se ativado)
      if (antiBan.businessHoursOnly) {
        const hour = new Date().getHours();
        if (hour < 8 || hour >= 20) {
          console.warn(`[WHL Anti-Ban] ⛔ Fora do horário comercial: ${hour}h`);
          return {
            allowed: false,
            reason: 'business_hours',
            message: `Fora do horário comercial (8h-20h). Horário atual: ${hour}h`
          };
        }
      }
      
      return { allowed: true, current: antiBan.sentToday, limit: antiBan.dailyLimit };
    } catch (e) {
      console.warn('[WHL Anti-Ban] Erro ao verificar:', e);
      return { allowed: true }; // Em caso de erro, permitir envio
    }
  }
  
  /**
   * Calcula delay inteligente com variação gaussiana (simula comportamento humano)
   */
  function calculateSmartDelay(baseMin, baseMax) {
    // Converter para milissegundos se necessário
    const minMs = baseMin > 100 ? baseMin : baseMin * 1000;
    const maxMs = baseMax > 100 ? baseMax : baseMax * 1000;
    
    // Função gaussiana (Box-Muller transform)
    const gaussian = () => {
      let u = 0, v = 0;
      while (u === 0) u = Math.random();
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };
    
    // Calcular média e desvio padrão
    const mean = (minMs + maxMs) / 2;
    const stdDev = (maxMs - minMs) / 4;
    
    // Aplicar variação gaussiana
    let delay = mean + gaussian() * stdDev;
    
    // Pausas aleatórias humanas (10% de chance de pausa extra)
    if (Math.random() < 0.1) {
      const extraPause = Math.random() * 10000; // até 10 segundos extras
      delay += extraPause;
      console.log(`[WHL Anti-Ban] 🎲 Pausa humana extra: +${(extraPause/1000).toFixed(1)}s`);
    }
    
    // Garantir que está dentro dos limites (com margem de 50%)
    delay = Math.max(minMs, Math.min(maxMs * 1.5, delay));
    
    console.log(`[WHL Anti-Ban] ⏱️ Delay calculado: ${(delay/1000).toFixed(1)}s (base: ${baseMin}-${baseMax})`);
    return Math.round(delay);
  }
  
  // Verificar se pode enviar (limite diário não atingido)
  async function canSendAntiBan() {
    try {
      const data = await safeChrome(() => chrome.storage.local.get('whl_anti_ban_data'));
      const antiBan = data?.whl_anti_ban_data || { sentToday: 0, dailyLimit: 200, businessHoursOnly: false };
      
      // Verificar reset diário
      const today = new Date().toISOString().split('T')[0];
      if (antiBan.lastResetDate !== today) {
        antiBan.sentToday = 0;
        antiBan.lastResetDate = today;
        await safeChrome(() => chrome.storage.local.set({ whl_anti_ban_data: antiBan }));
      }
      
      // Verificar limite diário
      if (antiBan.sentToday >= (antiBan.dailyLimit || 200)) {
        console.warn(`[WHL Anti-Ban] ⛔ LIMITE DIÁRIO ATINGIDO: ${antiBan.sentToday}/${antiBan.dailyLimit}`);
        return {
          allowed: false,
          reason: 'daily_limit',
          message: `Limite diário atingido (${antiBan.sentToday}/${antiBan.dailyLimit || 200}). Campanha pausada para evitar ban.`,
          current: antiBan.sentToday,
          limit: antiBan.dailyLimit || 200
        };
      }
      
      // Verificar horário comercial (se ativado)
      if (antiBan.businessHoursOnly) {
