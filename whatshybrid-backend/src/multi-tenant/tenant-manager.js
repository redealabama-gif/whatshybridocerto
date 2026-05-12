/**
 * 🏢 WhatsHybrid - Multi-Tenant Manager
 * Sistema completo de gerenciamento multi-tenant
 * 
 * @version 7.9.13
 */

const { EventEmitter } = require('events');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Níveis de plano/assinatura
 */
const PlanLevels = {
  FREE: 'free',
  STARTER: 'starter',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise'
};

/**
 * Limites por plano
 */
const PlanLimits = {
  [PlanLevels.FREE]: {
    maxUsers: 1,
    maxContacts: 100,
    maxMessages: 500,
    maxAIRequests: 50,
    maxStorage: 50 * 1024 * 1024, // 50MB
    features: ['basic_chat', 'basic_crm'],
    aiModels: ['gpt-3.5-turbo'],
    retentionDays: 7
  },
  [PlanLevels.STARTER]: {
    maxUsers: 3,
    maxContacts: 1000,
    maxMessages: 5000,
    maxAIRequests: 500,
    maxStorage: 500 * 1024 * 1024, // 500MB
    features: ['basic_chat', 'basic_crm', 'autopilot_basic', 'analytics_basic'],
    aiModels: ['gpt-3.5-turbo', 'gpt-4o-mini'],
    retentionDays: 30
  },
  [PlanLevels.PROFESSIONAL]: {
    maxUsers: 10,
    maxContacts: 10000,
    maxMessages: 50000,
    maxAIRequests: 5000,
    maxStorage: 5 * 1024 * 1024 * 1024, // 5GB
    features: ['basic_chat', 'basic_crm', 'autopilot_advanced', 'analytics_full', 
               'team_management', 'knowledge_base', 'custom_personas'],
    aiModels: ['gpt-3.5-turbo', 'gpt-4o-mini', 'gpt-4o', 'claude-3-sonnet'],
    retentionDays: 90
  },
  [PlanLevels.ENTERPRISE]: {
    maxUsers: -1, // Ilimitado
    maxContacts: -1,
    maxMessages: -1,
    maxAIRequests: -1,
    maxStorage: -1,
    features: ['all'],
    aiModels: ['all'],
    retentionDays: 365
  }
};

/**
 * Representação de um Tenant
 */
class Tenant {
  constructor(data) {
    this.id = data.id || crypto.randomUUID();
    this.name = data.name;
    this.slug = data.slug || this._generateSlug(data.name);
    this.plan = data.plan || PlanLevels.FREE;
    this.status = data.status || 'active'; // active, suspended, cancelled
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
    this.settings = data.settings || {};
    this.metadata = data.metadata || {};
    this.usage = data.usage || this._initUsage();
    this.limits = PlanLimits[this.plan];
  }

  _generateSlug(name) {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  _initUsage() {
    return {
      users: 0,
      contacts: 0,
      messagesThisMonth: 0,
      aiRequestsThisMonth: 0,
      storageBytes: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Verifica se feature está disponível
   */
  hasFeature(feature) {
    if (this.limits.features.includes('all')) return true;
    return this.limits.features.includes(feature);
  }

  /**
   * Verifica se modelo de IA está disponível
   */
  hasAIModel(model) {
    if (this.limits.aiModels.includes('all')) return true;
    return this.limits.aiModels.includes(model);
  }

  /**
   * Verifica limite
   */
  checkLimit(resource) {
    const limit = this.limits[`max${resource.charAt(0).toUpperCase() + resource.slice(1)}`];
    if (limit === -1) return { allowed: true, remaining: Infinity };
    
    const current = this.usage[resource] || 0;
    return {
      allowed: current < limit,
      current,
      limit,
      remaining: Math.max(0, limit - current)
    };
  }

  /**
   * Incrementa uso
   */
  incrementUsage(resource, amount = 1) {
    if (!this.usage[resource]) this.usage[resource] = 0;
    this.usage[resource] += amount;
    return this.usage[resource];
  }

  /**
   * Serializa para JSON
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      plan: this.plan,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      settings: this.settings,
      usage: this.usage,
      limits: this.limits
    };
  }
}

/**
 * Gerenciador de Tenants
 */
class TenantManager extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    this.cache = new Map();
    this.initialized = false;
  }

  /**
   * Inicializa o gerenciador
   */
  async init() {
    if (this.initialized) return;

    // Criar tabelas se não existirem
    await this._createTables();
    
    this.initialized = true;
    logger.info('[TenantManager] Inicializado');
  }

  async _createTables() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        plan TEXT DEFAULT 'free',
        status TEXT DEFAULT 'active',
        settings TEXT,
        metadata TEXT,
        usage TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS tenant_users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        created_at INTEGER,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        UNIQUE(tenant_id, user_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON tenant_users(user_id)`
    ];

    for (const query of queries) {
      await this.db.run(query);
    }
  }

  /**
   * Cria um novo tenant
   */
  async create(data) {
    const tenant = new Tenant(data);

    await this.db.run(
      `INSERT INTO tenants (id, name, slug, plan, status, settings, metadata, usage, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenant.id,
        tenant.name,
        tenant.slug,
        tenant.plan,
        tenant.status,
        JSON.stringify(tenant.settings),
        JSON.stringify(tenant.metadata),
        JSON.stringify(tenant.usage),
        tenant.createdAt,
        tenant.updatedAt
      ]
    );

    this.cache.set(tenant.id, tenant);
    this.emit('tenant:created', tenant);

    return tenant;
  }

  /**
   * Obtém tenant por ID
   */
  async getById(id) {
    // Verificar cache
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }

    const row = await this.db.get('SELECT * FROM tenants WHERE id = ?', [id]);
    if (!row) return null;

    const tenant = this._rowToTenant(row);
    this.cache.set(id, tenant);
    return tenant;
  }

  /**
   * Obtém tenant por slug
   */
  async getBySlug(slug) {
    const row = await this.db.get('SELECT * FROM tenants WHERE slug = ?', [slug]);
    if (!row) return null;
    return this._rowToTenant(row);
  }

  /**
   * Lista todos os tenants
   */
  async list(filters = {}) {
    let query = 'SELECT * FROM tenants WHERE 1=1';
    const params = [];

    if (filters.status) {
      query += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.plan) {
      query += ' AND plan = ?';
      params.push(filters.plan);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ' LIMIT ?';
      params.push(filters.limit);
    }

    const rows = await this.db.all(query, params);
    return rows.map(row => this._rowToTenant(row));
  }

  /**
   * Atualiza tenant
   */
  async update(id, updates) {
    const tenant = await this.getById(id);
    if (!tenant) throw new Error('Tenant não encontrado');

    Object.assign(tenant, updates, { updatedAt: Date.now() });

    await this.db.run(
      `UPDATE tenants SET 
        name = ?, plan = ?, status = ?, settings = ?, metadata = ?, usage = ?, updated_at = ?
       WHERE id = ?`,
      [
        tenant.name,
        tenant.plan,
        tenant.status,
        JSON.stringify(tenant.settings),
        JSON.stringify(tenant.metadata),
        JSON.stringify(tenant.usage),
        tenant.updatedAt,
        id
      ]
    );

    this.cache.set(id, tenant);
    this.emit('tenant:updated', tenant);

    return tenant;
  }

  /**
   * Adiciona usuário ao tenant
   */
  async addUser(tenantId, userId, role = 'member') {
    const tenant = await this.getById(tenantId);
    if (!tenant) throw new Error('Tenant não encontrado');

    // Verificar limite de usuários
    const usersCheck = tenant.checkLimit('users');
    if (!usersCheck.allowed) {
      throw new Error(`Limite de usuários atingido (${usersCheck.limit})`);
    }

    await this.db.run(
      `INSERT INTO tenant_users (id, tenant_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), tenantId, userId, role, Date.now()]
    );

    tenant.incrementUsage('users');
    await this.update(tenantId, { usage: tenant.usage });

    this.emit('tenant:user_added', { tenantId, userId, role });
    return true;
  }

  /**
   * Remove usuário do tenant
   */
  async removeUser(tenantId, userId) {
    await this.db.run(
      'DELETE FROM tenant_users WHERE tenant_id = ? AND user_id = ?',
      [tenantId, userId]
    );

    const tenant = await this.getById(tenantId);
    if (tenant) {
      tenant.usage.users = Math.max(0, (tenant.usage.users || 1) - 1);
      await this.update(tenantId, { usage: tenant.usage });
    }

    this.emit('tenant:user_removed', { tenantId, userId });
    return true;
  }

  /**
   * Obtém tenant do usuário
   */
  async getTenantForUser(userId) {
    const row = await this.db.get(
      `SELECT t.* FROM tenants t 
       INNER JOIN tenant_users tu ON t.id = tu.tenant_id 
       WHERE tu.user_id = ?`,
      [userId]
    );

    if (!row) return null;
    return this._rowToTenant(row);
  }

  /**
   * Verifica se usuário tem acesso a feature
   */
  async checkFeatureAccess(userId, feature) {
    const tenant = await this.getTenantForUser(userId);
    if (!tenant) return false;
    if (tenant.status !== 'active') return false;
    return tenant.hasFeature(feature);
  }

  /**
   * Verifica e registra uso de recurso
   */
  async trackUsage(tenantId, resource, amount = 1) {
    const tenant = await this.getById(tenantId);
    if (!tenant) throw new Error('Tenant não encontrado');

    const check = tenant.checkLimit(resource);
    if (!check.allowed) {
      this.emit('tenant:limit_reached', { tenantId, resource, limit: check.limit });
      throw new Error(`Limite de ${resource} atingido`);
    }

    tenant.incrementUsage(resource, amount);
    await this.update(tenantId, { usage: tenant.usage });

    // Emitir warning se próximo do limite
    if (check.remaining <= check.limit * 0.1) {
      this.emit('tenant:limit_warning', { 
        tenantId, 
        resource, 
        remaining: check.remaining,
        limit: check.limit 
      });
    }

    return check;
  }

  /**
   * Reseta uso mensal
   */
  async resetMonthlyUsage() {
    const tenants = await this.list({ status: 'active' });
    
    for (const tenant of tenants) {
      tenant.usage.messagesThisMonth = 0;
      tenant.usage.aiRequestsThisMonth = 0;
      tenant.usage.lastReset = Date.now();
      await this.update(tenant.id, { usage: tenant.usage });
    }

    this.emit('usage:reset', { count: tenants.length });
    logger.info(`[TenantManager] Reset de uso mensal para ${tenants.length} tenants`);
  }

  /**
   * Converte row do banco para Tenant
   */
  _rowToTenant(row) {
    return new Tenant({
      id: row.id,
      name: row.name,
      slug: row.slug,
      plan: row.plan,
      status: row.status,
      settings: JSON.parse(row.settings || '{}'),
      metadata: JSON.parse(row.metadata || '{}'),
      usage: JSON.parse(row.usage || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
  }

  /**
   * Limpa cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = {
  TenantManager,
  Tenant,
  PlanLevels,
  PlanLimits
};
