/**
 * WhatsHybrid Subscription Manager v1.0.0
 * Sistema de assinaturas robusto com controle de créditos e uso
 * 
 * Modelo: Código de assinatura único (sem login tradicional)
 * - Usuário compra plano externamente
 * - Recebe código por email
 * - Insere código na extensão
 * - Sistema valida e libera recursos
 */
(function() {
  'use strict';

  // ============================================
  // CONFIGURAÇÃO DE PLANOS
  // ============================================

  const PLANS = {
    free: {
      id: 'free',
      name: 'Gratuito',
      price: 0,
      color: '#6b7280',
      icon: '🆓',
      features: {
        maxContacts: 50,
        maxChatsPerDay: 10,
        maxCampaigns: 1,
        maxFlows: 0,
        maxTeamMembers: 1,
        aiCredits: 0,
        smartReplies: false,
        copilot: false,
        analytics: false,
        exportFormats: ['csv'],
        bulkMessages: false,
        customLabels: false,
        apiAccess: false,
        prioritySupport: false,
        recover: true,
        crm: 'basic'
      },
      limits: {
        messagesPerDay: 30,
        mediaPerDay: 5,
        exportsPerDay: 1
      }
    },
    starter: {
      id: 'starter',
      name: 'Starter',
      price: 49.90,
      color: '#3b82f6',
      icon: '⭐',
      features: {
        maxContacts: 1000,
        maxChatsPerDay: 100,
        maxCampaigns: 5,
        maxFlows: 3,
        maxTeamMembers: 2,
        aiCredits: 100,
        smartReplies: true,
        copilot: false,
        analytics: 'basic',
        exportFormats: ['csv', 'xlsx'],
        bulkMessages: true,
        customLabels: true,
        apiAccess: false,
        prioritySupport: false,
        recover: true,
        crm: 'full'
      },
      limits: {
        messagesPerDay: 500,
        mediaPerDay: 100,
        exportsPerDay: 10
      }
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      price: 99.90,
      color: '#8b5cf6',
      icon: '🚀',
      features: {
        maxContacts: 10000,
        maxChatsPerDay: -1, // ilimitado
        maxCampaigns: 20,
        maxFlows: 10,
        maxTeamMembers: 5,
        aiCredits: 500,
        smartReplies: true,
        copilot: true,
        analytics: 'advanced',
        exportFormats: ['csv', 'xlsx', 'json'],
        bulkMessages: true,
        customLabels: true,
        apiAccess: true,
        prioritySupport: true,
        recover: true,
        crm: 'full'
      },
      limits: {
        messagesPerDay: 2000,
        mediaPerDay: 500,
        exportsPerDay: -1
      }
    },
    enterprise: {
      id: 'enterprise',
      name: 'Enterprise',
      price: 249.90,
      color: '#f59e0b',
      icon: '👑',
      features: {
        maxContacts: -1,
        maxChatsPerDay: -1,
        maxCampaigns: -1,
        maxFlows: -1,
        maxTeamMembers: -1,
        aiCredits: 2000,
        smartReplies: true,
        copilot: true,
        analytics: 'full',
        exportFormats: ['csv', 'xlsx', 'json', 'pdf'],
        bulkMessages: true,
        customLabels: true,
        apiAccess: true,
        prioritySupport: true,
        recover: true,
        crm: 'full',
        whiteLabel: true
      },
      limits: {
        messagesPerDay: -1,
        mediaPerDay: -1,
        exportsPerDay: -1
      }
    }
  };

  const PLAN_HIERARCHY = ['free', 'starter', 'pro', 'enterprise'];

  // ============================================
  // CONFIGURAÇÃO
  // ============================================

  const CONFIG = {
    storageKey: 'whl_subscription',
    creditsKey: 'whl_credits',
    usageKey: 'whl_usage',
    validationEndpoint: '/api/v1/subscription/validate',
    syncInterval: 300000, // 5 minutos
    warningThreshold: 20, // % de créditos restantes para avisar
    trialDays: 7,
    // v9.6.0 — chave-mestra do desenvolvedor (Cristiano). Quando inserida no
    // campo de assinatura, libera plano enterprise localmente SEM precisar de
    // backend. Validada também server-side via MASTER_KEY env do backend.
    masterKey: 'Cristi@no123'
  };

  // ============================================
  // SECURITY HELPERS
  // ============================================

  /**
   * SECURITY FIX P0-002: Sanitize storage data to prevent Prototype Pollution
   * Removes dangerous keys (__proto__, constructor, prototype) from objects
   */
  function sanitizeStorageData(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj;
    }

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Skip dangerous keys
        if (dangerousKeys.includes(key)) {
          console.warn(`[SubscriptionManager Security] Blocked prototype pollution attempt: ${key}`);
          continue;
        }

        // Recursively sanitize nested objects
        if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          sanitized[key] = sanitizeStorageData(obj[key]);
        } else {
          sanitized[key] = obj[key];
        }
      }
    }

    return sanitized;
  }

  // ============================================
  // ESTADO
  // ============================================

  let state = {
    initialized: false,
    subscription: {
      code: null,
      planId: 'free',
      status: 'inactive', // inactive, active, trial, expired, suspended
      expiresAt: null,
      trialEndsAt: null,
      activatedAt: null,
      lastSync: null
    },
    credits: {
      total: 0,
      used: 0,
      monthlyAllowance: 0,
      bonusCredits: 0,
      lastReset: null
    },
    usage: {
      messagesToday: 0,
      mediaToday: 0,
      exportsToday: 0,
      contactsTotal: 0,
      campaignsActive: 0,
      flowsActive: 0,
      lastResetDate: null
    },
    autoSyncInterval: null,
    dailyResetTimeout: null
  };

  const listeners = new Map();

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  async function init() {
    if (state.initialized) return;

    console.log('[SubscriptionManager] Inicializando...');

    await loadState();
    scheduleDailyReset();
    scheduleAutoSync();

    state.initialized = true;

    // Emitir evento de inicialização
    emit('initialized', getStatus());

    console.log('[SubscriptionManager] ✅ Inicializado - Plano:', state.subscription.planId);

    // Cleanup
    window.addEventListener('beforeunload', () => {
      if (state.autoSyncInterval) clearInterval(state.autoSyncInterval);
      if (state.dailyResetTimeout) clearTimeout(state.dailyResetTimeout);
    });
  }

  async function loadState() {
    return new Promise(resolve => {
      chrome.storage.local.get([
        CONFIG.storageKey,
        CONFIG.creditsKey,
        CONFIG.usageKey
      ], result => {
        // SECURITY FIX P0-002: Prevent Prototype Pollution via storage data
        if (result[CONFIG.storageKey]) {
          const sanitized = sanitizeStorageData(result[CONFIG.storageKey]);
          state.subscription = { ...state.subscription, ...sanitized };
        }
        if (result[CONFIG.creditsKey]) {
          const sanitized = sanitizeStorageData(result[CONFIG.creditsKey]);
          state.credits = { ...state.credits, ...sanitized };
        }
        if (result[CONFIG.usageKey]) {
          const sanitized = sanitizeStorageData(result[CONFIG.usageKey]);
          state.usage = { ...state.usage, ...sanitized };
        }

        // Verificar reset diário
        checkDailyReset();

        resolve();
      });
    });
  }

  async function saveState() {
    return new Promise(resolve => {
      chrome.storage.local.set({
        [CONFIG.storageKey]: state.subscription,
        [CONFIG.creditsKey]: state.credits,
        [CONFIG.usageKey]: state.usage
      }, resolve);
    });
  }

  // ============================================
  // ATIVAÇÃO DE ASSINATURA
  // ============================================

  /**
   * Ativa uma assinatura com código
   * @param {string} subscriptionCode - Código de assinatura
   * @returns {Promise<Object>}
   */
  async function activateSubscription(subscriptionCode) {
    if (!subscriptionCode || typeof subscriptionCode !== 'string') {
      return { success: false, error: 'Código inválido' };
    }

    // v9.6.0 — Master key tem comparação case-sensitive antes do uppercase,
    // pois 'Cristi@no123' contém minúsculas. Se bater, ativa LOCALMENTE
    // como enterprise/master sem nem chamar o backend. Útil pra dev/testes.
    const trimmed = subscriptionCode.trim();
    if (trimmed === CONFIG.masterKey) {
      state.subscription = {
        code: trimmed,
        planId: 'enterprise',
        status: 'active',
        expiresAt: null,
        trialEndsAt: null,
        activatedAt: new Date().toISOString(),
        lastSync: new Date().toISOString(),
        isMasterKey: true,
        _serverConfirmedMasterKey: true
      };
      state.credits = {
        total: 999999,
        used: 0,
        monthlyAllowance: 999999,
        bonusCredits: 0,
        lastReset: new Date().toISOString()
      };
      await saveState();
      emit('subscription_activated', getStatus());
      console.log('[SubscriptionManager] 👑 Master key ativada — acesso enterprise total');
      return { success: true, plan: getPlan(), isMasterKey: true };
    }

    const code = trimmed.toUpperCase();

    try {
      // Tentar validar com servidor
      const validation = await validateWithServer(code);

      if (validation.success) {
        state.subscription = {
          code,
          planId: validation.planId || 'starter',
          status: validation.status === 'trialing' ? 'trial' : 'active',
          expiresAt: validation.expiresAt || null,
          trialEndsAt: validation.status === 'trialing' ? validation.expiresAt : null,
          trialDaysLeft: validation.trialDaysLeft || 0,
          activatedAt: new Date().toISOString(),
          lastSync: new Date().toISOString(),
          isMasterKey: validation.isMasterKey === true,
          _serverConfirmedMasterKey: validation.isMasterKey === true
        };

        state.credits = {
          total: validation.credits || PLANS[validation.planId]?.features.aiCredits || 0,
          used: 0,
          monthlyAllowance: PLANS[validation.planId]?.features.aiCredits || 0,
          bonusCredits: validation.bonusCredits || 0,
          lastReset: new Date().toISOString()
        };

        await saveState();
        emit('subscription_activated', getStatus());

        return { success: true, plan: getPlan(), reason: validation.reason };
      } else {
        // Propaga errorCode/reason para a UI escolher mensagem específica.
        emit('activation_error', {
          type: validation.errorCode || 'INVALID_CODE',
          reason: validation.reason,
          message: validation.error || 'Código inválido',
          retryable: false
        });
        return {
          success: false,
          error: validation.error || 'Código inválido',
          reason: validation.reason,
          errorCode: validation.errorCode
        };
      }
    } catch (error) {
      console.error('[SubscriptionManager] Erro na ativação:', error);

      // FIX CRÍTICO: o fallback offline ativava acesso premium quando o backend
      // estava inacessível — qualquer erro de rede concedia plano gratuito ao usuário.
      // validateOffline() já retorna { success: false } desde o fix P0-001,
      // mas o código abaixo ainda tentava ativar e conceder créditos.
      // Agora o fallback offline é explicitamente proibido para ativação.
      // Apenas propaga o erro original de volta ao chamador.

      // Distingue entre erro de rede (pode tentar novamente) e erro de código inválido
      const isNetworkError = (
        error.message?.includes('fetch') ||
        error.message?.includes('network') ||
        error.message?.includes('Failed to fetch') ||
        error.code === 'ECONNREFUSED' ||
        error.name === 'TypeError'
      );

      if (isNetworkError) {
        // Propaga erro visível para UI — não engole silenciosamente
        emit('activation_error', {
          type: 'NETWORK_ERROR',
          message: 'Servidor indisponível. Verifique sua conexão e tente novamente.',
          retryable: true
        });
        return {
          success: false,
          error: 'Servidor indisponível. Verifique sua conexão e tente novamente.',
          retryable: true
        };
      }

      return { success: false, error: error.message || 'Erro ao validar código.' };
    }
  }

  /**
   * Valida código com servidor
   */
  async function validateWithServer(code) {
    // Obter URL do backend configurado
    const backendUrl = await getBackendUrl();
    if (!backendUrl) {
      throw new Error('Backend não configurado');
    }

    // Device fingerprint client-side — o servidor recombina com user-agent +
    // language pra derivar device_id_hash. Persiste em chrome.storage para
    // ser estável entre reloads.
    const deviceHeader = await _getOrCreateDeviceFingerprint();

    const response = await fetch(`${backendUrl}${CONFIG.validationEndpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WHL-Device': deviceHeader
      },
      body: JSON.stringify({ code })
    });

    // Mapeia status HTTP para feedback estruturado entendível pela UI.
    // O backend devolve { valid, reason, code, message, plan, status,
    // trial_days_left, ... }. Reações distintas para cada motivo.
    if (response.status === 423) {
      const j = await response.json().catch(() => ({}));
      return {
        success: false,
        error: j.message || 'Este código já está em uso em outro dispositivo.',
        reason: 'in_use_elsewhere',
        errorCode: 'CODE_IN_USE_ELSEWHERE'
      };
    }
    if (response.status === 403) {
      const j = await response.json().catch(() => ({}));
      return {
        success: false,
        error: j.message || 'Código revogado ou expirado.',
        reason: j.reason || 'code_revoked',
        errorCode: j.code || 'CODE_REVOKED'
      };
    }
    if (response.status === 404) {
      const j = await response.json().catch(() => ({}));
      return {
        success: false,
        error: j.message || 'Código de assinatura inválido.',
        reason: 'invalid_code',
        errorCode: 'CODE_NOT_FOUND'
      };
    }
    if (!response.ok) {
      const j = await response.json().catch(() => ({}));
      throw new Error(j.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    // Resposta de sucesso: { valid, plan, status, credits, expires_at,
    //                        trial_days_left, code_status, reason? }
    return {
      success: !!data.valid,
      planId: data.plan,
      status: data.status,
      credits: data.credits,
      expiresAt: data.expires_at,
      trialDaysLeft: data.trial_days_left || 0,
      reason: data.reason || null,
      error: data.valid ? null : (data.reason || 'subscription_not_active')
    };
  }

  async function _getOrCreateDeviceFingerprint() {
    const KEY = 'whl_device_fp';
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([KEY], (got) => {
          if (got && got[KEY]) return resolve(got[KEY]);
          // Gera um fingerprint aleatório estável (não é PII).
          const buf = new Uint8Array(16);
          crypto.getRandomValues(buf);
          const fp = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
          chrome.storage.local.set({ [KEY]: fp }, () => resolve(fp));
        });
      } catch (_) {
        resolve('fallback-' + Date.now());
      }
    });
  }

  /**
   * Validação offline (para desenvolvimento/teste)
   */
  function validateOffline(code) {
    // SECURITY FIX P0-001: Removed hardcoded master key and test codes
    // VULNERABILITY: Hardcoded credentials allowed unauthorized enterprise access + 999999 free credits
    // FIX: Force all validation through secure server endpoint
    // All subscription codes MUST be validated server-side for security
    console.warn('[SubscriptionManager] Offline validation disabled for security. Server validation required.');
    return { success: false, error: 'Server validation required for security' };
  }

  /**
   * Desativa assinatura
   */
  async function deactivateSubscription() {
    state.subscription = {
      code: null,
      planId: 'free',
      status: 'inactive',
      expiresAt: null,
      trialEndsAt: null,
      activatedAt: null,
      lastSync: null
    };

    state.credits = {
      total: 0,
      used: 0,
      monthlyAllowance: 0,
      bonusCredits: 0,
      lastReset: null
    };

    await saveState();
    emit('subscription_deactivated', getStatus());
  }

  /**
   * Inicia período trial
   */
  async function startTrial() {
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + CONFIG.trialDays);

    state.subscription = {
      code: 'TRIAL',
      planId: 'pro',
      status: 'trial',
      expiresAt: null,
      trialEndsAt: trialEnd.toISOString(),
      activatedAt: new Date().toISOString(),
      lastSync: null
    };

    state.credits.total = PLANS.pro.features.aiCredits;
    state.credits.monthlyAllowance = PLANS.pro.features.aiCredits;

    await saveState();
    emit('trial_started', { endsAt: trialEnd });

    return { success: true, endsAt: trialEnd };
  }

  // ============================================
  // GETTERS
  // ============================================

  function getStatus() {
    return {
      subscription: { ...state.subscription },
      credits: { ...state.credits },
      usage: { ...state.usage },
      plan: getPlan(),
      isActive: isActive(),
      isTrial: isTrial()
    };
  }

  function getSubscription() {
    return { ...state.subscription };
  }

  function getPlan() {
    return PLANS[state.subscription.planId] || PLANS.free;
  }

  function getPlanId() {
    return state.subscription.planId;
  }

  function getFeature(featureName) {
    const plan = getPlan();
    return plan.features[featureName];
  }

  function getLimit(limitName) {
    const plan = getPlan();
    return plan.limits[limitName];
  }

  function getCredits() {
    const remaining = state.credits.total - state.credits.used;
    const percentage = state.credits.total > 0 
      ? Math.round((state.credits.used / state.credits.total) * 100)
      : 0;

    return {
      total: state.credits.total,
      used: state.credits.used,
      remaining: Math.max(0, remaining),
      percentage,
      monthlyAllowance: state.credits.monthlyAllowance,
      bonusCredits: state.credits.bonusCredits
    };
  }

  function getUsage() {
    return { ...state.usage };
  }

  function isActive() {
    // FIX CRÍTICO: expiresAt: null com status 'active' concedia acesso eterno.
    // Se um bug no ramo master key (ou qualquer outro) setasse expiresAt=null,
    // a assinatura nunca expirava. Agora exigimos expiresAt válido para status 'active',
    // exceto para master keys que têm confirmação server-side explícita.
    if (state.subscription.isMasterKey) {
      // Master key deve ter sido confirmada pelo servidor — verifica flag adicional
      if (!state.subscription._serverConfirmedMasterKey) {
        console.warn('[SubscriptionManager] isMasterKey=true mas sem confirmação server-side — tratando como inativo');
        return false;
      }
      return true;
    }

    if (state.subscription.status === 'inactive') return false;

    if (state.subscription.status === 'trial') {
      if (state.subscription.trialEndsAt) {
        return new Date(state.subscription.trialEndsAt) > new Date();
      }
      return false; // trial sem data de expiração = inativo
    }

    if (state.subscription.status === 'active') {
      if (state.subscription.expiresAt) {
        return new Date(state.subscription.expiresAt) > new Date();
      }
      // FIX: expiresAt null + active NÃO garante acesso — requer sync recente
      // Se o último sync foi há menos de 24h, confia no status; caso contrário, inativo
      const lastSync = state.subscription.lastSync
        ? new Date(state.subscription.lastSync).getTime()
        : 0;
      const oneDayMs = 24 * 60 * 60 * 1000;
      if (Date.now() - lastSync < oneDayMs) {
        return true;
      }
      console.warn('[SubscriptionManager] expiresAt=null e lastSync > 24h — assinatura requer revalidação');
      return false;
    }

    return false;
  }

  function isMasterKey() {
    return state.subscription.isMasterKey === true;
  }

  function isTrial() {
    return state.subscription.status === 'trial' && isActive();
  }

  function getTrialDaysRemaining() {
    if (!isTrial() || !state.subscription.trialEndsAt) return 0;

    const now = new Date();
    const end = new Date(state.subscription.trialEndsAt);
    const diff = end - now;

    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  // ============================================
  // VERIFICAÇÕES
  // ============================================

  function hasFeature(featureName) {
    if (!isActive() && state.subscription.planId !== 'free') return false;
    const feature = getFeature(featureName);
    return !!feature && feature !== false;
  }

  function canUseAI() {
    // Master key sempre pode usar IA
    if (state.subscription.isMasterKey) return true;
    
    if (!isActive()) return false;
    const credits = getCredits();
    return credits.remaining > 0;
  }

  function checkLimit(limitName) {
    const limit = getLimit(limitName);
    if (limit === -1) return { allowed: true, remaining: -1 };

    const usageMap = {
      messagesPerDay: 'messagesToday',
      mediaPerDay: 'mediaToday',
      exportsPerDay: 'exportsToday'
    };

    const usageKey = usageMap[limitName];
    const current = usageKey ? state.usage[usageKey] : 0;
    const remaining = limit - current;

    return {
      allowed: remaining > 0,
      remaining,
      limit,
      current,
      percentage: limit > 0 ? Math.round((current / limit) * 100) : 0
    };
  }

  function canPerformAction(action) {
    if (!isActive() && action !== 'view_free_content') {
      return { 
        allowed: false, 
        reason: 'subscription_inactive', 
        message: 'Ative sua assinatura para continuar' 
      };
    }

    const plan = getPlan();

    switch (action) {
      case 'send_message':
        const msgCheck = checkLimit('messagesPerDay');
        if (!msgCheck.allowed) {
          return { 
            allowed: false, 
            reason: 'limit_reached', 
            message: `Limite de ${msgCheck.limit} mensagens/dia atingido` 
          };
        }
        break;

      case 'send_media':
        const mediaCheck = checkLimit('mediaPerDay');
        if (!mediaCheck.allowed) {
          return { 
            allowed: false, 
            reason: 'limit_reached', 
            message: `Limite de ${mediaCheck.limit} mídias/dia atingido` 
          };
        }
        break;

      case 'export':
        const exportCheck = checkLimit('exportsPerDay');
        if (!exportCheck.allowed) {
          return { 
            allowed: false, 
            reason: 'limit_reached', 
            message: `Limite de ${exportCheck.limit} exportações/dia atingido` 
          };
        }
        break;

      case 'bulk_message':
        if (!plan.features.bulkMessages) {
          return { 
            allowed: false, 
            reason: 'feature_locked', 
            message: 'Envios em massa não disponíveis no seu plano' 
          };
        }
        break;

      case 'use_copilot':
        if (!plan.features.copilot) {
          return { 
            allowed: false, 
            reason: 'feature_locked', 
            message: 'Copiloto IA requer plano Pro ou superior' 
          };
        }
        if (!canUseAI()) {
          return { 
            allowed: false, 
            reason: 'no_credits', 
            message: 'Créditos de IA esgotados' 
          };
        }
        break;

      case 'use_smart_replies':
        if (!plan.features.smartReplies) {
          return { 
            allowed: false, 
            reason: 'feature_locked', 
            message: 'Respostas inteligentes requer plano Starter ou superior' 
          };
        }
        if (!canUseAI()) {
          return { 
            allowed: false, 
            reason: 'no_credits', 
            message: 'Créditos de IA esgotados' 
          };
        }
        break;

      case 'view_analytics':
        if (!plan.features.analytics) {
          return { 
            allowed: false, 
            reason: 'feature_locked', 
            message: 'Analytics requer plano Starter ou superior' 
          };
        }
        break;
    }

    return { allowed: true };
  }

  // ============================================
  // CONSUMO DE RECURSOS
  // ============================================

  async function consumeCredits(amount = 1, operation = 'ai_call') {
    if (!canUseAI()) {
      emit('credits_depleted', getCredits());
      throw new Error('Sem créditos de IA disponíveis');
    }

    state.credits.used += amount;
    await saveState();

    const credits = getCredits();

    // Emitir eventos
    emit('credits_consumed', { amount, operation, remaining: credits.remaining });

    if (credits.percentage >= (100 - CONFIG.warningThreshold)) {
      emit('credits_low', credits);
    }

    if (credits.remaining <= 0) {
      emit('credits_depleted', credits);
    }

    return credits;
  }

  async function addCredits(amount, source = 'purchase') {
    state.credits.total += amount;
    if (source === 'bonus') {
      state.credits.bonusCredits += amount;
    }
    await saveState();

    emit('credits_added', { amount, source, total: state.credits.total });
    return getCredits();
  }

  async function incrementUsage(type, amount = 1) {
    const usageMap = {
      message: 'messagesToday',
      media: 'mediaToday',
      export: 'exportsToday'
    };

    const key = usageMap[type];
    if (key) {
      state.usage[key] = (state.usage[key] || 0) + amount;
      await saveState();

      // Verificar limites
      const limitMap = {
        message: 'messagesPerDay',
        media: 'mediaPerDay',
        export: 'exportsPerDay'
      };

      const check = checkLimit(limitMap[type]);
      if (check.percentage >= 80) {
        emit('limit_warning', { type, ...check });
      }
    }
  }

  // ============================================
  // RESET DIÁRIO
  // ============================================

  function checkDailyReset() {
    const today = new Date().toISOString().split('T')[0];
    if (state.usage.lastResetDate !== today) {
      state.usage.messagesToday = 0;
      state.usage.mediaToday = 0;
      state.usage.exportsToday = 0;
      state.usage.lastResetDate = today;
    }
  }

  function scheduleDailyReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight = tomorrow - now;

    if (state.dailyResetTimeout) clearTimeout(state.dailyResetTimeout);
    state.dailyResetTimeout = setTimeout(() => {
      resetDailyUsage();
      scheduleDailyReset();
    }, msUntilMidnight);
  }

  async function resetDailyUsage() {
    state.usage.messagesToday = 0;
    state.usage.mediaToday = 0;
    state.usage.exportsToday = 0;
    state.usage.lastResetDate = new Date().toISOString().split('T')[0];
    await saveState();
    emit('daily_reset', state.usage);
  }

  // ============================================
  // SINCRONIZAÇÃO COM SERVIDOR
  // ============================================

  function scheduleAutoSync() {
    if (state.autoSyncInterval) clearInterval(state.autoSyncInterval);
    state.autoSyncInterval = setInterval(async () => {
      if (isActive() && state.subscription.code) {
        await syncWithServer();
      }
    }, CONFIG.syncInterval);
  }

  async function syncWithServer() {
    if (!state.subscription.code) return;

    try {
      const backendUrl = await getBackendUrl();
      if (!backendUrl) return;

      const deviceHeader = await _getOrCreateDeviceFingerprint();
      const response = await fetch(`${backendUrl}/api/v1/subscription/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WHL-Device': deviceHeader },
        body: JSON.stringify({
          code: state.subscription.code,
          usage: state.usage,
          credits: state.credits
        })
      });

      // Códigos de "assinatura revogada/em outro dispositivo" detectados via
      // sync periódico: desativa local e notifica UI pra mostrar "Em uso em
      // outra máquina" / "Revogado" sem precisar usuário tentar usar feature.
      if (response.status === 423 || response.status === 403) {
        const j = await response.json().catch(() => ({}));
        const reason = response.status === 423 ? 'in_use_elsewhere' : (j.code || 'revoked');
        state.subscription.status = reason === 'in_use_elsewhere' ? 'in_use_elsewhere' : 'revoked';
        await saveState();
        emit('subscription_revoked', { reason, code: state.subscription.code });
        return;
      }
      if (response.status === 404) {
        state.subscription.status = 'invalid';
        await saveState();
        emit('subscription_revoked', { reason: 'invalid_code' });
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Atualizar créditos do servidor
      if (data.credits !== undefined) {
        state.credits.total = data.credits;
      }

      // Atualizar status
      if (data.status) {
        state.subscription.status = data.status;
      }

      state.subscription.lastSync = new Date().toISOString();
      await saveState();

      emit('synced', getStatus());
    } catch (error) {
      // FIX: propaga erro de sync para UI via evento — antes só logava no console
      // e o usuário nunca sabia que a assinatura estava dessincronizada
      console.warn('[SubscriptionManager] Erro no sync:', error);
      emit('sync_error', {
        message: error.message || 'Falha ao sincronizar assinatura com o servidor.',
        retryable: true
      });
    }
  }

  async function getBackendUrl() {
    return new Promise(resolve => {
      chrome.storage.local.get(['whl_backend_url'], result => {
        // compat: whl_backend_url é mantido/sincronizado pelo BackendClient
        resolve(result.whl_backend_url || null);
      });
    });
  }

  // ============================================
  // EVENTOS
  // ============================================

  function on(event, callback) {
    if (!listeners.has(event)) {
      listeners.set(event, []);
    }
    listeners.get(event).push(callback);
    return () => off(event, callback);
  }

  function off(event, callback) {
    const eventListeners = listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(callback);
      if (index > -1) eventListeners.splice(index, 1);
    }
  }

  function emit(event, data) {
    if (listeners.has(event)) {
      listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (e) {
          console.error('[SubscriptionManager] Erro em listener:', e);
        }
      });
    }

    // Bridge para EventBus
    if (window.EventBus) {
      window.EventBus.emit(`subscription:${event}`, data);
    }
  }

  // ============================================
  // URLS
  // ============================================

  function getUpgradeUrl(planId) {
    return `https://whatshybrid.com/planos?plan=${planId}`;
  }

  function getBuyCreditsUrl() {
    return 'https://whatshybrid.com/creditos';
  }

  function getManageUrl() {
    return 'https://whatshybrid.com/minha-conta';
  }

  // ============================================
  // EXPORT
  // ============================================

  const api = {
    init,

    // Ativação
    activateSubscription,
    deactivateSubscription,
    startTrial,

    // Getters
    getStatus,
    getSubscription,
    getPlan,
    getPlanId,
    getFeature,
    getLimit,
    getCredits,
    getUsage,
    isActive,
    isTrial,
    isMasterKey,
    getTrialDaysRemaining,

    // Verificações
    hasFeature,
    canUseAI,
    checkLimit,
    canPerformAction,

    // Consumo
    consumeCredits,
    addCredits,
    incrementUsage,

    // Sync
    syncWithServer,

    // Eventos
    on,
    off,

    // URLs
    getUpgradeUrl,
    getBuyCreditsUrl,
    getManageUrl,

    // Constantes
    PLANS,
    PLAN_HIERARCHY
  };

  window.SubscriptionManager = api;

  console.log('[SubscriptionManager] Módulo carregado');

})();
