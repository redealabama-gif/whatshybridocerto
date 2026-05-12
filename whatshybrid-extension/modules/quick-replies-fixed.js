/**
 * ⚡ Quick Replies - Sistema de Respostas Rápidas (CORRIGIDO)
 * Baseado no projeto funcional CERTO-WHATSAPPLITE
 *
 * Funciona digitando / seguido do gatilho no chat.
 * Exemplo: /oi → "Olá! Como posso ajudar?"
 *
 * @version 2.0.0 - CORRIGIDO
 */

(function() {
  'use strict';

  if (window.__WHL_QUICK_REPLIES_FIXED__) return;
  window.__WHL_QUICK_REPLIES_FIXED__ = true;

  // ✅ Usar o mesmo storage do gerenciador do painel lateral (compatibilidade)
  // V3 é a fonte de verdade (mesmo key usado no painel lateral de Resposta Rápida)
  const STORAGE_KEY = 'whl_quick_replies_v3';
  const LEGACY_KEYS = ['whl_quick_replies_v2', 'whl_quick_replies'];
  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  let checkInterval = null;

  function log(...args) {
    if (DEBUG) console.log('[QuickReplies]', ...args);
  }

  // Respostas rápidas padrão - REMOVIDO para não confundir usuário
  // O sistema agora começa vazio e o usuário adiciona suas próprias respostas
  const DEFAULT_REPLIES = [];

  let quickReplies = [];
  let suggestionBox = null;
  let inputListener = null;
  let debounceTimer = null;

  // ============================================
  // PERSISTÊNCIA
  // ============================================

  async function loadReplies() {
    try {
      const keys = [STORAGE_KEY, ...LEGACY_KEYS];
      const result = await chrome.storage.local.get(keys);

      let loaded = result[STORAGE_KEY];

      // Migração: se não houver no V3, tentar legados (v2 / v1)
      if (!Array.isArray(loaded) || loaded.length === 0) {
        for (const legacyKey of LEGACY_KEYS) {
          const legacy = result[legacyKey];
          if (Array.isArray(legacy) && legacy.length > 0) {
            loaded = legacy
              .map((r, idx) => ({
                id: r.id || `qr_${Date.now()}_${idx}`,
                trigger: (r.trigger || r.key || '').trim(),
                response: (r.response || r.value || '').trim(),
                createdAt: r.createdAt || Date.now(),
                usageCount: r.usageCount || 0,
                lastUsed: r.lastUsed || null
              }))
              .filter(r => r.trigger && r.response);

            try {
              await chrome.storage.local.set({ [STORAGE_KEY]: loaded });
            } catch (_) {
              // ignore
            }
            break;
          }
        }
      }

      quickReplies = Array.isArray(loaded) ? loaded : [];
      log('Carregadas', quickReplies.length, 'respostas rápidas');
    } catch (e) {
      console.error('[QuickReplies] Erro ao carregar:', e);
      quickReplies = [];
    }
  }

  async function saveReplies() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: quickReplies });
    } catch (e) {
      console.error('[QuickReplies] Erro ao salvar:', e);
    }
  }

  // ============================================
  // UI - SUGGESTION BOX
  // ============================================

  function createSuggestionBox() {
    if (suggestionBox) return suggestionBox;

    suggestionBox = document.createElement('div');
    suggestionBox.id = 'whl-quick-reply-suggestion';
    suggestionBox.style.cssText = `
      position: fixed;
      background: rgba(17, 20, 36, 0.98);
      border: 1px solid rgba(139, 92, 246, 0.5);
      border-radius: 12px;
      padding: 0;
      color: white;
      font-size: 13px;
      cursor: pointer;
      z-index: 99999;
      display: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      max-width: 420px;
      min-width: 280px;
      overflow: hidden;
      backdrop-filter: blur(20px);
    `;
    document.body.appendChild(suggestionBox);
    return suggestionBox;
  }

  function showSuggestion(composer, quickReply) {
    if (!suggestionBox) createSuggestionBox();

    const rect = composer.getBoundingClientRect();

    // v9.3.8 SECURITY FIX: trigger e response são input do user (templates criados no painel).
    // Sem escape, atacante poderia criar template `trigger="<img onerror=...>"` e XSS.
    // Local escape aqui pra não depender de outros escapeHtml externos.
    const escape = (s) => {
      if (s === null || s === undefined) return '';
      const div = document.createElement('div');
      div.textContent = String(s);
      return div.innerHTML;
    };
    const safeTrigger = escape(quickReply.trigger);
    const responsePreview = quickReply.response.length > 120
      ? quickReply.response.slice(0, 120) + '...'
      : quickReply.response;
    const safeResponse = escape(responsePreview);

    suggestionBox.innerHTML = `
      <div style="background: linear-gradient(135deg, rgba(139,92,246,0.3), rgba(59,130,246,0.2)); padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.1);">
        <div style="font-size: 11px; color: rgba(255,255,255,0.6); margin-bottom: 4px;">💬 Resposta rápida</div>
        <div style="font-weight: 600; color: #a78bfa; font-size: 15px;">/${safeTrigger}</div>
      </div>
      <div style="padding: 12px 14px; line-height: 1.5; color: rgba(255,255,255,0.9);">
        ${safeResponse}
      </div>
      <div style="padding: 8px 14px; background: rgba(0,0,0,0.2); font-size: 11px; color: rgba(255,255,255,0.5); text-align: center;">
        Clique ou pressione Enter para inserir
      </div>
    `;

    suggestionBox.style.bottom = (window.innerHeight - rect.top + 12) + 'px';
    suggestionBox.style.left = rect.left + 'px';
    suggestionBox.style.display = 'block';

    // Click handler
    suggestionBox.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await insertReply(composer, quickReply.response);
      // Atualiza contador de uso (compat com painel)
      try {
        if (quickReply && typeof quickReply === 'object') {
          quickReply.usageCount = (quickReply.usageCount || 0) + 1;
          saveReplies();
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      hideSuggestion();
    };
  }

  function hideSuggestion() {
    if (suggestionBox) {
      suggestionBox.style.display = 'none';
    }
  }

  // ============================================
  // INSERÇÃO DE TEXTO (MÉTODO ROBUSTO)
  // ============================================

  async function insertReply(composer, text) {
    if (!composer) {
      composer = findComposer();
    }
    if (!composer || !text) return false;

    log('Inserindo resposta:', text.slice(0, 30));

    // Focar no campo
    composer.focus();
    await sleep(80);

    // Limpar campo existente
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await sleep(50);
    } catch (_) {
      composer.textContent = '';
    }

    let success = false;

    // Método 1: execCommand (mais compatível com WhatsApp Web)
    if (!success) {
      try {
        document.execCommand('insertText', false, text);
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        await sleep(50);

        const inserted = (composer.textContent || composer.innerText || '').trim();
        if (inserted && inserted.includes(text.slice(0, 15))) {
          log('✅ Método 1 (execCommand) funcionou');
          success = true;
        }
      } catch (e) {
        log('Método 1 falhou:', e);
      }
    }

    // Método 2: Clipboard API
    if (!success) {
      try {
        composer.textContent = '';
        await sleep(30);

        await navigator.clipboard.writeText(text);
        document.execCommand('paste');
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        await sleep(80);

        const inserted = (composer.textContent || composer.innerText || '').trim();
        if (inserted && inserted.includes(text.slice(0, 15))) {
          log('✅ Método 2 (Clipboard) funcionou');
          success = true;
        }
      } catch (e) {
        log('Método 2 falhou:', e);
      }
    }

    // Método 3: textContent direto
    if (!success) {
      try {
        composer.textContent = text;
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
        composer.dispatchEvent(new Event('change', { bubbles: true }));
        log('✅ Método 3 (textContent) aplicado');
        success = true;
      } catch (e) {
        log('Método 3 falhou:', e);
      }
    }

    // Notificar
    if (success && window.NotificationsModule?.toast) {
      window.NotificationsModule.toast('⚡ Resposta inserida', 'success', 1500);
    }

    return success;
  }

  // ============================================
  // ENCONTRAR COMPOSER (SELETORES 2024/2025)
  // ============================================

  function findComposer() {
    const selectors = [
      '[data-testid="conversation-compose-box-input"]',
      'footer div[contenteditable="true"][data-lexical-editor="true"]',
      '[data-lexical-editor="true"]',
      'div[contenteditable="true"][data-tab="10"]',
      'footer div[contenteditable="true"][role="textbox"]',
      '#main footer div[contenteditable="true"]',
      'footer div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]'
    ];

    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.isConnected && (el.offsetWidth || el.offsetHeight)) {
          return el;
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }

    return null;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function normalizeTrigger(trigger) {
    return String(trigger || '')
      .trim()
      .replace(/^[\/:]+/, '')
      .toLowerCase();
  }

  // ============================================
  // LISTENER DE INPUT
  // ============================================

  function handleInput() {
    const composer = findComposer();
    if (!composer) return;

    const text = (composer.textContent || composer.innerText || '').trim();

    // Verificar se começa com /
    if ((text.startsWith('/') || text.startsWith(':')) && text.length > 1) {
      // ✅ Considerar apenas o primeiro token após "/" (ex: "/oi bom dia" → trigger "oi")
      const triggerToken = normalizeTrigger(text.slice(1).split(/\s+/)[0]);

      // Buscar match
      const match = quickReplies.find(qr => {
        const t = normalizeTrigger(qr.trigger);
        return t && (
          t === triggerToken ||
          t.startsWith(triggerToken)
        );
      });

      if (match) {
        showSuggestion(composer, match);
        return;
      }
    }

    hideSuggestion();
  }

  function initListener() {
    if (inputListener) return;

    createSuggestionBox();

    // Debounced input listener
    inputListener = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(handleInput, 100);
    };

    // Escutar eventos de input no document (captura)
    document.addEventListener('input', inputListener, true);

    // Escutar keydown para Enter/Tab/Escape
    document.addEventListener('keydown', (e) => {
      if (!suggestionBox || suggestionBox.style.display === 'none') return;

      if (e.key === 'Enter' || e.key === 'Tab') {
        const composer = findComposer();
        const text = (composer?.textContent || '').trim();

        if (text.startsWith('/') || text.startsWith(':')) {
          const triggerToken = normalizeTrigger(text.slice(1).split(/\s+/)[0]);
          const match = quickReplies.find(qr => {
            const t = normalizeTrigger(qr.trigger);
            return t && (
              t === triggerToken ||
              t.startsWith(triggerToken)
            );
          });

          if (match) {
            e.preventDefault();
            e.stopPropagation();
            insertReply(composer, match.response);
            // Atualiza contador de uso (compat com painel)
            try {
              if (match && typeof match === 'object') {
                match.usageCount = (match.usageCount || 0) + 1;
                saveReplies();
              }
            } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
            hideSuggestion();
          }
        }
      }

      if (e.key === 'Escape') {
        hideSuggestion();
      }
    }, true);

    // Esconder ao clicar fora
    document.addEventListener('click', (e) => {
      if (suggestionBox && !suggestionBox.contains(e.target)) {
        hideSuggestion();
      }
    }, true);

    log('✅ Listener de Quick Replies inicializado');
  }

  // ============================================
  // GERENCIAMENTO
  // ============================================

  function addReply(trigger, response, category = 'Geral') {
    const cleaned = normalizeTrigger(trigger).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const exists = quickReplies.some(qr => normalizeTrigger(qr.trigger) === cleaned);
    if (exists) {
      console.warn('[QuickReplies] Gatilho já existe:', trigger);
      return false;
    }

    quickReplies.push({
      id: `qr_${Date.now()}`,
      trigger: cleaned,
      response,
      category,
      usageCount: 0,
      createdAt: new Date().toISOString()
    });

    saveReplies();
    log('Resposta adicionada:', trigger);
    return true;
  }

  function removeReply(trigger) {
    const cleaned = normalizeTrigger(trigger).replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const index = quickReplies.findIndex(qr => normalizeTrigger(qr.trigger) === cleaned);
    if (index === -1) return false;

    quickReplies.splice(index, 1);
    saveReplies();
    log('Resposta removida:', trigger);
    return true;
  }

  function getReplies() {
    return [...quickReplies];
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    log('Inicializando Quick Replies...');

    await loadReplies();

    // 🔄 Sincronizar em tempo real com alterações feitas no painel lateral
    try {
      if (!window.__WHL_QR_STORAGE_SYNC__ && chrome?.storage?.onChanged) {
        window.__WHL_QR_STORAGE_SYNC__ = true;
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName !== 'local') return;
          if (changes[STORAGE_KEY]) {
            const nv = changes[STORAGE_KEY].newValue;
            quickReplies = Array.isArray(nv) ? nv : [];
            log('🔄 Quick Replies atualizadas via storage:', quickReplies.length);
          }
        });
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // Aguardar DOM do WhatsApp carregar
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(() => {
      const composer = findComposer();
      if (composer) {
        clearInterval(checkInterval);
        checkInterval = null;
        initListener();
      }
    }, 1000);

    // Parar depois de 30 segundos
    setTimeout(() => {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    }, 30000);
  }

  /**
   * Retorna todas as respostas como array (alias para getReplies)
   */
  function getAll() {
    return [...quickReplies];
  }

  /**
   * Retorna estatísticas de uso
   */
  function getStats() {
    const total = quickReplies.length;
    const totalUsage = quickReplies.reduce((sum, r) => sum + (r.usageCount || 0), 0);
    const mostUsed = quickReplies.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))[0];
    
    return {
      total,
      totalUsage,
      mostUsed: mostUsed?.trigger || '-',
      avgUsage: total > 0 ? Math.round(totalUsage / total) : 0
    };
  }

  // Expor API global
  window.QuickRepliesFixed = {
    init,
    addReply,
    removeReply,
    getReplies,
    getAll,
    getStats,
    insertReply
  };

  // Alias para compatibilidade com sidepanel-handlers.js
  window.quickReplies = window.QuickRepliesFixed;

  window.addEventListener('beforeunload', () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 1000);
  }

  log('Módulo Quick Replies carregado');
})();
