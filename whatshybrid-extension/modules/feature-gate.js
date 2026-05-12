/**
 * WhatsHybrid Feature Gate v1.0.0
 * Sistema de bloqueio de recursos baseado em assinatura
 * Controla acesso a funcionalidades por plano
 */
(function() {
  'use strict';

  // ============================================
  // CACHE DE VERIFICAÇÕES
  // ============================================

  const checkCache = new Map();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  // ============================================
  // MAPEAMENTO DE RECURSOS
  // ============================================

  const FEATURE_MAP = {
    // === MÓDULOS ===
    'module:dashboard': { minPlan: 'free' },
    'module:chats': { minPlan: 'free' },
    'module:contacts': { minPlan: 'free' },
    'module:recover': { minPlan: 'free' },
    'module:bulk': { minPlan: 'starter', feature: 'bulkMessages' },
    'module:campaigns': { minPlan: 'starter' },
    'module:flows': { minPlan: 'starter' },
    'module:analytics': { minPlan: 'starter', feature: 'analytics' },
    'module:team': { minPlan: 'starter' },
    'module:extractor': { minPlan: 'starter' },
    'module:smart-replies': { minPlan: 'starter', feature: 'smartReplies', requiresCredits: true },
    'module:copilot': { minPlan: 'pro', feature: 'copilot', requiresCredits: true },
    'module:crm': { minPlan: 'free', feature: 'crm' },
    'module:tasks': { minPlan: 'free' },
    'module:training': { minPlan: 'starter' },

    // === AÇÕES ===
    'action:send_bulk': { minPlan: 'starter', feature: 'bulkMessages' },
    'action:create_flow': { minPlan: 'starter', limit: 'maxFlows' },
    'action:create_campaign': { minPlan: 'starter', limit: 'maxCampaigns' },
    'action:export_csv': { minPlan: 'free' },
    'action:export_xlsx': { minPlan: 'starter' },
    'action:export_json': { minPlan: 'pro' },
    'action:export_pdf': { minPlan: 'enterprise' },
    'action:add_team_member': { minPlan: 'starter', limit: 'maxTeamMembers' },
    'action:use_ai': { minPlan: 'starter', requiresCredits: true },
    'action:custom_labels': { minPlan: 'starter', feature: 'customLabels' },
    'action:send_message': { minPlan: 'free', limit: 'messagesPerDay' },
    'action:send_media': { minPlan: 'free', limit: 'mediaPerDay' },

    // === FUNCIONALIDADES ===
    'feature:smart_replies': { minPlan: 'starter', feature: 'smartReplies', requiresCredits: true },
    'feature:copilot': { minPlan: 'pro', feature: 'copilot', requiresCredits: true },
    'feature:advanced_analytics': { minPlan: 'pro', feature: 'analytics', value: 'advanced' },
    'feature:full_analytics': { minPlan: 'enterprise', feature: 'analytics', value: 'full' },
    'feature:white_label': { minPlan: 'enterprise', feature: 'whiteLabel' },
    'feature:priority_support': { minPlan: 'pro', feature: 'prioritySupport' },
    'feature:api_access': { minPlan: 'pro', feature: 'apiAccess' }
  };

  const PLAN_HIERARCHY = ['free', 'starter', 'pro', 'enterprise'];

  // ============================================
  // VERIFICAÇÕES
  // ============================================

  function createResult(allowed, reason = null, message = null, upgradeRequired = null, canBuyCredits = false) {
    return { allowed, reason, message, upgradeRequired, canBuyCredits };
  }

  function getCached(key) {
    const cached = checkCache.get(key);
    if (!cached) return null;
    if (Date.now() > cached.expires) {
      checkCache.delete(key);
      return null;
    }
    return cached.result;
  }

  function setCache(key, result) {
    checkCache.set(key, { result, expires: Date.now() + CACHE_TTL });
  }

  function invalidateCache(key = null) {
    if (key) checkCache.delete(key);
    else checkCache.clear();
  }

  /**
   * Verifica se um recurso está disponível
   * @param {string} featureKey - Chave do recurso
   * @param {boolean} useCache - Usar cache
   * @returns {Object}
   */
  function check(featureKey, useCache = true) {
    if (useCache) {
      const cached = getCached(featureKey);
      if (cached !== null) return cached;
    }

    const result = performCheck(featureKey);
    setCache(featureKey, result);
    return result;
  }

  function performCheck(featureKey) {
    const config = FEATURE_MAP[featureKey];

    // FIX PEND-HIGH-002: Features desconhecidas são BLOQUEADAS por padrão (segurança)
    if (!config) {
      console.warn('[FeatureGate] Feature desconhecida:', featureKey);
      return createResult(false, 'unknown_feature', 'Recurso não configurado no sistema');
    }

    // FIX PEND-HIGH-002: Se não existir SubscriptionManager, BLOQUEAR recursos premium
    if (!window.SubscriptionManager) {
      // Apenas recursos 'free' são permitidos sem SubscriptionManager
      if (config.minPlan !== 'free') {
        console.error('[FeatureGate] SubscriptionManager não disponível para recurso premium:', featureKey);
        return createResult(false, 'subscription_unavailable', 'Sistema de assinaturas não disponível');
      }
      // Features free são permitidas
      return { allowed: true };
    }

    const SM = window.SubscriptionManager;

    // 1) Verificar assinatura ativa
    if (!SM.isActive() && config.minPlan !== 'free') {
      return createResult(false, 'subscription_inactive', 'Ative sua assinatura para acessar este recurso');
    }

    const currentPlan = SM.getPlanId();
    const currentIndex = PLAN_HIERARCHY.indexOf(currentPlan);

    // 2) Verificar plano mínimo
    if (config.minPlan) {
      const requiredIndex = PLAN_HIERARCHY.indexOf(config.minPlan);
      if (requiredIndex !== -1 && currentIndex < requiredIndex) {
        const planName = SM.PLANS?.[config.minPlan]?.name || config.minPlan;
        return createResult(false, 'plan_required', `Disponível a partir do plano ${planName}`, config.minPlan);
      }
    }

    // 3) Verificar feature flag
    if (config.feature) {
      const featureValue = SM.getFeature(config.feature);
      const ok = !!featureValue && (!config.value || featureValue === config.value || featureValue === 'full');
      if (!ok) {
        return createResult(false, 'feature_locked', 'Recurso não disponível no seu plano', config.minPlan);
      }
    }

    // 4) Verificar limites
    if (config.limit) {
      const limitCheck = SM.checkLimit(config.limit);
      if (!limitCheck.allowed) {
        return createResult(false, 'limit_reached', `Limite de ${limitCheck.limit} atingido`, getNextPlan(config.limit));
      }
    }

    // 5) Verificar créditos de IA
    if (config.requiresCredits && !SM.canUseAI()) {
      return createResult(false, 'no_credits', 'Créditos de IA esgotados', null, true);
    }

    return { allowed: true };
  }

  function getNextPlan(limitName) {
    if (!window.SubscriptionManager) return null;
    const SM = window.SubscriptionManager;

    const currentLimit = SM.getFeature(limitName);
    const currentIndex = PLAN_HIERARCHY.indexOf(SM.getPlanId());

    for (let i = currentIndex + 1; i < PLAN_HIERARCHY.length; i++) {
      const planId = PLAN_HIERARCHY[i];
      const plan = SM.PLANS?.[planId];
      const nextLimit = plan?.features?.[limitName];
      if (nextLimit === -1 || (typeof nextLimit === 'number' && nextLimit > currentLimit)) {
        return planId;
      }
    }
    return null;
  }

  /**
   * Verifica múltiplos recursos de uma vez
   */
  function checkMultiple(featureKeys, options = {}) {
    const results = {};

    for (const key of featureKeys) {
      const cached = options.skipCache ? null : getCached(key);
      if (cached !== null) {
        results[key] = cached;
      } else {
        results[key] = performCheck(key);
        setCache(key, results[key]);
      }
    }

    return results;
  }

  // ============================================
  // UI HELPERS
  // ============================================

  /**
   * Exibe mensagem de bloqueio
   */
  function handleBlocked(featureKey, result) {
    const msg = result?.message || 'Recurso bloqueado';

    if (window.NotificationsModule) {
      if (result?.canBuyCredits) {
        window.NotificationsModule.show({
          title: 'Créditos necessários',
          message: msg,
          type: 'warning',
          actions: [
            { label: 'Comprar Créditos', action: () => openBuyCredits() }
          ]
        });
      } else {
        window.NotificationsModule.show({
          title: 'Recurso bloqueado',
          message: msg,
          type: 'info',
          actions: [
            { label: 'Ver Planos', action: () => openUpgrade(result.upgradeRequired) }
          ]
        });
      }
    } else {
      alert(msg);
    }

    window.EventBus?.emit?.('feature:blocked', { featureKey, result });
  }

  function openUpgrade(suggestedPlan) {
    if (window.SubscriptionManager) {
      window.open(window.SubscriptionManager.getUpgradeUrl(suggestedPlan || 'starter'), '_blank');
    }
  }

  function openBuyCredits() {
    if (window.SubscriptionManager) {
      window.open(window.SubscriptionManager.getBuyCreditsUrl(), '_blank');
    }
  }

  /**
   * Aplica estado bloqueado a um elemento
   */
  function applyToElement(element, featureKey) {
    if (!element) return;

    const result = check(featureKey);

    if (!result.allowed) {
      element.classList.add('feature-blocked');
      element.setAttribute('data-blocked-reason', result.reason || 'blocked');
      if (result.message) element.setAttribute('title', result.message);

      // Adicionar badge de upgrade
      if (!element.querySelector('.upgrade-badge')) {
        const badge = document.createElement('span');
        badge.className = 'upgrade-badge';
        badge.textContent = result.canBuyCredits ? '💳' : '⭐';
        badge.style.cssText = `
          position: absolute;
          top: -4px;
          right: -4px;
          font-size: 12px;
          background: rgba(139, 92, 246, 0.9);
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
        `;
        element.style.position = 'relative';
        element.appendChild(badge);
      }

      // Handler de clique
      const handler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleBlocked(featureKey, result);
      };

      element._featureGateHandler = handler;
      element.addEventListener('click', handler, { capture: true });

    } else {
      element.classList.remove('feature-blocked');
      element.removeAttribute('data-blocked-reason');

      if (element._featureGateHandler) {
        element.removeEventListener('click', element._featureGateHandler, { capture: true });
        delete element._featureGateHandler;
      }

      const badge = element.querySelector('.upgrade-badge');
      if (badge) badge.remove();
    }
  }

  /**
   * Aplica verificação a todos elementos com data-feature-gate
   */
  function applyToPage() {
    const elements = document.querySelectorAll('[data-feature-gate]');
    elements.forEach(el => {
      const key = el.dataset.featureGate;
      if (key) applyToElement(el, key);
    });
  }

  // ============================================
  // DECORATORS
  // ============================================

  /**
   * Decorator para funções que requerem feature
   */
  function requireFeature(featureKey, fn) {
    return function(...args) {
      const result = check(featureKey);
      if (!result.allowed) {
        handleBlocked(featureKey, result);
        return null;
      }
      return fn.apply(this, args);
    };
  }

  /**
   * Decorator async
   */
  function requireFeatureAsync(featureKey, fn) {
    return async function(...args) {
      const result = check(featureKey);
      if (!result.allowed) {
        handleBlocked(featureKey, result);
        throw new Error(result.message || 'Recurso bloqueado');
      }
      return await fn.apply(this, args);
    };
  }

  /**
   * Guard para verificar antes de executar
   */
  function guard(featureKey, options = {}) {
    const result = check(featureKey);
    if (!result.allowed) {
      if (!options.silent) {
        handleBlocked(featureKey, result);
      }
      return false;
    }
    return true;
  }

  // ============================================
  // LISTENER DE EVENTOS
  // ============================================

  // Invalidar cache quando assinatura muda
  window.EventBus?.on?.('subscription:initialized', () => invalidateCache());
  window.EventBus?.on?.('subscription:subscription_activated', () => invalidateCache());
  window.EventBus?.on?.('subscription:subscription_deactivated', () => invalidateCache());
  window.EventBus?.on?.('subscription:credits_consumed', () => invalidateCache());
  window.EventBus?.on?.('subscription:credits_added', () => invalidateCache());

  // ============================================
  // EXPORT
  // ============================================

  const api = {
    FEATURE_MAP,
    PLAN_HIERARCHY,
    check,
    checkMultiple,
    invalidateCache,
    applyToElement,
    applyToPage,
    handleBlocked,
    requireFeature,
    requireFeatureAsync,
    guard
  };

  window.FeatureGate = api;

  console.log('[FeatureGate] Módulo carregado');

})();
