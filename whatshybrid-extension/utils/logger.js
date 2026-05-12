/**
 * Logger Centralizado
 * WhatsHybrid v7.9.12
 *
 * ✅ Hardening adicional (Jan/2026):
 * - Patch de console.log/info/debug para reduzir logs em produção
 * - Handlers globais para erros não tratados (unhandledrejection / error)
 *
 * @version 1.1.0
 */
(function() {
  'use strict';

  const ROOT = (typeof window !== 'undefined') ? window : globalThis;

  // Detectar debug cedo (antes de chrome.storage responder)
  let DEBUG_ENABLED = false;
  try {
    if (typeof localStorage !== 'undefined') {
      DEBUG_ENABLED = localStorage.getItem('whl_debug') === 'true';
    }
  } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

  // Preferir chrome.storage quando disponível
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get('whl_debug', (result) => {
        DEBUG_ENABLED = result.whl_debug === true;
        // Ajustar level automaticamente
        currentLevel = DEBUG_ENABLED ? LEVELS.debug : LEVELS.warn;
      });
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
  }

  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
  let currentLevel = DEBUG_ENABLED ? LEVELS.debug : LEVELS.warn;

  // Salvar referência ao console original
  const NATIVE_CONSOLE = {
    log: (console && console.log) ? console.log.bind(console) : null,
    info: (console && console.info) ? console.info.bind(console) : null,
    debug: (console && console.debug) ? console.debug.bind(console) : null,
    warn: (console && console.warn) ? console.warn.bind(console) : null,
    error: (console && console.error) ? console.error.bind(console) : null,
    time: (console && console.time) ? console.time.bind(console) : null,
    timeEnd: (console && console.timeEnd) ? console.timeEnd.bind(console) : null
  };

  // Patch: reduzir console logs em produção (mantém warn/error)
  function patchConsole() {
    if (ROOT.__WHL_CONSOLE_PATCHED) return;
    ROOT.__WHL_CONSOLE_PATCHED = true;
    ROOT.__WHL_NATIVE_CONSOLE = NATIVE_CONSOLE;

    // Em produção (DEBUG desabilitado), silenciar log/info/debug
    if (console) {
      console.log = (...args) => { if (DEBUG_ENABLED && NATIVE_CONSOLE.log) NATIVE_CONSOLE.log(...args); };
      console.info = (...args) => {
        if (DEBUG_ENABLED) {
          const fn = NATIVE_CONSOLE.info || NATIVE_CONSOLE.log;
          fn && fn(...args);
        }
      };
      console.debug = (...args) => {
        if (DEBUG_ENABLED) {
          const fn = NATIVE_CONSOLE.debug || NATIVE_CONSOLE.log;
          fn && fn(...args);
        }
      };
      // warn/error permanecem
    }
  }

  // Logger central
  const logger = {
    setLevel(level) { currentLevel = LEVELS[level] ?? LEVELS.warn; },
    enableDebug() { DEBUG_ENABLED = true; currentLevel = LEVELS.debug; },
    disableDebug() { DEBUG_ENABLED = false; currentLevel = LEVELS.warn; },

    debug(...args) {
      if (currentLevel <= LEVELS.debug && NATIVE_CONSOLE.log) {
        NATIVE_CONSOLE.log('%c[WHL:DEBUG]', 'color: #9CA3AF', ...args);
      }
    },

    info(...args) {
      if (currentLevel <= LEVELS.info && NATIVE_CONSOLE.log) {
        NATIVE_CONSOLE.log('%c[WHL:INFO]', 'color: #3B82F6', ...args);
      }
    },

    warn(...args) {
      if (currentLevel <= LEVELS.warn && NATIVE_CONSOLE.warn) {
        NATIVE_CONSOLE.warn('%c[WHL:WARN]', 'color: #F59E0B', ...args);
      }
    },

    error(...args) {
      if (currentLevel <= LEVELS.error && NATIVE_CONSOLE.error) {
        NATIVE_CONSOLE.error('%c[WHL:ERROR]', 'color: #EF4444; font-weight: bold', ...args);
      }
    },

    critical(...args) {
      if (NATIVE_CONSOLE.error) {
        NATIVE_CONSOLE.error('%c[WHL:CRITICAL]', 'background: #EF4444; color: white; padding: 2px 4px; border-radius: 2px;', ...args);
      }
    },

    time(label) {
      if (currentLevel <= LEVELS.debug && NATIVE_CONSOLE.time) NATIVE_CONSOLE.time(`[WHL] ${label}`);
    },

    timeEnd(label) {
      if (currentLevel <= LEVELS.debug && NATIVE_CONSOLE.timeEnd) NATIVE_CONSOLE.timeEnd(`[WHL] ${label}`);
    }
  };

  ROOT.WHLLogger = logger;

  // Instalar patch de console imediatamente
  try { patchConsole(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

  // Handlers globais (reduz "Promises sem catch" invisíveis)
  if (!ROOT.__WHL_GLOBAL_ERROR_HANDLERS && typeof ROOT.addEventListener === 'function') {
    ROOT.__WHL_GLOBAL_ERROR_HANDLERS = true;

    ROOT.addEventListener('unhandledrejection', (event) => {
      try {
        logger.error('[UnhandledRejection]', event?.reason || event);
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    });

    ROOT.addEventListener('error', (event) => {
      try {
        logger.error('[UnhandledError]', event?.error || event?.message || event);
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    });
  }
})();
