/**
 * 🏢 WhatsHybrid - Tenant Middleware
 * Middleware para isolamento de dados multi-tenant
 * 
 * @version 7.9.13
 */

/**
 * Middleware para resolver tenant do request
 */
function tenantResolver(tenantManager) {
  return async (req, res, next) => {
    try {
      // Ignorar rotas públicas
      const publicPaths = ['/health', '/metrics', '/api/v1/auth/login', '/api/v1/auth/register'];
      if (publicPaths.some(p => req.path.startsWith(p))) {
        return next();
      }

      // Resolver tenant
      let tenant = null;

      // 1. Header X-Tenant-ID
      const tenantId = req.headers['x-tenant-id'];
      if (tenantId) {
        tenant = await tenantManager.getById(tenantId);
      }

      // 2. Subdomain
      if (!tenant && req.hostname) {
        const subdomain = req.hostname.split('.')[0];
        if (subdomain !== 'www' && subdomain !== 'api') {
          tenant = await tenantManager.getBySlug(subdomain);
        }
      }

      // 3. User's tenant (se autenticado)
      if (!tenant && req.user?.id) {
        tenant = await tenantManager.getTenantForUser(req.user.id);
      }

      if (!tenant) {
        return res.status(400).json({ error: 'Tenant não identificado' });
      }

      // Verificar status
      if (tenant.status !== 'active') {
        return res.status(403).json({ 
          error: 'Tenant suspenso ou cancelado',
          status: tenant.status
        });
      }

      // Anexar ao request
      req.tenant = tenant;
      req.tenantId = tenant.id;

      // Adicionar header de resposta
      res.setHeader('X-Tenant-ID', tenant.id);

      next();
    } catch (error) {
      logger.error('[TenantMiddleware] Erro:', error);
      res.status(500).json({ error: 'Erro ao resolver tenant' });
    }
  };
}

/**
 * Middleware para verificar feature
 */
function requireFeature(feature) {
  return (req, res, next) => {
    if (!req.tenant) {
      return res.status(400).json({ error: 'Tenant não identificado' });
    }

    if (!req.tenant.hasFeature(feature)) {
      return res.status(403).json({
        error: 'Funcionalidade não disponível no seu plano',
        feature,
        plan: req.tenant.plan,
        upgrade: getUpgradeInfo(req.tenant.plan, feature)
      });
    }

    next();
  };
}

/**
 * Middleware para verificar limite
 */
function checkLimit(resource) {
  return async (req, res, next) => {
    if (!req.tenant) {
      return res.status(400).json({ error: 'Tenant não identificado' });
    }

    const check = req.tenant.checkLimit(resource);
    
    if (!check.allowed) {
      return res.status(429).json({
        error: `Limite de ${resource} atingido`,
        current: check.current,
        limit: check.limit,
        upgrade: getUpgradeInfo(req.tenant.plan, resource)
      });
    }

    // Adicionar info de limite ao request
    req.resourceLimit = check;
    next();
  };
}

/**
 * Middleware para registrar uso
 */
function trackUsage(tenantManager, resource) {
  return async (req, res, next) => {
    // Registrar uso após resposta bem-sucedida
    res.on('finish', async () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && req.tenant) {
        try {
          await tenantManager.trackUsage(req.tenant.id, resource);
        } catch (e) {
          logger.error('[TenantMiddleware] Erro ao rastrear uso:', e.message);
        }
      }
    });

    next();
  };
}

/**
 * Middleware para verificar modelo de IA
 */
function requireAIModel(model) {
  return (req, res, next) => {
    const requestedModel = req.body?.model || model;
    
    if (!req.tenant) {
      return res.status(400).json({ error: 'Tenant não identificado' });
    }

    if (!req.tenant.hasAIModel(requestedModel)) {
      return res.status(403).json({
        error: `Modelo de IA não disponível no seu plano`,
        model: requestedModel,
        availableModels: req.tenant.limits.aiModels,
        upgrade: getUpgradeInfo(req.tenant.plan, 'ai_models')
      });
    }

    next();
  };
}

/**
 * Middleware para adicionar filtro de tenant às queries
 */
function tenantFilter(fieldName = 'tenant_id') {
  return (req, res, next) => {
    if (!req.tenant) {
      return next();
    }

    // Adicionar filtro ao body/query
    req.tenantFilter = { [fieldName]: req.tenant.id };
    
    // Helper para adicionar filtro a queries
    req.withTenantFilter = (query) => {
      if (typeof query === 'object') {
        return { ...query, ...req.tenantFilter };
      }
      return query;
    };

    next();
  };
}

/**
 * Informações de upgrade
 */
function getUpgradeInfo(currentPlan, feature) {
  const plans = ['free', 'starter', 'professional', 'enterprise'];
  const currentIndex = plans.indexOf(currentPlan);
  
  if (currentIndex === plans.length - 1) {
    return null; // Já é enterprise
  }

  return {
    suggestedPlan: plans[currentIndex + 1],
    message: `Faça upgrade para ${plans[currentIndex + 1]} para acessar ${feature}`
  };
}

/**
 * Rate limiter por tenant
 */
function tenantRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60 * 1000; // 1 minuto
  const requests = new Map();

  return (req, res, next) => {
    if (!req.tenant) return next();

    const key = `${req.tenant.id}:${req.path}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Limpar requests antigos
    const tenantRequests = (requests.get(key) || []).filter(t => t > windowStart);
    
    // Limite baseado no plano
    const limits = {
      free: 30,
      starter: 100,
      professional: 500,
      enterprise: 2000
    };

    const maxRequests = options.max || limits[req.tenant.plan] || 100;

    if (tenantRequests.length >= maxRequests) {
      return res.status(429).json({
        error: 'Muitas requisições',
        retryAfter: Math.ceil((tenantRequests[0] + windowMs - now) / 1000)
      });
    }

    tenantRequests.push(now);
    requests.set(key, tenantRequests);

    next();
  };
}

module.exports = {
  tenantResolver,
  requireFeature,
  checkLimit,
  trackUsage,
  requireAIModel,
  tenantFilter,
  tenantRateLimiter,
  getUpgradeInfo
};
