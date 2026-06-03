/**
 * WhatsHybrid Lite - WhatsApp Web Version Detector
 * 
 * Detecta a versão do WhatsApp Web e ajusta seletores automaticamente.
 * Mantém compatibilidade com múltiplas versões do WhatsApp Web.
 * 
 * @version 1.0.0
 * @author WhatsHybrid Team
 */

(function() {
  'use strict';

  // ============================================
  // CONSTANTES E CONFIGURAÇÕES
  // ============================================

  const VERSION_STORAGE_KEY = 'whl_whatsapp_version';
  const VERSION_CHECK_INTERVAL = 60000; // 1 minuto
  const VERSION_CACHE_DURATION = 3600000; // 1 hora

  // Histórico de versões conhecidas do WhatsApp Web
  // Atualizar conforme novas versões são lançadas
  const KNOWN_VERSIONS = {
    '2.3000': { released: '2024-01', breaking: false },
    '2.2400': { released: '2023-10', breaking: false },
    '2.2300': { released: '2023-06', breaking: true, notes: 'Mudança em seletores de compose' },
    '2.2200': { released: '2023-01', breaking: false },
    '2.2100': { released: '2022-06', breaking: true, notes: 'Nova arquitetura de chat' },
  };

  // Seletores por versão do WhatsApp Web
  // Quando uma versão quebra seletores, adicionar novos aqui
  const VERSION_SELECTORS = {
    // Versão mais recente (padrão)
    'latest': {
      MESSAGE_INPUT: [
        '[data-testid="conversation-compose-box-input"]',
        'footer div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[data-tab="10"]'
      ],
      SEND_BUTTON: [
        '[data-testid="send"]',
        '[data-testid="compose-btn-send"]',
        'button[aria-label="Enviar"]',
        'button[aria-label="Send"]',
        'span[data-icon="send"]',
        '[data-testid="send-button"]'
      ],
      ATTACH_BUTTON: [
        '[data-testid="attach-clip"]',
        '[data-testid="clip"]',
        'span[data-icon="attach-menu-plus"]',
        'span[data-icon="clip"]',
        '[aria-label="Anexar"]',
        '[aria-label="Attach"]'
      ],
      ATTACH_IMAGE: [
        '[data-testid="attach-image"]',
        '[data-testid="mi-attach-media"]',
        '[data-testid="attach-photo"]',
        'input[accept="image/*,video/mp4,video/3gpp,video/quicktime"]'
      ],
      CAPTION_INPUT: [
        '[data-testid="media-caption-input"]',
        '[data-testid="media-caption-input-container"] [contenteditable="true"]',
        'div[aria-label*="legenda"][contenteditable="true"]',
        'div[aria-label*="Legenda"][contenteditable="true"]',
        'div[aria-label*="caption"][contenteditable="true"]',
        'div[contenteditable="true"][data-lexical-editor="true"]'
      ],
      CHAT_LIST: [
        '#pane-side',
        '[data-testid="chat-list"]',
        'div[aria-label="Lista de conversas"]'
      ],
      CHAT_HEADER: [
        'header[data-testid="conversation-header"]',
        'header.pane-header',
        '[data-testid="conversation-info-header"]'
      ],
      SEARCH_INPUT: [
        '[data-testid="chat-list-search"]',
        'div[role="textbox"][data-tab="3"]',
        '[aria-label="Pesquisar ou começar uma nova conversa"]'
      ],
      ERROR_POPUP: [
        '[data-testid="popup-contents"]',
        '[data-testid="phone-invalid-popup"]',
        '[role="alert"]',
        '.popup-contents'
      ],
      MAIN_PANEL: [
        'div[data-testid="conversation-panel-wrapper"]',
        'div.pane-main',
        '#main'
      ]
    },

    // Versão 2.2300 (Junho 2023) - Mudanças em compose
    '2.2300': {
      MESSAGE_INPUT: [
        'div[data-tab="10"]',
        'footer div[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]'
      ],
      SEND_BUTTON: [
        'span[data-icon="send"]',
        '[data-testid="send"]',
        'button[aria-label="Enviar"]'
      ]
    },

    // Versão 2.2100 (Junho 2022) - Nova arquitetura
    '2.2100': {
      MESSAGE_INPUT: [
        'div[contenteditable="true"][data-tab="1"]',
        'footer div[contenteditable="true"]'
      ],
      CHAT_LIST: [
        '#pane-side',
        'div[aria-label="Chat list"]'
      ]
    }
  };

  // Fingerprints para detecção de versão
  // Cada fingerprint é um seletor único de uma versão específica
  const VERSION_FINGERPRINTS = [
    {
      version: '2.3000+',
      selectors: [
        '[data-testid="conversation-compose-box-input"]',
        '[data-testid="chat-list-search"]'
      ],
      minMatches: 2
    },
    {
      version: '2.2300-2.2999',
      selectors: [
        'div[data-tab="10"]',
        '[data-testid="send"]'
      ],
      minMatches: 1
    },
    {
      version: '2.2100-2.2299',
      selectors: [
        'div[data-tab="1"]',
        '#pane-side'
      ],
      minMatches: 1
    },
    {
      version: 'legacy',
      selectors: [
        'footer div[contenteditable="true"]'
      ],
      minMatches: 1
    }
  ];

  // ============================================
  // ESTADO DO MÓDULO
  // ============================================

  const state = {
    initialized: false,
    currentVersion: null,
    detectedAt: null,
    webpackVersion: null,
    buildHash: null,
    activeSelectors: null,
    checkInterval: null,
    lastCheck: null,
    selectorHealth: {
      working: [],
      broken: [],
      lastTest: null
    },
    listeners: []
  };

  // ============================================
  // DETECÇÃO DE VERSÃO
  // ============================================

  /**
   * Detecta a versão do WhatsApp Web usando múltiplos métodos
   * @returns {Object} Informações de versão detectadas
   */
  async function detectVersion() {
    console.log('[WHL Version] 🔍 Iniciando detecção de versão...');

    const detection = {
      version: null,
      method: null,
      confidence: 0,
      details: {}
    };

    // Método 1: Tentar via webpack modules (mais preciso)
    const webpackVersion = await detectViaWebpack();
    if (webpackVersion) {
      detection.version = webpackVersion.version;
      detection.method = 'webpack';
      detection.confidence = 95;
      detection.details.webpack = webpackVersion;
      state.webpackVersion = webpackVersion.version;
      state.buildHash = webpackVersion.buildHash;
    }

    // Método 2: Via meta tags e scripts
    if (!detection.version) {
      const metaVersion = detectViaMeta();
      if (metaVersion) {
        detection.version = metaVersion.version;
        detection.method = 'meta';
        detection.confidence = 80;
        detection.details.meta = metaVersion;
      }
    }

    // Método 3: Via fingerprints de DOM (fallback)
    if (!detection.version) {
      const fingerprintVersion = await detectViaFingerprints();
      if (fingerprintVersion) {
        detection.version = fingerprintVersion.version;
        detection.method = 'fingerprint';
        detection.confidence = 60;
        detection.details.fingerprint = fingerprintVersion;
      }
    }

    // Método 4: Via localStorage do WhatsApp (backup)
    if (!detection.version) {
      const storageVersion = detectViaStorage();
      if (storageVersion) {
        detection.version = storageVersion.version;
        detection.method = 'storage';
        detection.confidence = 50;
        detection.details.storage = storageVersion;
      }
    }

    // Fallback final
    if (!detection.version) {
      detection.version = 'unknown';
      detection.method = 'fallback';
      detection.confidence = 0;
    }

    // Atualizar estado
    state.currentVersion = detection.version;
    state.detectedAt = Date.now();
    state.lastCheck = Date.now();

    // Selecionar seletores apropriados
    selectActiveSelectors(detection.version);

    // Persistir versão detectada
    await saveVersionInfo(detection);

    // Notificar listeners
    notifyVersionChange(detection);

    console.log(`[WHL Version] ✅ Versão detectada: ${detection.version} (${detection.method}, ${detection.confidence}% confiança)`);

    return detection;
  }

  /**
   * Detecta versão via módulos webpack do WhatsApp
   */
  async function detectViaWebpack() {
    try {
      // Tentar acessar webpack chunk
      if (window.webpackChunkwhatsapp_web_client) {
        const req = window.webpackChunkwhatsapp_web_client.push([
          ['__whl_version'], {}, (r) => r
        ]);

        if (req && req.c) {
          // Procurar módulo com informações de versão
          for (const id of Object.keys(req.c)) {
            const mod = req.c[id]?.exports;
            if (!mod) continue;

            // Procurar por strings de versão
            const modStr = JSON.stringify(mod).substring(0, 10000);
            
            // Padrão de versão do WhatsApp: 2.XXXX.X
            const versionMatch = modStr.match(/["'](\d\.\d{4}\.\d+)["']/);
            if (versionMatch) {
              return {
                version: versionMatch[1],
                buildHash: extractBuildHash(modStr),
                moduleId: id
              };
            }
          }
        }
      }

      // Tentar via require direto
      try {
        const BuildInfo = require?.('WABuildConstants') || require?.('WAWebBuildConstants');
        if (BuildInfo) {
          return {
            version: BuildInfo.VERSION || BuildInfo.version,
            buildHash: BuildInfo.BUILD_HASH || BuildInfo.buildHash
          };
        }
      } catch (e) {
        // Módulo não existe
      }

    } catch (e) {
      console.warn('[WHL Version] Erro ao detectar via webpack:', e.message);
    }

    return null;
  }

  /**
   * Detecta versão via meta tags e scripts da página
   */
  function detectViaMeta() {
    try {
      // Procurar em meta tags
      const metas = document.querySelectorAll('meta');
      for (const meta of metas) {
        const content = meta.getAttribute('content') || '';
        const versionMatch = content.match(/(\d\.\d{4}\.\d+)/);
        if (versionMatch) {
          return { version: versionMatch[1], source: 'meta' };
        }
      }

      // Procurar em scripts
      const scripts = document.querySelectorAll('script[src]');
      for (const script of scripts) {
        const src = script.getAttribute('src') || '';
        // WhatsApp usa hashes em nomes de arquivos
        const hashMatch = src.match(/([a-f0-9]{8,})/i);
        if (hashMatch && src.includes('whatsapp')) {
          return { version: `build-${hashMatch[1].substring(0, 8)}`, source: 'script' };
        }
      }

      // Procurar no HTML
      const html = document.documentElement.outerHTML.substring(0, 50000);
      const htmlVersionMatch = html.match(/version["':]+\s*["']?(\d\.\d{4}\.\d+)/i);
      if (htmlVersionMatch) {
        return { version: htmlVersionMatch[1], source: 'html' };
      }

    } catch (e) {
      console.warn('[WHL Version] Erro ao detectar via meta:', e.message);
    }

    return null;
  }

  /**
   * Detecta versão via fingerprints de DOM
   */
  async function detectViaFingerprints() {
    try {
      // Aguardar DOM carregar
      await waitForDOM();

      for (const fp of VERSION_FINGERPRINTS) {
        let matches = 0;
        
        for (const selector of fp.selectors) {
          try {
            if (document.querySelector(selector)) {
              matches++;
            }
          } catch (e) {
            // Seletor inválido
          }
        }

        if (matches >= fp.minMatches) {
          return {
            version: fp.version,
            matches: matches,
            totalSelectors: fp.selectors.length
          };
        }
      }

    } catch (e) {
      console.warn('[WHL Version] Erro ao detectar via fingerprints:', e.message);
    }

    return null;
  }

  /**
   * Detecta versão via localStorage do WhatsApp
   */
  function detectViaStorage() {
    try {
      // Procurar chaves do WhatsApp no localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('whatsapp') || key.includes('WA'))) {
          try {
            const value = localStorage.getItem(key);
            const versionMatch = value?.match(/(\d\.\d{4}\.\d+)/);
            if (versionMatch) {
              return { version: versionMatch[1], source: key };
            }
          } catch (e) {
            // Erro ao ler valor
          }
        }
      }

      // Verificar IndexedDB
      // Nota: Acesso assíncrono, implementar se necessário

    } catch (e) {
      console.warn('[WHL Version] Erro ao detectar via storage:', e.message);
    }

    return null;
  }

  // ============================================
  // GESTÃO DE SELETORES
  // ============================================

  /**
   * Seleciona os seletores ativos baseado na versão detectada
   * @param {string} version - Versão detectada
   */
  function selectActiveSelectors(version) {
    // Começar com seletores mais recentes
    let selectors = { ...VERSION_SELECTORS['latest'] };

    // Aplicar overrides de versões específicas
    const majorVersion = extractMajorVersion(version);
    
    if (VERSION_SELECTORS[majorVersion]) {
      selectors = mergeSelectors(selectors, VERSION_SELECTORS[majorVersion]);
    }

    // Verificar versões próximas
    for (const [ver, verSelectors] of Object.entries(VERSION_SELECTORS)) {
      if (ver !== 'latest' && isVersionInRange(version, ver)) {
        selectors = mergeSelectors(selectors, verSelectors);
      }
    }

    state.activeSelectors = selectors;

    // Atualizar WHL_CONSTANTS global
    if (window.WHL_CONSTANTS) {
      window.WHL_CONSTANTS.WHL_SELECTORS = selectors;
    }

    console.log('[WHL Version] 📋 Seletores atualizados para versão:', version);
  }

  /**
   * Mescla dois conjuntos de seletores, priorizando o segundo
   */
  function mergeSelectors(base, override) {
    const merged = { ...base };
    
    for (const [key, selectors] of Object.entries(override)) {
      if (Array.isArray(selectors)) {
        // Adicionar novos seletores no início (prioridade)
        merged[key] = [...new Set([...selectors, ...(base[key] || [])])];
      }
    }

    return merged;
  }

  /**
   * Testa a saúde dos seletores atuais
   * @returns {Object} Resultado do teste
   */
  async function testSelectorHealth() {
    // Modo silencioso - não logar sempre
    const SILENT_MODE = true;

    const results = {
      working: [],
      broken: [],
      timestamp: Date.now()
    };

    const selectors = state.activeSelectors || VERSION_SELECTORS['latest'];

    for (const [name, selectorList] of Object.entries(selectors)) {
      let found = false;

      for (const selector of selectorList) {
        try {
          const element = document.querySelector(selector);
          if (element) {
            results.working.push({
              name,
              selector,
              element: element.tagName
            });
            found = true;
            break;
          }
        } catch (e) {
          // Seletor inválido
        }
      }

      if (!found) {
        results.broken.push({
          name,
          selectors: selectorList
        });
      }
    }

    state.selectorHealth = results;

    // Só alertar se crítico (menos de 50%) e não em modo silencioso
    const brokenCount = results.broken.length;
    const totalCount = Object.keys(selectors).length;
    const healthPercent = Math.round((1 - brokenCount / totalCount) * 100);

    if (healthPercent < 50 && !SILENT_MODE) {
      console.warn(`[WHL Version] ⚠️ Saúde dos seletores crítica: ${healthPercent}%`);
      notifySelectorHealthIssue(results);
    }
    // Não logar mais nada - reduzir ruído no console

    return results;
  }

  /**
   * Obtém o melhor seletor funcional para um elemento
   * @param {string} name - Nome do elemento (ex: 'MESSAGE_INPUT')
   * @returns {string|null} - Seletor funcional ou null
   */
  function getWorkingSelector(name) {
    const selectors = state.activeSelectors || VERSION_SELECTORS['latest'];
    const selectorList = selectors[name];

    if (!selectorList) return null;

    for (const selector of selectorList) {
      try {
        if (document.querySelector(selector)) {
          return selector;
        }
      } catch (e) {
        // Seletor inválido
      }
    }

    return null;
  }

  /**
   * Obtém elemento usando seletores adaptativos
   * @param {string} name - Nome do elemento
   * @returns {Element|null}
   */
  function getElement(name) {
    const selectors = state.activeSelectors || VERSION_SELECTORS['latest'];
    const selectorList = selectors[name];

    if (!selectorList) {
      console.warn(`[WHL Version] Seletor desconhecido: ${name}`);
      return null;
    }

    for (const selector of selectorList) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          return element;
        }
      } catch (e) {
        // Seletor inválido
      }
    }

    // Log se nenhum seletor funcionou
    if (window.whlLog) {
      window.whlLog.warn(`[WHL Version] Nenhum seletor funcionou para: ${name}`);
    }

    return null;
  }

  // ============================================
  // UTILITÁRIOS
  // ============================================

  /**
   * Aguarda o DOM do WhatsApp carregar
   */
  function waitForDOM() {
    return new Promise((resolve) => {
      const check = () => {
        if (document.querySelector('#pane-side') || document.querySelector('[data-testid="chat-list"]')) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      };
      check();
    });
  }

  /**
   * Extrai versão major (ex: "2.2300" de "2.2300.15")
   */
  function extractMajorVersion(version) {
    if (!version) return null;
    const match = version.match(/^(\d\.\d{4})/);
    return match ? match[1] : null;
  }

  /**
   * Extrai build hash de uma string
   */
  function extractBuildHash(str) {
    const match = str.match(/[a-f0-9]{32,}/i);
    return match ? match[0].substring(0, 12) : null;
  }

  /**
   * Verifica se uma versão está em um range
   */
  function isVersionInRange(version, targetVersion) {
    if (!version || !targetVersion) return false;
    
    const vMajor = extractMajorVersion(version);
    const tMajor = extractMajorVersion(targetVersion);
    
    if (!vMajor || !tMajor) return false;
    
    // Comparação simples de versão
    const v = parseFloat(vMajor.replace('.', ''));
    const t = parseFloat(tMajor.replace('.', ''));
    
    return Math.abs(v - t) < 100; // Dentro de 100 versões
  }

  /**
   * Salva informações de versão no storage
   */
  async function saveVersionInfo(detection) {
    try {
      const data = {
        version: detection.version,
        method: detection.method,
        confidence: detection.confidence,
        detectedAt: Date.now(),
        details: detection.details
      };

      await chrome.storage.local.set({ [VERSION_STORAGE_KEY]: data });
    } catch (e) {
      console.warn('[WHL Version] Erro ao salvar versão:', e.message);
    }
  }

  /**
   * Carrega informações de versão do storage
   */
  async function loadVersionInfo() {
    try {
      const result = await chrome.storage.local.get(VERSION_STORAGE_KEY);
      return result[VERSION_STORAGE_KEY] || null;
    } catch (e) {
      return null;
    }
  }

  // ============================================
  // SISTEMA DE EVENTOS
  // ============================================

  /**
   * Registra listener para mudanças de versão
   * @param {Function} callback - Função a ser chamada
   */
  function onVersionChange(callback) {
    if (typeof callback === 'function') {
      state.listeners.push(callback);
    }
  }

  /**
   * Remove listener
   * @param {Function} callback - Função a ser removida
   */
  function offVersionChange(callback) {
    const index = state.listeners.indexOf(callback);
    if (index > -1) {
      state.listeners.splice(index, 1);
    }
  }

  /**
   * Notifica listeners sobre mudança de versão
   */
  function notifyVersionChange(detection) {
    for (const listener of state.listeners) {
      try {
        listener(detection);
      } catch (e) {
        console.error('[WHL Version] Erro em listener:', e);
      }
    }

    // Emitir evento global
    if (window.EventBus) {
      window.EventBus.emit('WHL_VERSION_DETECTED', detection);
    }

    // Evento DOM customizado
    window.dispatchEvent(new CustomEvent('whl-version-change', {
      detail: detection
    }));
  }

  /**
   * Notifica sobre problemas de saúde de seletores
   */
  function notifySelectorHealthIssue(results) {
    // Emitir evento
    window.dispatchEvent(new CustomEvent('whl-selector-health-issue', {
      detail: results
    }));

    // Log detalhado
    console.group('[WHL Version] ⚠️ Seletores com problemas:');
    for (const broken of results.broken) {
      console.warn(`- ${broken.name}:`, broken.selectors);
    }
    console.groupEnd();
  }

  // ============================================
  // MONITORAMENTO CONTÍNUO
  // ============================================

  /**
   * Inicia monitoramento de versão
   */
  function startMonitoring() {
    if (state.checkInterval) {
      clearInterval(state.checkInterval);
    }

    state.checkInterval = setInterval(async () => {
      // Verificar se versão mudou
      const cached = await loadVersionInfo();
      
      if (!cached || Date.now() - cached.detectedAt > VERSION_CACHE_DURATION) {
        console.log('[WHL Version] 🔄 Verificando atualizações de versão...');
        await detectVersion();
        await testSelectorHealth();
      }
    }, VERSION_CHECK_INTERVAL);

    console.log('[WHL Version] 👁️ Monitoramento iniciado');
  }

  /**
   * Para monitoramento
   */
  function stopMonitoring() {
    if (state.checkInterval) {
      clearInterval(state.checkInterval);
      state.checkInterval = null;
      console.log('[WHL Version] 🛑 Monitoramento parado');
    }
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  /**
   * Inicializa o módulo de detecção de versão
   */
  async function init() {
    if (state.initialized) {
      console.log('[WHL Version] ⚠️ Já inicializado');
      return state;
    }

    console.log('[WHL Version] 🚀 Inicializando detector de versão...');

    // Tentar carregar versão em cache
    const cached = await loadVersionInfo();
    
    if (cached && Date.now() - cached.detectedAt < VERSION_CACHE_DURATION) {
      console.log('[WHL Version] 📦 Usando versão em cache:', cached.version);
      state.currentVersion = cached.version;
      state.detectedAt = cached.detectedAt;
      selectActiveSelectors(cached.version);
    } else {
      // Detectar nova versão
      await detectVersion();
    }

    // Testar saúde dos seletores
    await testSelectorHealth();

    // Iniciar monitoramento
    startMonitoring();

    state.initialized = true;
    console.log('[WHL Version] ✅ Detector de versão inicializado');

    return state;
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  const VersionDetector = {
    // Inicialização
    init,

    // Detecção
    detectVersion,
    getVersion: () => state.currentVersion,
    getVersionInfo: () => ({
      version: state.currentVersion,
      detectedAt: state.detectedAt,
      webpackVersion: state.webpackVersion,
      buildHash: state.buildHash
    }),

    // Seletores
    getActiveSelectors: () => state.activeSelectors,
    getElement,
    getWorkingSelector,
    testSelectorHealth,
    getSelectorHealth: () => state.selectorHealth,

    // Eventos
    onVersionChange,
    offVersionChange,

    // Monitoramento
    startMonitoring,
    stopMonitoring,

    // Utilitários
    isVersionKnown: (version) => !!KNOWN_VERSIONS[extractMajorVersion(version)],
    getKnownVersions: () => Object.keys(KNOWN_VERSIONS),
    
    // Estado
    getState: () => ({ ...state }),
    isInitialized: () => state.initialized,

    // Constantes
    VERSION_SELECTORS,
    KNOWN_VERSIONS
  };

  // Expor globalmente
  window.WHL_VersionDetector = VersionDetector;

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    stopMonitoring();
  });

  // Auto-inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Delay para garantir que WhatsApp carregou
      setTimeout(init, 2000);
    });
  } else {
    setTimeout(init, 2000);
  }

  console.log('[WHL Version] 📦 Módulo carregado');

})(); // End IIFE
