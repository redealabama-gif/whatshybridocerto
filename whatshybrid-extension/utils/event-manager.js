/**
 * 📡 Event Manager - Gerenciamento de listeners de eventos
 * WhatsHybrid v7.9.12
 *
 * Gerencia event listeners para prevenir duplicação e facilitar cleanup.
 *
 * ✅ Hardening adicional (Jan/2026):
 * - Patch opcional de addEventListener/removeEventListener para rastrear listeners criados sem cleanup
 * - GC periódico: remove listeners ligados a elementos DOM desconectados (SPAs)
 *
 * @version 1.1.0
 */

(function() {
  'use strict';

  const ROOT = (typeof window !== 'undefined') ? window : globalThis;

  // Guardar referências nativas (evita recursão quando patchado)
  const NATIVE = {
    add: EventTarget && EventTarget.prototype && EventTarget.prototype.addEventListener
      ? EventTarget.prototype.addEventListener
      : null,
    remove: EventTarget && EventTarget.prototype && EventTarget.prototype.removeEventListener
      ? EventTarget.prototype.removeEventListener
      : null
  };

  const listeners = new Map();
  let listenerId = 0;

  function logDebug(...args) { ROOT.globalThis.WHLLogger?.debug?.(...args); }
  function logWarn(...args) { ROOT.WHLLogger?.warn?.(...args); }
  function logError(...args) { ROOT.WHLLogger?.error?.(...args); }

  function nativeAdd(target, event, handler, options) {
    if (!NATIVE.add) return target.addEventListener(event, handler, options);
    return NATIVE.add.call(target, event, handler, options);
  }

  function nativeRemove(target, event, handler, options) {
    if (!NATIVE.remove) return target.removeEventListener(event, handler, options);
    return NATIVE.remove.call(target, event, handler, options);
  }

  /**
   * Adiciona um event listener com rastreamento
   */
  function on(target, event, handler, options = {}, group = 'default') {
    if (!target || !event || !handler) {
      logWarn?.('[EventManager] Parâmetros inválidos para on()');
      return null;
    }

    const id = ++listenerId;

    // Wrapper para capturar erros (sem quebrar o removeEventListener do usuário)
    const wrappedHandler = function(e) {
      try {
        handler.call(this, e);
      } catch (error) {
        logError?.(`[EventManager] Erro em handler (${event}):`, error);
      }
    };

    nativeAdd(target, event, wrappedHandler, options);

    listeners.set(id, {
      target,
      event,
      handler,
      wrappedHandler,
      options,
      group,
      createdAt: Date.now(),
      disconnectedSince: null,
      mode: 'managed' // via WHLEventManager.on
    });

    return id;
  }

  /**
   * Remove um event listener específico
   */
  function off(id) {
    const listener = listeners.get(id);
    if (listener) {
      nativeRemove(listener.target, listener.event, listener.wrappedHandler, listener.options);
      listeners.delete(id);
    }
  }

  /**
   * Remove todos os listeners de um grupo
   */
  function offGroup(group) {
    const toRemove = [];

    for (const [id, listener] of listeners) {
      if (listener.group === group) {
        toRemove.push(id);
      }
    }

    toRemove.forEach(id => off(id));
    if (toRemove.length) logDebug?.(`[EventManager] Removidos ${toRemove.length} listeners do grupo '${group}'`);
  }

  /**
   * Remove todos os listeners
   */
  function offAll() {
    const ids = Array.from(listeners.keys());
    ids.forEach(id => off(id));
    if (ids.length) logDebug?.(`[EventManager] Removidos ${ids.length} listeners (total)`);
  }

  /**
   * Remove todos os listeners de um elemento
   */
  function offTarget(target) {
    const toRemove = [];

    for (const [id, listener] of listeners) {
      if (listener.target === target) {
        toRemove.push(id);
      }
    }

    toRemove.forEach(id => off(id));
    return toRemove.length;
  }

  /**
   * Verifica se um listener já existe
   */
  function has(target, event, handler = null) {
    for (const [, listener] of listeners) {
      if (listener.target === target && listener.event === event) {
        if (!handler || listener.handler === handler || listener.wrappedHandler === handler) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Conta listeners ativos
   */
  function count(group = null) {
    if (!group) return listeners.size;

    let c = 0;
    for (const [, listener] of listeners) {
      if (listener.group === group) c++;
    }
    return c;
  }

  function getKeys() {
    return Array.from(listeners.keys());
  }

  function once(target, event, handler, group = 'default') {
    let id = null;
    id = on(target, event, function(e) {
      off(id);
      handler.call(this, e);
    }, { once: true }, group);

    return id;
  }

  function delegate(target, event, selector, handler, group = 'default') {
    return on(target, event, function(e) {
      const matched = e.target && e.target.closest ? e.target.closest(selector) : null;
      if (matched && target.contains(matched)) {
        handler.call(matched, e, matched);
      }
    }, {}, group);
  }

  function getStats() {
    const groups = {};
    const events = {};

    for (const [, listener] of listeners) {
      groups[listener.group] = (groups[listener.group] || 0) + 1;
      events[listener.event] = (events[listener.event] || 0) + 1;
    }

    return {
      total: listeners.size,
      byGroup: groups,
      byEvent: events
    };
  }

  // =========================================================
  // 🔧 Hardening: Patch global addEventListener/removeEventListener
  // =========================================================

  function installGlobalPatches() {
    if (ROOT.__WHL_EVENT_PATCHED) return;
    if (!NATIVE.add || !NATIVE.remove) return;

    EventTarget.prototype.addEventListener = function(event, handler, options) {
      // Track (sem wrapper) para permitir removeEventListener normal
      try {
        const id = ++listenerId;
        listeners.set(id, {
          target: this,
          event,
          handler,
          wrappedHandler: handler,
          options,
          group: '__global',
          createdAt: Date.now(),
          disconnectedSince: null,
          mode: 'patched'
        });
      } catch (_) {
        // ignore tracking errors
      }

      return NATIVE.add.call(this, event, handler, options);
    };

    EventTarget.prototype.removeEventListener = function(event, handler, options) {
      // Atualizar tracking
      try {
        for (const [id, l] of listeners) {
          if (l.mode === 'patched' && l.target === this && l.event === event && l.handler === handler) {
            listeners.delete(id);
          }
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

      return NATIVE.remove.call(this, event, handler, options);
    };

    ROOT.__WHL_EVENT_PATCHED = true;
    logDebug?.('[EventManager] ✅ Patches globais de eventos instalados');
  }

  // =========================================================
  // 🧹 GC: remover listeners ligados a elementos removidos do DOM
  // =========================================================

  function gcDetachedDomListeners() {
    let removed = 0;

    for (const [id, l] of listeners) {
      // Apenas para targets DOM
      const t = l.target;
      if (!t) continue;

      // window/document não devem ser removidos automaticamente
      if (t === ROOT || t === ROOT.document) continue;

      // Elementos DOM que saíram da árvore
      // Evitar remoção agressiva: só remover se estiver desconectado há >= 60s
      if (typeof t === 'object' && 'isConnected' in t) {
        if (t.isConnected === false) {
          if (!l.disconnectedSince) {
            l.disconnectedSince = Date.now();
            continue;
          }

          if (Date.now() - l.disconnectedSince < 60000) {
            continue;
          }

          try {
            nativeRemove(t, l.event, l.wrappedHandler, l.options);
          } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
          listeners.delete(id);
          removed++;
        } else if (l.disconnectedSince) {
          l.disconnectedSince = null;
        }
      }
    }

    if (removed) logDebug?.(`[EventManager] GC removeu ${removed} listener(s) de elementos desconectados`);
  }

  function startGC() {
    // Não rodar se não houver suporte a DOM
    if (typeof ROOT.document === 'undefined') return;

    // Preferir TimerManager (se existir), para rastrear/limpar
    const scheduler = ROOT.WHLTimerManager?.safeInterval || ROOT.safeInterval || ROOT.setInterval;
    try {
      scheduler(gcDetachedDomListeners, 30000, 'EventManager:gc');
    } catch (_) {
      // fallback
      try { ROOT.setInterval(gcDetachedDomListeners, 30000); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }
  }

  // Cleanup ao descarregar página
  try { nativeAdd(ROOT, 'beforeunload', offAll, false); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

  // Exportar globalmente
  ROOT.WHLEventManager = {
    on,
    off,
    offGroup,
    offAll,
    offTarget,
    has,
    count,
    getKeys,
    once,
    delegate,
    getStats,
    installGlobalPatches
  };

  // UI discovery (WHH-013): instrumentação/relatório para auditoria de "todos os botões"
  function _safeText(val, maxLen = 80) {
    try {
      const s = (val || '').toString().replace(/\s+/g, ' ').trim();
      return s.length > maxLen ? (s.slice(0, maxLen) + '…') : s;
    } catch (_) {
      return '';
    }
  }

  function _getSelector(el) {
    if (!el || el === document || el === window) return '(document)';
    try {
      if (el.id) return `#${el.id}`;
      const tag = (el.tagName || 'EL').toLowerCase();
      const cls = (el.className && typeof el.className === 'string')
        ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        : '';
      if (cls) return `${tag}.${cls}`;
      return tag;
    } catch (_) {
      return '(unknown)';
    }
  }

  function _describeTarget(target) {
    try {
      const el = target && target.nodeType === 1 ? target : null;
      if (!el) return { selector: String(target), id: null, tag: null, text: null };
      return {
        selector: _getSelector(el),
        id: el.id || null,
        tag: el.tagName ? el.tagName.toLowerCase() : null,
        text: _safeText(el.innerText || el.textContent || '')
      };
    } catch (_) {
      return { selector: '(error)', id: null, tag: null, text: null };
    }
  }

  function _scanClickable(rootEl = document) {
    try {
      const sel = [
        'button',
        'a[href]',
        '[role="button"]',
        'input[type="button"]',
        'input[type="submit"]',
        '[onclick]'
      ].join(',');

      const els = Array.from(rootEl.querySelectorAll(sel));
      return els.map(el => ({
        ..._describeTarget(el),
        classes: (el.className && typeof el.className === 'string') ? _safeText(el.className, 120) : null
      }));
    } catch (_) {
      return [];
    }
  }

  function _trimStack(stack) {
    if (!stack) return null;
    try {
      return stack.split('\n').slice(0, 8).join('\n');
    } catch (_) {
      return String(stack);
    }
  }

  function _exportReport() {
    const now = Date.now();

    const clickTypes = new Set(['click', 'pointerup', 'mouseup', 'touchend', 'keydown']);
    const records = [];

    // Listeners registrados via WHLEventManager
    try {
      for (const [id, rec] of listeners.entries()) {
        if (!rec) continue;
        if (rec.event && clickTypes.has(rec.event)) {
          records.push({
            source: 'WHLEventManager',
            id,
            event: rec.event,
            target: _describeTarget(rec.target),
            group: rec.group || null,
            createdAt: rec.createdAt || null,
            stack: _trimStack(rec.stack)
          });
        }
      }
    } catch (_) {}

    // Listeners globais capturados via patch (addEventListener)
    try {
      for (const [id, rec] of globalListeners.entries()) {
        if (!rec) continue;
        if (rec.type && clickTypes.has(rec.type)) {
          records.push({
            source: rec.via || 'global',
            id,
            event: rec.type,
            target: _describeTarget(rec.target),
            createdAt: rec.addedAt || null,
            stack: _trimStack(rec.stack)
          });
        }
      }
    } catch (_) {}

    return {
      version: 1,
      generatedAt: now,
      url: (typeof location !== 'undefined') ? location.href : null,
      listeners: records,
      dom: _scanClickable(document)
    };
  }

  ROOT.WHLUIDiscovery = {
    scan: _scanClickable,
    export: _exportReport
  };


  // Instalar patch e GC automaticamente
  try { installGlobalPatches(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  try { startGC(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

  logDebug?.('[EventManager] ✅ Gerenciador de eventos carregado (v1.1.0)');
})();
