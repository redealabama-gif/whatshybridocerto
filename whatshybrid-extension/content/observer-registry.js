/**
 * ObserverRegistry — MutationObserver central com dispatch interno
 *
 * CORREÇÃO P2: Substitui 17 MutationObservers individuais por um único observer
 * por escopo (chatList, chatView, header), com registry central que garante
 * cleanup automático de todos os listeners ao desmontar.
 *
 * Antes: 17 observers + 113 setIntervals + 268 addEventListener → memory leak garantido
 * Depois: 3 observers + cleanup automático via unregister()
 */

const ObserverRegistry = (() => {
  'use strict';

  // ── Estado interno ─────────────────────────────────────────────────────────
  const _observers = new Map();   // scopeId → MutationObserver
  const _listeners = new Map();   // scopeId → Map<eventName, Set<callback>>
  const _intervals = new Set();   // setInterval IDs registrados (para cleanup)
  const _timeouts  = new Set();   // setTimeout IDs registrados (para cleanup)
  const _domListeners = [];       // { el, event, handler, options }

  // ── Scopes padrão para o WhatsApp Web ──────────────────────────────────────
  const SELECTORS = {
    chatList:  ['#pane-side', '[data-testid="chat-list"]', '.Dk7zN'],
    chatView:  ['#main',      '[data-testid="conversation-panel-wrapper"]'],
    header:    ['header',     '[data-testid="conversation-header"]'],
    root:      ['body'],
  };

  function _resolveTarget(scopeId) {
    const candidates = SELECTORS[scopeId] || [scopeId];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  // ── API pública ────────────────────────────────────────────────────────────

  /**
   * Registra um listener para mutações em um scope.
   * @param {string} scopeId - 'chatList' | 'chatView' | 'header' | CSS selector
   * @param {string} eventName - Nome do evento interno (ex: 'newMessage', 'contactChange')
   * @param {Function} callback - fn(mutationList, observer)
   * @param {MutationObserverInit} [observerInit] - config do MutationObserver
   */
  function on(scopeId, eventName, callback, observerInit = { childList: true, subtree: true }) {
    // Registrar listener interno
    if (!_listeners.has(scopeId)) _listeners.set(scopeId, new Map());
    const scopeListeners = _listeners.get(scopeId);
    if (!scopeListeners.has(eventName)) scopeListeners.set(eventName, new Set());
    scopeListeners.get(eventName).add(callback);

    // Criar ou reutilizar o MutationObserver para este scope
    if (!_observers.has(scopeId)) {
      const target = _resolveTarget(scopeId);
      if (!target) {
        console.warn(`[ObserverRegistry] Target não encontrado para scope: ${scopeId}`);
        return () => off(scopeId, eventName, callback);
      }

      const observer = new MutationObserver((mutationList, obs) => {
        const listeners = _listeners.get(scopeId);
        if (!listeners) return;
        for (const [, handlers] of listeners) {
          for (const handler of handlers) {
            try { handler(mutationList, obs); }
            catch (e) { console.warn(`[ObserverRegistry] Handler error (${scopeId}):`, e); }
          }
        }
      });

      observer.observe(target, observerInit);
      _observers.set(scopeId, observer);
    }

    // Retorna função de unregister para facilitar cleanup
    return () => off(scopeId, eventName, callback);
  }

  /**
   * Remove um listener específico de um scope.
   */
  function off(scopeId, eventName, callback) {
    const scopeListeners = _listeners.get(scopeId);
    if (!scopeListeners) return;
    const handlers = scopeListeners.get(eventName);
    if (!handlers) return;
    handlers.delete(callback);

    // Se não há mais listeners neste scope, desconectar o observer
    const hasAny = [...scopeListeners.values()].some(s => s.size > 0);
    if (!hasAny) {
      const obs = _observers.get(scopeId);
      if (obs) { obs.disconnect(); _observers.delete(scopeId); }
      _listeners.delete(scopeId);
    }
  }

  /**
   * Registra um setInterval com cleanup automático.
   */
  function setManagedInterval(fn, ms, label = '') {
    const id = setInterval(() => {
      try { fn(); }
      catch (e) { console.warn(`[ObserverRegistry] Interval error (${label}):`, e); }
    }, ms);
    _intervals.add(id);
    return id;
  }

  function clearManagedInterval(id) {
    clearInterval(id);
    _intervals.delete(id);
  }

  /**
   * Registra um addEventListener com cleanup automático.
   */
  function addManagedListener(el, event, handler, options) {
    el.addEventListener(event, handler, options);
    _domListeners.push({ el, event, handler, options });
  }

  /**
   * Desconecta TODOS os observers, intervals e listeners registrados.
   * Chamar ao desmontar a extensão ou em teardown de testes.
   */
  function destroyAll() {
    for (const obs of _observers.values()) obs.disconnect();
    _observers.clear();
    _listeners.clear();

    for (const id of _intervals) clearInterval(id);
    _intervals.clear();

    for (const id of _timeouts) clearTimeout(id);
    _timeouts.clear();

    for (const { el, event, handler, options } of _domListeners) {
      try { el.removeEventListener(event, handler, options); } catch (_) {}
    }
    _domListeners.length = 0;

    console.log('[ObserverRegistry] Todos os observers e listeners removidos');
  }

  /**
   * Stats para diagnóstico.
   */
  function getStats() {
    return {
      activeObservers: _observers.size,
      activeScopes: [..._listeners.keys()],
      activeIntervals: _intervals.size,
      activeDOMListeners: _domListeners.length,
    };
  }

  return { on, off, setManagedInterval, clearManagedInterval, addManagedListener, destroyAll, getStats };
})();

// Expor globalmente para uso pelos módulos da extensão
if (typeof window !== 'undefined') window.ObserverRegistry = ObserverRegistry;
if (typeof globalThis !== 'undefined') globalThis.ObserverRegistry = ObserverRegistry;
