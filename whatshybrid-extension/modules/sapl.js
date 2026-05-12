/**
 * 🔰 SAPL — System Auto-Protection Layer v1.0
 *
 * Camada orquestradora de proteção do WhatsHybrid Pro.
 *
 * O projeto já tem peças individuais (anti-break-system, graceful-degradation,
 * smoke-test, kill-switch). O SAPL não os duplica — ele os une e preenche o
 * que falta de verdade:
 *
 *  1. WATCHDOG DE HOOKS     — detecta quando os hooks do wpp-hooks.js foram
 *                             desregistrados (WhatsApp reload, navegação) e
 *                             reinicia automaticamente sem recarregar a página.
 *
 *  2. CIRCUIT BREAKER       — cada módulo tem um disjuntor: após N falhas
 *                             consecutivas ele é aberto (pausa), testa a
 *                             recuperação com backoff exponencial e fecha
 *                             sozinho quando estável.
 *
 *  3. WA VERSION SENTINEL   — monitora o hash de bundle do WhatsApp Web para
 *                             detectar updates em tempo real e acionar re-scan
 *                             de seletores automaticamente.
 *
 *  4. SILENT FAILURE CATCHER — envolve window.onerror e unhandledrejection para
 *                             capturar erros silenciosos de outros módulos e
 *                             acionar recuperação sem travar o sistema.
 *
 *  5. SELF-TEST SCHEDULER    — agenda testes de integridade periódicos com
 *                             resultado exposto no sidepanel e no console.
 *
 *  6. ORCHESTRATION BUS      — API única que o sidepanel e outros módulos usam
 *                             para consultar saúde, forçar heals e configurar
 *                             thresholds em runtime.
 *
 * @version 1.0.0
 * @author  WhatsHybrid Pro
 * @depends EventBus, AntiBreakSystem, GracefulDegradation, SmokeTest (opcionais)
 */

(function () {
  'use strict';

  // Singleton guard
  if (window.__WHL_SAPL_LOADED__) {
    console.warn('[SAPL] Já carregado — ignorando duplicata.');
    return;
  }
  window.__WHL_SAPL_LOADED__ = true;

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIGURAÇÃO
  // ─────────────────────────────────────────────────────────────────────────────

  const CFG = {
    // Watchdog
    HOOK_CHECK_INTERVAL_MS:    30_000,   // verificar hooks a cada 30s
    HOOK_REINIT_DELAY_MS:       2_000,   // esperar antes de reiniciar hooks
    HOOK_MAX_REINIT_ATTEMPTS:       5,   // máx tentativas de reinicialização

    // Circuit breaker
    CB_FAILURE_THRESHOLD:           3,   // falhas antes de abrir o circuito
    CB_SUCCESS_THRESHOLD:           2,   // sucessos para fechar o circuito
    CB_TIMEOUT_BASE_MS:        15_000,   // tempo base em half-open (backoff x2)
    CB_TIMEOUT_MAX_MS:        300_000,   // máx 5 minutos de espera

    // WA Version Sentinel
    SENTINEL_CHECK_INTERVAL_MS: 60_000, // checar bundle do WA a cada 1 min
    SENTINEL_STORAGE_KEY:  'whl_sapl_wa_bundle_hash',

    // Self-test
    SELF_TEST_INTERVAL_MS:     120_000, // self-test a cada 2 min
    SELF_TEST_CRITICAL_MODULES: [
      'whl_hooks',
      'recover',
      'privacy_shield',
      'status_download',
      'view_once_saver'
    ],

    // Silent failure
    MAX_CAUGHT_ERRORS:              50,  // histórico máximo
    ERROR_FLOOD_WINDOW_MS:      10_000, // janela anti-flood
    ERROR_FLOOD_MAX:               10,  // máx erros nessa janela antes de suprimir
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // ESTADO GLOBAL
  // ─────────────────────────────────────────────────────────────────────────────

  const state = {
    initialized: false,
    startTime: Date.now(),

    // Hooks
    hookStatus: {
      renderableMessages: false,
      editMessages:        false,
      messageCreated:      false,
      statusUpdates:       false,
    },
    hookReinitCount: 0,

    // Circuit breakers — Map<moduleId, CircuitBreakerState>
    circuits: new Map(),

    // WA bundle sentinel
    lastBundleHash: null,
    bundleChangedAt: null,
    selectorRescans: 0,

    // Self-test
    lastSelfTest: null,
    selfTestHistory: [],

    // Erros capturados
    caughtErrors: [],
    errorFloodCount: 0,
    errorFloodWindowStart: 0,

    // Intervalos (para cleanup)
    intervals: new Set(),
    timeouts: new Set(),
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITÁRIOS
  // ─────────────────────────────────────────────────────────────────────────────

  const log   = (...a) => console.log  ('[SAPL]', ...a);
  const warn  = (...a) => console.warn ('[SAPL]', ...a);
  const error = (...a) => console.error('[SAPL]', ...a);

  function safeInterval(fn, ms) {
    const id = setInterval(() => { try { fn(); } catch (e) { warn('Interval error:', e); } }, ms);
    state.intervals.add(id);
    return id;
  }

  function safeTimeout(fn, ms) {
    const id = setTimeout(() => {
      state.timeouts.delete(id);
      try { fn(); } catch (e) { warn('Timeout error:', e); }
    }, ms);
    state.timeouts.add(id);
    return id;
  }

  function emitEvent(name, data = {}) {
    try {
      if (window.EventBus?.emit) window.EventBus.emit(name, data);
    } catch { /* EventBus pode não estar pronto */ }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. WATCHDOG DE HOOKS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Verifica se o hook de processRenderableMessages ainda está ativo.
   * O wpp-hooks.js envolve a função original — se o WA recarregar ou navegar,
   * o módulo pode perder o patch.
   */
  function probeHookAlive(_moduleName) {
    // The isolated content-script world has no access to page-world `require`
    // or to `window.whl_hooks_loaded` (set inside the page world). Probing
    // here always returned false and triggered endless re-init attempts.
    // Instead, treat WHL_WaBridge readiness as the canonical "alive" signal.
    try {
      const health = window.WHL_WaBridge?.healthCheck?.();
      return !!(health && health.ok);
    } catch (_) { return false; }
  }

  async function runHookWatchdog() {
    let anyBroken = false;

    for (const hookName of Object.keys(state.hookStatus)) {
      const alive = probeHookAlive(hookName);
      const wasPreviouslyAlive = state.hookStatus[hookName];

      state.hookStatus[hookName] = alive;

      if (!alive && wasPreviouslyAlive) {
        warn(`⚠️ Hook PERDIDO: ${hookName}`);
        anyBroken = true;
        emitEvent('sapl:hook_lost', { hook: hookName, ts: Date.now() });
      }
    }

    // Note: whl_hooks_loaded lives in the page world and is not visible here.
    // The bridge readiness (probed above) is the canonical signal.

    if (anyBroken) {
      await attemptHookReinit();
    }
  }

  async function attemptHookReinit() {
    if (state.hookReinitCount >= CFG.HOOK_MAX_REINIT_ATTEMPTS) {
      error('Máximo de tentativas de reinicialização atingido. Aguardando reload do usuário.');
      emitEvent('sapl:hook_reinit_failed', { attempts: state.hookReinitCount });

      // Notificar UI do sidepanel
      window.postMessage({
        type: 'WHL_SAPL_ALERT',
        severity: 'critical',
        message: '⚠️ Hooks do WhatsApp perdidos e não recuperados. Recarregue a página.',
        ts: Date.now()
      }, window.location.origin);
      return;
    }

    state.hookReinitCount++;
    log(`🔧 Tentando reinicializar hooks (tentativa ${state.hookReinitCount})...`);

    await new Promise(r => safeTimeout(r, CFG.HOOK_REINIT_DELAY_MS));

    try {
      // whl_hooks_main lives in the page world and isn't reachable from the
      // isolated content-script. We instead ping the page bridge and wait
      // for STORE_READY to fire again.
      try { window.postMessage({ source: 'WHL_ISOLATED', type: 'ping' }, '*'); } catch (_) {}
      // Give the page bridge a moment, then re-check health.
      await new Promise(r => safeTimeout(r, 1500));
      const health = window.WHL_WaBridge?.healthCheck?.();
      if (health?.ok) {
        log('✅ Page bridge reanunciou STORE_READY.');
        state.hookReinitCount = 0;
        emitEvent('sapl:hook_reinitialized', { ts: Date.now() });
        for (const k of Object.keys(state.hookStatus)) state.hookStatus[k] = true;
      } else {
        warn('Page bridge ainda não pronto — bridge não respondeu ao ping.');
      }
    } catch (e) {
      error('Erro ao reinicializar hooks:', e.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. CIRCUIT BREAKER
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Estados: CLOSED (normal) → OPEN (parado) → HALF_OPEN (testando) → CLOSED
   */
  const CB_STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

  function getOrCreateCircuit(moduleId) {
    if (!state.circuits.has(moduleId)) {
      state.circuits.set(moduleId, {
        id:             moduleId,
        state:          CB_STATE.CLOSED,
        failures:       0,
        successes:      0,
        lastFailureAt:  null,
        openedAt:       null,
        timeoutMs:      CFG.CB_TIMEOUT_BASE_MS,
        totalTrips:     0,
      });
    }
    return state.circuits.get(moduleId);
  }

  /**
   * Wraps uma função async com circuit breaker.
   * Uso: const result = await SAPL.protect('meuModulo', () => minhaFuncao());
   */
  async function circuitProtect(moduleId, fn, fallback = null) {
    const cb = getOrCreateCircuit(moduleId);

    // OPEN: verificar se o timeout de half-open expirou
    if (cb.state === CB_STATE.OPEN) {
      const elapsed = Date.now() - cb.openedAt;
      if (elapsed >= cb.timeoutMs) {
        cb.state    = CB_STATE.HALF_OPEN;
        cb.successes = 0;
        log(`Circuit ${moduleId}: OPEN → HALF_OPEN (após ${(elapsed/1000).toFixed(0)}s)`);
      } else {
        // Ainda aberto — retornar fallback sem executar
        return fallback;
      }
    }

    // CLOSED ou HALF_OPEN: tentar executar
    try {
      const result = await fn();

      // Sucesso
      if (cb.state === CB_STATE.HALF_OPEN) {
        cb.successes++;
        if (cb.successes >= CFG.CB_SUCCESS_THRESHOLD) {
          cb.state    = CB_STATE.CLOSED;
          cb.failures = 0;
          cb.timeoutMs = CFG.CB_TIMEOUT_BASE_MS; // resetar backoff
          log(`✅ Circuit ${moduleId}: HALF_OPEN → CLOSED`);
          emitEvent('sapl:circuit_closed', { module: moduleId });
        }
      } else {
        cb.failures = 0; // resetar contador em sucesso normal
      }

      return result;
    } catch (err) {
      // Falha
      cb.failures++;
      cb.lastFailureAt = Date.now();

      warn(`Circuit ${moduleId}: falha ${cb.failures}/${CFG.CB_FAILURE_THRESHOLD} — ${err.message}`);

      if (cb.failures >= CFG.CB_FAILURE_THRESHOLD || cb.state === CB_STATE.HALF_OPEN) {
        cb.state     = CB_STATE.OPEN;
        cb.openedAt  = Date.now();
        cb.totalTrips++;
        // Backoff exponencial
        cb.timeoutMs = Math.min(cb.timeoutMs * 2, CFG.CB_TIMEOUT_MAX_MS);
        error(`🔴 Circuit ${moduleId}: ABERTO (trip #${cb.totalTrips}, próxima tentativa em ${(cb.timeoutMs/1000).toFixed(0)}s)`);
        emitEvent('sapl:circuit_opened', { module: moduleId, trips: cb.totalTrips, timeoutMs: cb.timeoutMs });

        // Notificar GracefulDegradation se disponível
        if (window.GracefulDegradation?.canExecute) {
          window.GracefulDegradation.checkModule(moduleId);
        }
      }

      return fallback;
    }
  }

  function getCircuitStatus(moduleId) {
    return state.circuits.get(moduleId) || null;
  }

  function resetCircuit(moduleId) {
    const cb = getOrCreateCircuit(moduleId);
    cb.state     = CB_STATE.CLOSED;
    cb.failures  = 0;
    cb.successes = 0;
    cb.timeoutMs = CFG.CB_TIMEOUT_BASE_MS;
    log(`Circuit ${moduleId}: resetado manualmente`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. WA VERSION SENTINEL
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Calcula um hash simples do tamanho dos scripts principais do WA.
   * Não faz fetch — usa a lista de scripts já carregados no DOM.
   */
  function getBundleFingerprint() {
    try {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      const waScripts = scripts
        .map(s => s.src)
        .filter(src => src.includes('web.whatsapp.com') || src.includes('chunk'));

      if (waScripts.length === 0) return null;

      // Fingerprint = concatenação ordenada de src (hash rápido)
      const raw = waScripts.sort().join('|');
      let hash = 0;
      for (let i = 0; i < raw.length; i++) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
      }
      return hash.toString(16);
    } catch {
      return null;
    }
  }

  async function runVersionSentinel() {
    const currentHash = getBundleFingerprint();
    if (!currentHash) return;

    // Primeira vez — só salvar
    if (!state.lastBundleHash) {
      state.lastBundleHash = currentHash;
      try {
        await chrome.storage.local.set({ [CFG.SENTINEL_STORAGE_KEY]: currentHash });
      } catch { /* storage pode não estar disponível */ }
      return;
    }

    if (currentHash !== state.lastBundleHash) {
      warn(`🆕 WhatsApp Web atualizado! Hash: ${state.lastBundleHash} → ${currentHash}`);
      state.lastBundleHash = currentHash;
      state.bundleChangedAt = Date.now();
      state.selectorRescans++;

      emitEvent('sapl:wa_updated', { oldHash: state.lastBundleHash, newHash: currentHash, ts: Date.now() });

      // Acionar re-scan de seletores nos sistemas existentes
      if (window.AntiBreakSystem?.runFullHealthCheck) {
        safeTimeout(() => window.AntiBreakSystem.runFullHealthCheck(), 3000);
      }
      if (window.GracefulDegradation?.forceRecheck) {
        safeTimeout(() => window.GracefulDegradation.forceRecheck(), 3500);
      }

      // Acionar watchdog de hooks imediatamente
      safeTimeout(() => runHookWatchdog(), 5000);

      // Notificar sidepanel
      window.postMessage({
        type: 'WHL_SAPL_ALERT',
        severity: 'warning',
        message: '🆕 WhatsApp Web atualizou. Verificando compatibilidade...',
        ts: Date.now()
      }, window.location.origin);

      try {
        await chrome.storage.local.set({ [CFG.SENTINEL_STORAGE_KEY]: currentHash });
      } catch { /* ignore */ }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. SILENT FAILURE CATCHER
  // ─────────────────────────────────────────────────────────────────────────────

  function recordCaughtError(source, message, detail = null) {
    const now = Date.now();

    // Anti-flood
    if (now - state.errorFloodWindowStart > CFG.ERROR_FLOOD_WINDOW_MS) {
      state.errorFloodWindowStart = now;
      state.errorFloodCount = 0;
    }
    state.errorFloodCount++;
    if (state.errorFloodCount > CFG.ERROR_FLOOD_MAX) return; // suprimir

    const entry = { source, message: String(message).substring(0, 300), detail, ts: now };
    state.caughtErrors.push(entry);
    if (state.caughtErrors.length > CFG.MAX_CAUGHT_ERRORS) {
      state.caughtErrors.shift();
    }

    // Verificar se é erro de módulo WHL específico
    const whlModuleMatch = String(message).match(/\[WHL\s+([^\]]+)\]/);
    if (whlModuleMatch) {
      const affectedModule = whlModuleMatch[1].toLowerCase().replace(/\s+/g, '_');
      const cb = getOrCreateCircuit(affectedModule);
      if (cb.state === CB_STATE.CLOSED) {
        cb.failures++;
        cb.lastFailureAt = now;
        if (cb.failures >= CFG.CB_FAILURE_THRESHOLD) {
          cb.state    = CB_STATE.OPEN;
          cb.openedAt = now;
          cb.totalTrips++;
          cb.timeoutMs = Math.min(cb.timeoutMs * 2, CFG.CB_TIMEOUT_MAX_MS);
          warn(`🔴 Circuit ${affectedModule} aberto por erro capturado globalmente`);
          emitEvent('sapl:circuit_opened', { module: affectedModule, source: 'global_error' });
        }
      }
    }

    emitEvent('sapl:error_caught', entry);
  }

  function installGlobalErrorCatcher() {
    // Erros síncronos
    const prevOnError = window.onerror;
    window.onerror = function (msg, src, line, col, errObj) {
      if (String(msg).includes('WHL') || String(src).includes('whatshybrid') || String(src).includes('chrome-extension')) {
        recordCaughtError('window.onerror', msg, { src, line, col });
      }
      if (typeof prevOnError === 'function') return prevOnError.apply(this, arguments);
      return false; // não suprimir
    };

    // Promises rejeitadas sem handler
    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason?.message || String(e.reason) || 'UnhandledRejection';
      if (String(msg).includes('WHL') || (e.reason?.stack || '').includes('whatshybrid')) {
        recordCaughtError('unhandledrejection', msg, { stack: e.reason?.stack?.substring(0, 400) });
        // Não prevenir o comportamento padrão — só registrar
      }
    });

    log('Silent failure catcher instalado.');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. SELF-TEST SCHEDULER
  // ─────────────────────────────────────────────────────────────────────────────

  async function runSelfTest() {
    const report = {
      ts:       Date.now(),
      modules:  {},
      hooks:    { ...state.hookStatus },
      circuits: {},
      overall:  'healthy',
      details:  []
    };

    // 5a. Testar módulos críticos
    for (const modId of CFG.SELF_TEST_CRITICAL_MODULES) {
      const result = testModule(modId);
      report.modules[modId] = result;
      if (!result.ok) {
        report.details.push(`❌ ${modId}: ${result.reason}`);
        if (result.severity === 'critical') report.overall = 'critical';
        else if (report.overall === 'healthy') report.overall = 'degraded';
      }
    }

    // 5b. Resumir circuits
    for (const [id, cb] of state.circuits) {
      report.circuits[id] = { state: cb.state, failures: cb.failures, trips: cb.totalTrips };
      if (cb.state === CB_STATE.OPEN) {
        report.details.push(`🔴 Circuit ABERTO: ${id} (${cb.totalTrips} trips)`);
        if (report.overall === 'healthy') report.overall = 'degraded';
      }
    }

    // 5c. Hooks perdidos
    const brokenHooks = Object.entries(state.hookStatus).filter(([, v]) => !v).map(([k]) => k);
    if (brokenHooks.length > 0) {
      report.details.push(`⚠️ Hooks perdidos: ${brokenHooks.join(', ')}`);
      report.overall = 'degraded';
    }

    // 5d. Erros recentes
    if (state.caughtErrors.length > 10) {
      report.details.push(`📋 ${state.caughtErrors.length} erros capturados globalmente`);
    }

    state.lastSelfTest = report;
    state.selfTestHistory.push({ ts: report.ts, overall: report.overall });
    if (state.selfTestHistory.length > 30) state.selfTestHistory.shift();

    // Log colorido
    const statusIcon = { healthy: '✅', degraded: '⚠️', critical: '🚨' }[report.overall] || '❓';
    if (report.details.length === 0) {
      log(`${statusIcon} Self-test: ${report.overall}`);
    } else {
      warn(`${statusIcon} Self-test: ${report.overall}\n  ${report.details.join('\n  ')}`);
    }

    emitEvent('sapl:self_test', report);

    // Notificar sidepanel
    window.postMessage({ type: 'WHL_SAPL_SELF_TEST', report }, window.location.origin);

    // Se degradado, tentar auto-heal
    if (report.overall !== 'healthy') {
      safeTimeout(() => runAutoHeal(report), 2000);
    }

    return report;
  }

  function testModule(modId) {
    switch (modId) {
      case 'whl_hooks': {
        const health = window.WHL_WaBridge?.healthCheck?.();
        return (health && health.ok)
          ? { ok: true }
          : { ok: false, reason: 'WHL_WaBridge não pronto', severity: 'critical' };
      }

      case 'recover':
        return window.RecoverAdvanced
          ? { ok: true }
          : { ok: false, reason: 'RecoverAdvanced não encontrado', severity: 'warning' };

      case 'privacy_shield':
        return window.WHL_PrivacyShield
          ? { ok: true }
          : { ok: false, reason: 'WHL_PrivacyShield não encontrado', severity: 'warning' };

      case 'status_download':
        return window.WHL_StatusDownload
          ? { ok: true }
          : { ok: false, reason: 'WHL_StatusDownload não encontrado', severity: 'warning' };

      case 'view_once_saver':
        return window.WHL_ViewOnceSaver
          ? { ok: true }
          : { ok: false, reason: 'WHL_ViewOnceSaver não encontrado', severity: 'warning' };

      default:
        return window[modId] ? { ok: true } : { ok: false, reason: 'Não encontrado', severity: 'warning' };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AUTO-HEAL ORQUESTRADO
  // ─────────────────────────────────────────────────────────────────────────────

  async function runAutoHeal(selfTestReport) {
    log('🔧 Auto-heal iniciado...');
    const healed = [];
    const failed = [];

    // 1. Delegar ao AntiBreakSystem se disponível
    if (window.AntiBreakSystem?.tryAutoHeal) {
      try {
        const r = await window.AntiBreakSystem.tryAutoHeal();
        healed.push(...(r.fixed || []));
        failed.push(...(r.failed || []));
      } catch (e) {
        warn('AntiBreakSystem.tryAutoHeal falhou:', e.message);
      }
    }

    // 2. Reinicializar hooks se necessário
    if (selfTestReport?.modules?.whl_hooks?.ok === false) {
      await attemptHookReinit();
      const health = window.WHL_WaBridge?.healthCheck?.();
      if (health && health.ok) {
        healed.push('whl_hooks');
      } else {
        failed.push('whl_hooks');
      }
    }

    // 3. Half-open circuits que passaram do timeout
    for (const [id, cb] of state.circuits) {
      if (cb.state === CB_STATE.OPEN && Date.now() - cb.openedAt >= cb.timeoutMs) {
        cb.state = CB_STATE.HALF_OPEN;
        log(`Circuit ${id}: OPEN → HALF_OPEN (auto-heal)`);
      }
    }

    // 4. Re-scan de seletores via GracefulDegradation
    if (window.GracefulDegradation?.forceRecheck) {
      try {
        await window.GracefulDegradation.forceRecheck();
        healed.push('selectors_rescan');
      } catch (e) {
        warn('GracefulDegradation.forceRecheck falhou:', e.message);
      }
    }

    log(`Auto-heal concluído. Corrigidos: [${healed.join(', ')}] | Falhos: [${failed.join(', ')}]`);
    emitEvent('sapl:auto_heal_done', { healed, failed, ts: Date.now() });

    return { healed, failed };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. ORCHESTRATION BUS — listeners de postMessage do sidepanel
  // ─────────────────────────────────────────────────────────────────────────────

  function installMessageBridge() {
    window.addEventListener('message', async (e) => {
      if (e.origin !== window.location.origin) return;
      const { type } = e.data || {};

      if (type === 'WHL_SAPL_GET_STATUS') {
        window.postMessage({
          type: 'WHL_SAPL_STATUS',
          status: SAPL.getFullStatus()
        }, window.location.origin);
      }

      if (type === 'WHL_SAPL_FORCE_HEAL') {
        const report = state.lastSelfTest;
        const result = await runAutoHeal(report);
        window.postMessage({ type: 'WHL_SAPL_HEAL_RESULT', result }, window.location.origin);
      }

      if (type === 'WHL_SAPL_FORCE_SELF_TEST') {
        await runSelfTest();
      }

      if (type === 'WHL_SAPL_RESET_CIRCUIT') {
        if (e.data.module) resetCircuit(e.data.module);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // INICIALIZAÇÃO
  // ─────────────────────────────────────────────────────────────────────────────

  async function init() {
    if (state.initialized) return;
    state.initialized = true;

    log('🔰 Inicializando SAPL v1.0...');

    // Instalar captura global de erros imediatamente (antes de qualquer outra coisa)
    installGlobalErrorCatcher();

    // Instalar bridge do sidepanel
    installMessageBridge();

    // Aguardar o WhatsApp e os hooks carregarem
    await waitForHooksReady();

    // Marcar estado inicial dos hooks
    for (const k of Object.keys(state.hookStatus)) {
      state.hookStatus[k] = probeHookAlive(k);
    }

    // Carregar fingerprint salvo do bundle WA
    try {
      const stored = await chrome.storage.local.get(CFG.SENTINEL_STORAGE_KEY);
      state.lastBundleHash = stored[CFG.SENTINEL_STORAGE_KEY] || null;
    } catch { /* ignore */ }

    // Iniciar loops periódicos
    safeInterval(runHookWatchdog,    CFG.HOOK_CHECK_INTERVAL_MS);
    safeInterval(runVersionSentinel, CFG.SENTINEL_CHECK_INTERVAL_MS);
    safeInterval(runSelfTest,        CFG.SELF_TEST_INTERVAL_MS);

    // Self-test inicial (após delay para módulos carregarem)
    safeTimeout(runSelfTest, 8000);

    log('✅ SAPL iniciado. Protegendo o sistema...');
    emitEvent('sapl:initialized', { ts: Date.now() });

    // Notificar sidepanel
    window.postMessage({ type: 'WHL_SAPL_READY', ts: Date.now() }, window.location.origin);
  }

  async function waitForHooksReady(maxWaitMs = 30_000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const health = window.WHL_WaBridge?.healthCheck?.();
      if (health && health.ok) return true;
      await new Promise(r => setTimeout(r, 500));
    }
    warn('Timeout aguardando hooks do WA. Continuando mesmo assim.');
    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // API PÚBLICA
  // ─────────────────────────────────────────────────────────────────────────────

  const SAPL = {
    // Identificação
    version: '1.0.0',
    name: 'System Auto-Protection Layer',

    // Circuit Breaker
    protect:          circuitProtect,
    getCircuit:       getCircuitStatus,
    resetCircuit:     resetCircuit,
    getAllCircuits:    () => Object.fromEntries(state.circuits),

    // Watchdog
    checkHooks:       runHookWatchdog,
    reinitHooks:      attemptHookReinit,
    getHookStatus:    () => ({ ...state.hookStatus }),

    // Sentinel
    checkWAVersion:   runVersionSentinel,
    getBundleHash:    () => state.lastBundleHash,
    getBundleChanges: () => state.selectorRescans,

    // Self-test
    selfTest:         runSelfTest,
    getLastSelfTest:  () => state.lastSelfTest,
    getSelfTestHistory: () => [...state.selfTestHistory],

    // Auto-heal
    heal:             () => runAutoHeal(state.lastSelfTest),

    // Erros
    getCaughtErrors:  () => [...state.caughtErrors],
    clearErrors:      () => { state.caughtErrors.length = 0; },

    // Status completo
    getFullStatus() {
      return {
        version:          this.version,
        uptime:           Date.now() - state.startTime,
        hooks:            { ...state.hookStatus },
        hookReinitCount:  state.hookReinitCount,
        circuits:         Object.fromEntries(
          [...state.circuits].map(([k, v]) => [k, { state: v.state, failures: v.failures, trips: v.totalTrips }])
        ),
        bundleHash:       state.lastBundleHash,
        bundleChangedAt:  state.bundleChangedAt,
        selectorRescans:  state.selectorRescans,
        lastSelfTest:     state.lastSelfTest
          ? { ts: state.lastSelfTest.ts, overall: state.lastSelfTest.overall }
          : null,
        caughtErrors:     state.caughtErrors.length,
        initialized:      state.initialized,
      };
    },

    // Forçar execução imediata de todos os checks
    async forceFullCheck() {
      await runHookWatchdog();
      await runVersionSentinel();
      return runSelfTest();
    },

    // Init
    init,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────────────────────

  window.addEventListener('beforeunload', () => {
    state.intervals.forEach(id => clearInterval(id));
    state.timeouts.forEach(id => clearTimeout(id));
    state.intervals.clear();
    state.timeouts.clear();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPOSIÇÃO GLOBAL E AUTO-INIT
  // ─────────────────────────────────────────────────────────────────────────────

  window.SAPL = SAPL;

  // Registrar no EventBus quando disponível
  setTimeout(() => {
    if (window.EventBus?.emit) {
      window.EventBus.emit('system:module_loaded', { module: 'SAPL', status: 'ready' });
    }
  }, 1000);

  // Auto-init com delay para garantir que WA e outros módulos carregaram
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 4000));
  } else {
    setTimeout(init, 4000);
  }

  console.log('[SAPL] 🔰 Módulo carregado — aguardando inicialização...');

})();
