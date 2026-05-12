/**
 * Subscription Middleware — bloqueia rotas se workspace.subscription_status não OK.
 *
 * Status permitidos: active, trialing
 * Status bloqueados: trial_expired, past_due, cancelled
 *
 * Retorna 402 Payment Required com link pro checkout.
 *
 * @module middleware/subscription
 */
/**
 * Subscription Middleware - Validação server-side de features premium
 * Previne bypass via edição de localStorage
 */

const db = require('../utils/database');
const { AppError } = require('./errorHandler');
const logger = require('../utils/logger');

/**
 * Definição de features por plano
 */
const FEATURE_PLANS = {
  // CRM & Vendas
  'crm_advanced': ['pro', 'enterprise'],
  'deals': ['starter', 'pro', 'enterprise'],
  'pipeline_custom': ['pro', 'enterprise'],
  'contacts_unlimited': ['pro', 'enterprise'],
  'contacts_1000': ['starter', 'pro', 'enterprise'],

  // Campanhas
  'campaigns': ['pro', 'enterprise'],
  'campaigns_advanced': ['enterprise'],
  'bulk_send': ['pro', 'enterprise'],

  // Analytics
  'analytics_basic': ['starter', 'pro', 'enterprise'],
  'analytics_advanced': ['pro', 'enterprise'],
  'analytics_export': ['enterprise'],

  // Automação
  'autopilot': ['starter', 'pro', 'enterprise'],
  'autopilot_unlimited': ['pro', 'enterprise'],

  // IA
  'ai_basic': ['free', 'starter', 'pro', 'enterprise'],
  'ai_advanced': ['pro', 'enterprise'],
  'ai_custom_models': ['enterprise'],

  // Equipe
  'team': ['enterprise'],
  'team_roles': ['enterprise'],

  // API & Integrações
  'api_access': ['enterprise'],
  'webhooks': ['pro', 'enterprise'],
  'integrations_advanced': ['enterprise']
};

/**
 * Limites por plano
 */
const PLAN_LIMITS = {
  free: {
    contacts: 100,
    deals: 10,
    tasks: 50,
    campaigns: 0,
    ai_requests_per_day: 10
  },
  starter: {
    contacts: 1000,
    deals: 50,
    tasks: 200,
    campaigns: 5,
    ai_requests_per_day: 100
  },
  pro: {
    contacts: -1, // unlimited
    deals: -1,
    tasks: -1,
    campaigns: -1,
    ai_requests_per_day: 500
  },
  enterprise: {
    contacts: -1,
    deals: -1,
    tasks: -1,
    campaigns: -1,
    ai_requests_per_day: -1 // unlimited
  }
};

/**
 * Middleware para verificar se o plano permite uma feature
 * @param {string} feature - Nome da feature a verificar
 * @returns {Function} Middleware Express
 */
function checkSubscription(feature) {
  return async (req, res, next) => {
    try {
      const workspaceId = req.workspaceId;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      // Buscar workspace do banco
      const workspace = db.get(
        'SELECT * FROM workspaces WHERE id = ?',
        [workspaceId]
      );

      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      const currentPlan = workspace.plan || 'free';

      // Verificar se a feature requer validação
      const allowedPlans = FEATURE_PLANS[feature];

      if (!allowedPlans) {
        // Feature não está mapeada - permitir (para retrocompatibilidade)
        logger.warn(`[Subscription] Feature não mapeada: ${feature}`);
        return next();
      }

      // Verificar se o plano atual permite a feature
      if (!allowedPlans.includes(currentPlan)) {
        logger.warn(`[Subscription] Acesso negado: feature=${feature}, plan=${currentPlan}, workspace=${workspaceId}`);

        return res.status(402).json({
          error: 'Feature not available in your plan',
          code: 'FEATURE_NOT_AVAILABLE',
          feature,
          currentPlan,
          requiredPlans: allowedPlans,
          upgradeUrl: '/upgrade'
        });
      }

      // Feature permitida - continuar
      next();
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code
        });
      }
      next(error);
    }
  };
}

/**
 * Middleware para verificar limites de uso
 * @param {string} resource - Recurso a verificar (contacts, deals, tasks, etc)
 * @returns {Function} Middleware Express
 */
function checkLimit(resource) {
  return async (req, res, next) => {
    try {
      const workspaceId = req.workspaceId;

      if (!workspaceId) {
        throw new AppError('Workspace not found', 404);
      }

      // Buscar workspace
      const workspace = db.get(
        'SELECT * FROM workspaces WHERE id = ?',
        [workspaceId]
      );

      if (!workspace) {
        throw new AppError('Workspace not found', 404);
      }

      const currentPlan = workspace.plan || 'free';
      const limits = PLAN_LIMITS[currentPlan];

      if (!limits || limits[resource] == null) {
        // Limite não definido - permitir
        return next();
      }

      const limit = limits[resource];

      // -1 significa unlimited
      if (limit === -1) {
        return next();
      }

      // Verificar uso atual
      let currentCount = 0;
      const tableName = resource === 'ai_requests_per_day' ? 'ai_requests' : resource;

      if (resource === 'ai_requests_per_day') {
        // Contar requests de IA nas últimas 24 horas
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const result = db.get(
          `SELECT COUNT(*) as count FROM ai_requests WHERE workspace_id = ? AND created_at >= ?`,
          [workspaceId, oneDayAgo]
        );
        currentCount = result?.count || 0;
      } else {
        // Contar registros na tabela correspondente
        const result = db.get(
          `SELECT COUNT(*) as count FROM ${tableName} WHERE workspace_id = ?`,
          [workspaceId]
        );
        currentCount = result?.count || 0;
      }

      // Verificar se excedeu o limite
      if (currentCount >= limit) {
        logger.warn(`[Subscription] Limite excedido: resource=${resource}, count=${currentCount}, limit=${limit}, plan=${currentPlan}`);

        return res.status(402).json({
          error: 'Usage limit reached',
          code: 'LIMIT_REACHED',
          resource,
          currentCount,
          limit,
          currentPlan,
          upgradeUrl: '/upgrade'
        });
      }

      // Limite OK - continuar
      req.usageInfo = { currentCount, limit };
      next();
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          error: error.message,
          code: error.code
        });
      }
      next(error);
    }
  };
}

/**
 * Verifica o plano do workspace (apenas leitura)
 */
async function getWorkspacePlan(workspaceId) {
  const workspace = db.get(
    'SELECT plan FROM workspaces WHERE id = ?',
    [workspaceId]
  );
  return workspace?.plan || 'free';
}

/**
 * Verifica se o workspace tem acesso a uma feature
 */
async function hasFeatureAccess(workspaceId, feature) {
  const plan = await getWorkspacePlan(workspaceId);
  const allowedPlans = FEATURE_PLANS[feature];

  if (!allowedPlans) {
    return true; // Feature não mapeada - permitir
  }

  return allowedPlans.includes(plan);
}

module.exports = {
  checkSubscription,
  checkLimit,
  getWorkspacePlan,
  hasFeatureAccess,
  FEATURE_PLANS,
  PLAN_LIMITS
};
