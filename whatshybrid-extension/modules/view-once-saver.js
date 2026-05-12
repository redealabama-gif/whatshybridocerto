/**
 * 👁️ View Once Saver v1.0 - Salvar mídias "Ver Uma Vez" antes da expiração
 *
 * Portado do WAIncognito e integrado com a infraestrutura WhatsHybrid Pro.
 * Intercepta mensagens "view once" (foto/vídeo/áudio que somem após ver),
 * baixa o conteúdo via WAWebDownloadManager e salva em IndexedDB para
 * exibição posterior no painel Recover.
 *
 * Funciona como hook sobre wpp-hooks.js — deve ser carregado depois dele.
 *
 * @version 1.0.0
 * @author WhatsHybrid Pro (baseado em WAIncognito by tomer8007)
 */

(function () {
  'use strict';

  if (window.__WHL_VIEW_ONCE_SAVER__) return;
  window.__WHL_VIEW_ONCE_SAVER__ = true;

  const CONFIG_KEY = 'whl_view_once_saver_enabled';
  let enabled = localStorage.getItem(CONFIG_KEY) !== 'false'; // padrão: ativo

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[WHL ViewOnce]', ...args); }

  // ============================================================
  // BANCO DE DADOS IndexedDB
  // ============================================================

  const DB_NAME = 'whl_view_once';
  const DB_VERSION = 1;
  const STORE_NAME = 'msgs';
  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp_idx', 'timestamp');
          log('IndexedDB criado');
        }
      };

      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function saveToDB(record) {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const req = tx.objectStore(STORE_NAME).put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => {
        if (req.error?.name === 'ConstraintError') {
          log('Já salvo:', record.id);
          resolve(false);
        } else {
          reject(req.error);
        }
      };
    });
  }

  async function getAllFromDB() {
    if (!db) await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteFromDB(id) {
    if (!db) await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
    });
  }

  // ============================================================
  // UTILITÁRIOS
  // ============================================================

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function getMimeExt(mimetype) {
    if (!mimetype) return 'bin';
    const map = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/ogg; codecs=opus': 'ogg'
    };
    return map[mimetype] || mimetype.split('/')[1] || 'bin';
  }

  // ============================================================
  // DOWNLOAD DE MÍDIA VIEW ONCE
  // ============================================================

  /**
   * Tenta baixar a mídia usando WAWebDownloadManager (mesma abordagem do WAIncognito)
   * com fallback para Store.DownloadManager.
   */
  async function downloadViewOnceMidia(msg) {
    const messageId = msg?.id?.id || msg?.id?._serialized || String(Date.now());
    const mimetype = msg?.mimetype || '';
    const type = msg?.type || 'image';

    log('Baixando view-once:', messageId, 'tipo:', type);

    // Tentativa 1: WAWebDownloadManager via require()
    try {
      if (typeof require === 'function') {
        const dlMod = require('WAWebDownloadManager');
        const downloadManager = dlMod?.downloadManager || dlMod?.default?.downloadManager;
        if (downloadManager?.downloadAndMaybeDecrypt) {
          const mediaKeyEncoded = msg.mediaKey
            ? (typeof msg.mediaKey === 'string' ? msg.mediaKey : btoa(String.fromCharCode(...msg.mediaKey)))
            : null;
          const encFilehash = msg.encFilehash
            ? (typeof msg.encFilehash === 'string' ? msg.encFilehash : btoa(String.fromCharCode(...msg.encFilehash)))
            : null;
          const filehash = msg.filehash
            ? (typeof msg.filehash === 'string' ? msg.filehash : btoa(String.fromCharCode(...msg.filehash)))
            : null;

          if (mediaKeyEncoded && msg.directPath) {
            const decrypted = await downloadManager.downloadAndMaybeDecrypt({
              directPath: msg.directPath,
              encFilehash: encFilehash,
              filehash: filehash,
              mediaKey: mediaKeyEncoded,
              type: type,
              signal: (new AbortController()).signal
            });
            if (decrypted) {
              const base64 = arrayBufferToBase64(decrypted);
              log('✅ Download via WAWebDownloadManager:', messageId);
              return { base64, mimetype, type, ext: getMimeExt(mimetype) };
            }
          }
        }
      }
    } catch (e) {
      log('⚠️ WAWebDownloadManager falhou:', e.message);
    }

    // Tentativa 2: Store.DownloadManager
    try {
      if (window.Store?.DownloadManager?.downloadMedia) {
        const blob = await window.Store.DownloadManager.downloadMedia(msg);
        if (blob) {
          const ab = await blob.arrayBuffer();
          const base64 = arrayBufferToBase64(ab);
          log('✅ Download via Store.DownloadManager:', messageId);
          return { base64, mimetype: blob.type || mimetype, type, ext: getMimeExt(blob.type || mimetype) };
        }
      }
    } catch (e) {
      log('⚠️ Store.DownloadManager falhou:', e.message);
    }

    // Tentativa 3: URL direta se disponível
    try {
      const url = msg.url || msg.deprecatedMms3Url || msg.directPath;
      if (url && (url.startsWith('blob:') || url.startsWith('https://'))) {
        const res = await fetch(url);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          const base64 = arrayBufferToBase64(ab);
          log('✅ Download via fetch URL:', messageId);
          return { base64, mimetype, type, ext: getMimeExt(mimetype) };
        }
      }
    } catch (e) {
      log('⚠️ Fetch URL falhou:', e.message);
    }

    log('❌ Não foi possível baixar view-once:', messageId);
    return null;
  }

  // ============================================================
  // PROCESSAMENTO DA MENSAGEM VIEW ONCE
  // ============================================================

  async function processViewOnceMessage(msg) {
    if (!enabled) return;

    const messageId = msg?.id?.id || msg?.id?._serialized;
    if (!messageId) return;

    const isViewOnce = msg?.isViewOnce || msg?.viewOnce ||
      msg?.type === 'view_once' ||
      msg?._data?.type === 'view_once' ||
      msg?.viewOnceMessageV2 !== undefined ||
      msg?.viewOnceMessageV2Extension !== undefined;

    if (!isViewOnce) return;

    log('📨 Detectada mensagem view-once:', messageId);

    try {
      const mediaInfo = await downloadViewOnceMidia(msg);

      const from = msg?.from?._serialized || msg?.author?._serialized ||
        msg?.id?.remote?._serialized || 'desconhecido';
      const chatId = msg?.id?.remote?._serialized || msg?.chatId?._serialized || from;
      const caption = msg?.caption || msg?.text || '';

      const record = {
        id: messageId,
        chatId,
        from,
        caption,
        timestamp: Date.now(),
        originalTimestamp: (msg?.t || msg?.timestamp || Date.now()) * 1000,
        type: msg?.type || 'image',
        mimetype: msg?.mimetype || '',
        // Dados da mídia
        hasMedia: !!mediaInfo,
        mediaBase64: mediaInfo?.base64 || null,
        mediaMimetype: mediaInfo?.mimetype || msg?.mimetype || '',
        mediaExt: mediaInfo?.ext || 'bin',
        dataUri: mediaInfo ? `data:${mediaInfo.mimetype};base64,${mediaInfo.base64}` : null,
        // Preview/thumbnail se disponível
        thumbnailBase64: msg?.thumbnailData || msg?._data?.preview || null
      };

      const saved = await saveToDB(record);
      if (saved) {
        log('✅ View-once salvo:', messageId);

        // Notificar UI
        window.postMessage({
          type: 'WHL_VIEW_ONCE_SAVED',
          payload: { id: messageId, chatId, from, hasMedia: record.hasMedia, timestamp: record.timestamp }
        }, window.location.origin);

        // Integrar com Recover
        if (window.RecoverAdvanced?.registerMessageEvent) {
          window.RecoverAdvanced.registerMessageEvent(
            { id: messageId, key: messageId, action: 'view_once', body: caption || '[mídia: ver uma vez]', from, chatId, timestamp: record.timestamp, mediaType: record.type },
            'view_once',
            'whl_view_once'
          );
        }

        if (window.NotificationsModule?.toast) {
          window.NotificationsModule.toast('👁️ Mídia "ver uma vez" salva!', 'info', 3000);
        }
      }
    } catch (e) {
      console.error('[WHL ViewOnce] Erro ao processar view-once:', e);
    }
  }

  // ============================================================
  // HOOK NA CADEIA DE MENSAGENS DO WPP-HOOKS
  // ============================================================

  /**
   * Aguarda wpp-hooks estar pronto e hookar o processamento de mensagens
   * para detectar view-once antes de serem renderizadas.
   */
  function hookMessageProcessing() {
    // Método 1: Hook via postMessage quando nova mensagem é recebida
    window.addEventListener('message', (e) => {
      if (e.origin !== window.location.origin) return;
      const { type, payload } = e.data || {};
      if (type === 'WHL_MESSAGE_RECEIVED' && payload) {
        // Mensagem normal recebida - verificar se é view once
        // O payload do WHL_MESSAGE_RECEIVED não tem o objeto msg completo,
        // isso é tratado pelo hook direto abaixo
      }
    });

    // Método 2: Hook via require() do módulo de mensagens
    const tryHookModule = () => {
      try {
        if (typeof require !== 'function') return false;

        const processModule = (() => {
          try { return require('WAWebMessageProcessRenderable'); } catch { return null; }
        })();

        if (!processModule?.processRenderableMessages) return false;

        const original = processModule.processRenderableMessages;
        processModule.processRenderableMessages = function (...args) {
          const messages = args[0];
          if (Array.isArray(messages)) {
            messages.forEach(msg => {
              try { processViewOnceMessage(msg); } catch (e) { /* silent */ }
            });
          }
          return original.apply(this, args);
        };

        log('✅ Hook no processRenderableMessages instalado');
        return true;
      } catch (e) {
        return false;
      }
    };

    // Tentar hookear, com retry
    let attempts = 0;
    const interval = setInterval(() => {
      if (tryHookModule() || attempts++ > 50) {
        clearInterval(interval);
        if (attempts > 50) log('⚠️ Módulo de mensagens não encontrado, usando fallback DOM');
      }
    }, 200);
  }

  // ============================================================
  // OBSERVER DOM COMO FALLBACK
  // ============================================================

  // v9.4.5 BUG #122: armazena observer pra permitir disconnect futuro.
  // WA Web não destrói/recria JS context, mas defesa contra hot-reload em dev
  // ou casos onde algum outro módulo precise desativar o saver.
  let _viewOnceObserver = null;

  function disconnectViewOnceObserver() {
    if (_viewOnceObserver) {
      try { _viewOnceObserver.disconnect(); } catch (_) {}
      _viewOnceObserver = null;
    }
  }

  /**
   * Fallback: monitorar mudanças no DOM para detectar ícones de "ver uma vez"
   * e alertar o usuário que a mídia foi capturada (via RecoverDOM).
   */
  function hookViewOnceDOMFallback() {
    const VIEW_ONCE_SELECTORS = [
      '[data-testid="view-once-msg"]',
      '[data-testid="view-once-image"]',
      '[data-testid="view-once-video"]',
      'span[data-icon="view-once"]',
      'span[data-icon="view_once"]',
      '[data-testid="msg-view-once-button"]'
    ];

    // Disconnect anterior se houver — previne acumulação em hot-reload
    disconnectViewOnceObserver();

    _viewOnceObserver = new MutationObserver((mutations) => {
      if (!enabled) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          for (const sel of VIEW_ONCE_SELECTORS) {
            try {
              const found = node.matches?.(sel) ? [node] : [...(node.querySelectorAll?.(sel) || [])];
              if (found.length > 0) {
                log('👁️ Elemento view-once detectado via DOM (fallback)');
                if (window.NotificationsModule?.toast) {
                  window.NotificationsModule.toast(
                    '👁️ Mensagem "ver uma vez" detectada — captura automática em andamento',
                    'info', 4000
                  );
                }
              }
            } catch { /* seletor inválido */ }
          }
        }
      }
    });

    _viewOnceObserver.observe(document.body, { childList: true, subtree: true });
    log('Fallback DOM observer iniciado');
  }

  // ============================================================
  // PAINEL DE VISUALIZAÇÃO (injeção no Recover)
  // ============================================================

  /**
   * Renderiza as mídias view-once salvas para o painel do Recover.
   * Chamado pelo sidepanel quando abre a seção Recover.
   */
  async function getViewOnceSaved() {
    try {
      const records = await getAllFromDB();
      return records.sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.error('[WHL ViewOnce] Erro ao buscar registros:', e);
      return [];
    }
  }

  async function deleteViewOnceSaved(id) {
    return deleteFromDB(id);
  }

  // ============================================================
  // API PÚBLICA
  // ============================================================

  window.WHL_ViewOnceSaver = {
    enable() {
      enabled = true;
      localStorage.setItem(CONFIG_KEY, 'true');
      log('Ativado');
    },
    disable() {
      enabled = false;
      localStorage.setItem(CONFIG_KEY, 'false');
      log('Desativado');
    },
    toggle() {
      if (enabled) this.disable(); else this.enable();
      return enabled;
    },
    isEnabled: () => enabled,
    getSaved: getViewOnceSaved,
    deleteSaved: deleteViewOnceSaved,
    processMessage: processViewOnceMessage
  };

  // ============================================================
  // MENSAGENS DO SIDEPANEL
  // ============================================================

  window.addEventListener('message', async (e) => {
    if (e.origin !== window.location.origin) return;
    const { type } = e.data || {};

    if (type === 'WHL_GET_VIEW_ONCE_SAVED') {
      const records = await getViewOnceSaved();
      window.postMessage({ type: 'WHL_VIEW_ONCE_SAVED_LIST', records }, window.location.origin);
    }
    if (type === 'WHL_DELETE_VIEW_ONCE') {
      await deleteViewOnceSaved(e.data.id);
    }
    if (type === 'WHL_VIEW_ONCE_TOGGLE') {
      window.WHL_ViewOnceSaver.toggle();
    }
  });

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  async function init() {
    await openDB();
    hookMessageProcessing();
    hookViewOnceDOMFallback();
    console.log('[WHL ViewOnceSaver] ✅ Módulo v1.0 iniciado. Status:', enabled ? 'ATIVO' : 'INATIVO');
  }

  // Aguardar DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Delay para garantir que wpp-hooks já inicializou
    setTimeout(init, 1500);
  }
})();
