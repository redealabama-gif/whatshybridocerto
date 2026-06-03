/**
 * 🏢 WhatsHybrid - Multi-Tenant Module
 * Módulo central de multi-tenancy
 * 
 * @version 7.9.13
 */

const { TenantManager, Tenant, PlanLevels, PlanLimits } = require('./tenant-manager');
const logger = require('../utils/logger');
const {
  tenantResolver,
  requireFeature,
  checkLimit,
  trackUsage,
  requireAIModel,
  tenantFilter,
  tenantRateLimiter
} = require('./tenant-middleware');

/**
 * Configura multi-tenancy no Express app
 */
function setupMultiTenant(app, db, options = {}) {
  const tenantManager = new TenantManager(db);

  // Inicializar manager
  tenantManager.init().then(() => {
    logger.info('[MultiTenant] ✅ Sistema multi-tenant inicializado');
  });

  // Aplicar middlewares
  if (options.autoResolve !== false) {
    app.use(tenantResolver(tenantManager));
  }

  if (options.tenantFilter !== false) {
    app.use(tenantFilter());
  }

  if (options.rateLimiter !== false) {
    app.use(tenantRateLimiter(options.rateLimiterOptions));
  }

  // Expor no app
  app.tenantManager = tenantManager;

  // Helpers para rotas
  app.requireFeature = requireFeature;
  app.checkLimit = checkLimit;
  app.trackUsage = (resource) => trackUsage(tenantManager, resource);
  app.requireAIModel = requireAIModel;

  // Eventos
  tenantManager.on('tenant:created', (tenant) => {
    logger.info(`[MultiTenant] Novo tenant: ${tenant.name} (${tenant.plan})`);
  });

  tenantManager.on('tenant:limit_reached', ({ tenantId, resource, limit }) => {
    logger.warn(`[MultiTenant] ⚠️ Limite atingido: ${resource} para tenant ${tenantId} (${limit})`);
  });

  tenantManager.on('tenant:limit_warning', ({ tenantId, resource, remaining, limit }) => {
    logger.warn(`[MultiTenant] ⚠️ Limite próximo: ${resource} para tenant ${tenantId} (${remaining}/${limit})`);
  });

  return tenantManager;
}

/**
 * Rotas de administração de tenants
 */
function tenantRoutes(tenantManager) {
  const express = require('express');
  const router = express.Router();

  // Listar tenants (admin only)
  router.get('/', async (req, res) => {
    try {
      const tenants = await tenantManager.list(req.query);
      res.json({ tenants });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Criar tenant
  router.post('/', async (req, res) => {
    try {
      const tenant = await tenantManager.create(req.body);
      res.status(201).json({ tenant });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Obter tenant
  router.get('/:id', async (req, res) => {
    try {
      const tenant = await tenantManager.getById(req.params.id);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant não encontrado' });
      }
      res.json({ tenant });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Atualizar tenant
  router.patch('/:id', async (req, res) => {
    try {
      const tenant = await tenantManager.update(req.params.id, req.body);
      res.json({ tenant });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Obter uso do tenant
  router.get('/:id/usage', async (req, res) => {
    try {
      const tenant = await tenantManager.getById(req.params.id);
      if (!tenant) {
        return res.status(404).json({ error: 'Tenant não encontrado' });
      }
      res.json({
        usage: tenant.usage,
        limits: tenant.limits,
        checks: {
          users: tenant.checkLimit('users'),
          contacts: tenant.checkLimit('contacts'),
          messages: tenant.checkLimit('messagesThisMonth'),
          aiRequests: tenant.checkLimit('aiRequestsThisMonth')
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Adicionar usuário ao tenant
  router.post('/:id/users', async (req, res) => {
    try {
      await tenantManager.addUser(req.params.id, req.body.userId, req.body.role);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Remover usuário do tenant
  router.delete('/:id/users/:userId', async (req, res) => {
    try {
      await tenantManager.removeUser(req.params.id, req.params.userId);
      res.json({ success: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = {
  // Setup
  setupMultiTenant,
  tenantRoutes,
  
  // Classes
  TenantManager,
  Tenant,
  
  // Constants
  PlanLevels,
  PlanLimits,
  
  // Middlewares
  tenantResolver,
  requireFeature,
  checkLimit,
  trackUsage,
  requireAIModel,
  tenantFilter,
  tenantRateLimiter
};
