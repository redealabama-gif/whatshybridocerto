/**
 * ⏲️ Timer Manager - Gerenciamento seguro de timers
 * WhatsHybrid v7.9.12
 *
 * Provê wrappers seguros para setTimeout e setInterval
 * com rastreamento e limpeza automática.
 *
 * ✅ Hardening adicional (Jan/2026):
 * - Patch opcional de setTimeout/setInterval para rastrear timers criados sem cleanup
 * - Patch de clearTimeout/clearInterval para aceitar IDs gerenciados
 *
 * @version 1.1.0
 */

(function() {
  'use strict';

  const ROOT = (typeof window !== 'undefined') ? window : globalThis;

  // Guardar referências nativas para evitar recursão em patches
  const NATIVE = {
    setTimeout: ROOT.setTimeout?.bind(ROOT),
    clearTimeout: ROOT.clearTimeout?.bind(ROOT),
    setInterval: ROOT.setInterval?.bind(ROOT),
    clearInterval: ROOT.clearInterval?.bind(ROOT)
  };

  const activeTimers = new Map();     // id -> meta (timeout)
  const activeIntervals = new Map();  // id -> meta (interval)
  let timerId = 0;

  function logDebug(...args) { ROOT.globalThis.WHLLogger?.debug?.(...args); }
  function logWarn(...args) { ROOT.WHLLogger?.warn?.(...args); }
  function logError(...args) { ROOT.WHLLogger?.error?.(...args); }

  /**
   * Cria um timeout seguro com rastreamento
   * @param {Function} callback
   * @param {number} delay
   * @param {string} label
   * @returns {number} id gerenciado
   */
  function safeTimeout(callback, delay, label = '') {
    const id = ++timerId;

    // Normalizar callback
    const cb = (typeof callback === 'function') ? callback : () => {
      logWarn?.('[TimerManager] Callback inválido em safeTimeout:', callback);
    };

    const internalId = NATIVE.setTimeout(() => {
      activeTimers.delete(id);
      try {
        cb();
      } catch (error) {
        logError?.(`[TimerManager] Erro em timeout${label ? ` (${label})` : ''}:`, error);
      }
    }, Number(delay) || 0);

    activeTimers.set(id, {
      internalId,
      label,
      createdAt: Date.now(),
      delay: Number(delay) || 0,
      type: 'timeout'
    });

    return id;
  }

  /**
   * Cria um interval seguro com rastreamento
   * @param {Function} callback
   * @param {number} interval
   * @param {string} label
   * @returns {number} id gerenciado
   */
  function safeInterval(callback, interval, label = '') {
    const id = ++timerId;

    const cb = (typeof callback === 'function') ? callback : () => {
      logWarn?.('[TimerManager] Callback inválido em safeInterval:', callback);
    };

    const internalId = NATIVE.setInterval(() => {
      try {
        cb();
      } catch (error) {
        logError?.(`[TimerManager] Erro em interval${label ? ` (${label})` : ''}:`, error);
      }
    }, Number(interval) || 0);

    activeIntervals.set(id, {
      internalId,
      label,
      createdAt: Date.now(),
      interval: Number(interval) || 0,
      type: 'interval'
    });

    return id;
  }

  function clearSafeTimeout(id) {
    const timer = activeTimers.get(id);
    if (timer) {
      NATIVE.clearTimeout(timer.internalId);
      activeTimers.delete(id);
      return true;
    }
    return false;
  }

  function clearSafeInterval(id) {
    const interval = activeIntervals.get(id);
    if (interval) {
      NATIVE.clearInterval(interval.internalId);
      activeIntervals.delete(id);
      return true;
    }
    return false;
  }

  /**
   * Limpa todos os timers/intervals ativos
   */
  function clearAll() {
    let clearedTimeouts = 0;
    let clearedIntervals = 0;

    for (const [, timer] of activeTimers) {
      try { NATIVE.clearTimeout(timer.internalId); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      clearedTimeouts++;
    }
    activeTimers.clear();

    for (const [, interval] of activeIntervals) {
      try { NATIVE.clearInterval(interval.internalId); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      clearedIntervals++;
    }
    activeIntervals.clear();

    logDebug?.(`[TimerManager] Limpos: ${clearedTimeouts} timeouts, ${clearedIntervals} intervals`);
  }

  function listActive() {
    const list = [];
    for (const [id, timer] of activeTimers) {
      list.push({ id, ...timer, age: Date.now() - timer.createdAt });
    }
    for (const [id, interval] of activeIntervals) {
      list.push({ id, ...interval, age: Date.now() - interval.createdAt });
    }
    return list;
  }

  function getStats() {
    return {
      activeTimeouts: activeTimers.size,
      activeIntervals: activeIntervals.size,
      total: activeTimers.size + activeIntervals.size
    };
  }

  // Debounce / Throttle
  const debounceTimers = new Map();
  function debounce(func, wait, key = '') {
    const finalKey = key || String(func).slice(0, 50);

    return function(...args) {
      const existing = debounceTimers.get(finalKey);
      if (existing) clearSafeTimeout(existing);

      const id = safeTimeout(() => {
        debounceTimers.delete(finalKey);
        func.apply(this, args);
      }, wait, `debounce:${finalKey}`);

      debounceTimers.set(finalKey, id);
    };
  }

  const throttleState = new Map();
  function throttle(func, limit, key = '') {
    const finalKey = key || String(func).slice(0, 50);

    return function(...args) {
      const state = throttleState.get(finalKey);
      const now = Date.now();

      if (!state || now - state.lastRun >= limit) {
        throttleState.set(finalKey, { lastRun: now });
        func.apply(this, args);
      }
    };
  }

  /**
   * Instala patches globais para rastrear timers criados sem WHLTimerManager
   */
  function installGlobalPatches() {
    if (ROOT.__WHL_TIMER_PATCHED) return;

    // Patch setTimeout / setInterval
    ROOT.setTimeout = function(callback, delay, ...args) {
      if (typeof callback !== 'function') {
        // Evitar string timers (ruim por segurança); delegar ao nativo sem rastrear
        logWarn?.('[TimerManager] setTimeout com callback não-função (evite):', callback);
        return NATIVE.setTimeout(callback, delay, ...args);
      }
      return safeTimeout(() => callback(...args), delay, 'setTimeout');
    };

    ROOT.setInterval = function(callback, interval, ...args) {
      if (typeof callback !== 'function') {
        logWarn?.('[TimerManager] setInterval com callback não-função (evite):', callback);
        return NATIVE.setInterval(callback, interval, ...args);
      }
      return safeInterval(() => callback(...args), interval, 'setInterval');
    };

    // Patch clearTimeout / clearInterval para aceitar IDs gerenciados
    ROOT.clearTimeout = function(id) {
      if (clearSafeTimeout(id)) return;
      return NATIVE.clearTimeout(id);
    };

    ROOT.clearInterval = function(id) {
      if (clearSafeInterval(id)) return;
      return NATIVE.clearInterval(id);
    };

    ROOT.__WHL_TIMER_PATCHED = true;
    logDebug?.('[TimerManager] ✅ Patches globais de timers instalados');
  }

  // Cleanup ao descarregar página
  if (typeof ROOT.addEventListener === 'function') {
    ROOT.addEventListener('beforeunload', clearAll);
    // pagehide cobre bfcache em alguns navegadores
    ROOT.addEventListener('pagehide', clearAll);
  }

  // Exportar globalmente
  ROOT.WHLTimerManager = {
    safeTimeout,
    safeInterval,
    clearSafeTimeout,
    clearSafeInterval,
    clearAll,
    listActive,
    getStats,
    debounce,
    throttle,
    installGlobalPatches
  };

  // Aliases para conveniência
  ROOT.safeTimeout = safeTimeout;
  ROOT.safeInterval = safeInterval;

  // Instalar patch automaticamente (padrão seguro)
  try { installGlobalPatches(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

  logDebug?.('[TimerManager] ✅ Gerenciador de timers carregado (v1.1.0)');
})();
