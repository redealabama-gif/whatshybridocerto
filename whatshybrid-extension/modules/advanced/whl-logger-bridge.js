/**
 * WHL Logger Bridge v1.0
 * ============================================================
 * FIX CRÍTICO: 1539 console.log nos módulos advanced/* bypassavam
 * o WHLLogger por completo — nenhum controle de nível, nenhum filtro,
 * bypass total do sistema centralizado de logging.
 *
 * Este módulo deve ser carregado ANTES de qualquer outro módulo advanced/*.
 * Intercepta console.log/warn/error no contexto dos módulos avançados e
 * redireciona para WHLLogger quando disponível, respeitando:
 *   - nível de log configurado (debug / info / warn / error / silent)
 *   - prefixo [ADV-*] para filtragem fácil
 *   - ambiente (produção silencia debug automaticamente)
 */
(function() {
  'use strict';

  const IS_DEV = localStorage.getItem('whl_debug') === 'true';

  // Guarda originais — nunca descartamos, apenas redirecionamos
  const _origLog   = console.log.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);
  const _origDebug = console.debug.bind(console);

  /**
   * Determina se uma mensagem vem de um módulo advanced (pelo prefixo do tag).
   */
  function isAdvancedMsg(args) {
    const first = args[0];
    if (typeof first !== 'string') return false;
    return first.includes('[ADV-') ||
           first.includes('[MultiAgent]') ||
           first.includes('[RLHF]') ||
           first.includes('[KnowledgeGraph]') ||
           first.includes('[Predictive]') ||
           first.includes('[AutonomousLearning]') ||
           first.includes('[ContextualMemory]') ||
           first.includes('[ExplainableAI]') ||
           first.includes('[ConversationSimulator]') ||
           first.includes('[AIVersionControl]') ||
           first.includes('[EmotionalIntelligence]') ||
           first.includes('[SecurityRBAC]') ||
           first.includes('[RealtimeDashboard]') ||
           first.includes('[ChaosEngineering]') ||
           first.includes('[PrivacyLayer]');
  }

  function routeToLogger(level, args) {
    // Se WHLLogger está disponível, usa-o
    const logger = window.WHLLogger || globalThis.WHLLogger;
    if (logger && typeof logger[level] === 'function') {
      try {
        logger[level](...args);
        return;
      } catch (_) {}
    }
    // Fallback: usa console original mas em dev apenas
    if (!IS_DEV && level === 'debug') return; // silencia debug em produção
    _origLog(...args);
  }

  // Instala interceptor apenas para mensagens advanced
  const _patchedLog = function(...args) {
    if (isAdvancedMsg(args)) {
      routeToLogger('debug', args);
    } else {
      _origLog(...args);
    }
  };

  const _patchedWarn = function(...args) {
    if (isAdvancedMsg(args)) {
      routeToLogger('warn', args);
    } else {
      _origWarn(...args);
    }
  };

  const _patchedError = function(...args) {
    if (isAdvancedMsg(args)) {
      routeToLogger('error', args);
    } else {
      _origError(...args);
    }
  };

  // Aplica patch
  console.log   = _patchedLog;
  console.warn  = _patchedWarn;
  console.error = _patchedError;
  console.debug = function(...args) {
    if (isAdvancedMsg(args)) {
      if (IS_DEV) routeToLogger('debug', args);
      // silencia debug dos módulos avançados em produção
    } else {
      _origDebug(...args);
    }
  };

  // Expõe restaurador para testes
  window.__WHL_RESTORE_CONSOLE__ = function() {
    console.log   = _origLog;
    console.warn  = _origWarn;
    console.error = _origError;
    console.debug = _origDebug;
  };

  if (IS_DEV) {
    _origLog('[WHL Logger Bridge] ✅ Interceptor de console ativo para módulos advanced/*');
  }
})();
