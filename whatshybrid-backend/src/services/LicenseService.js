/**
 * LicenseService — validação de licença/plano e enforcement de limites.
 *
 * Plans:
 *   free       — trial 7d, 100k tokens
 *   starter    — R$97/mês, 100k tokens, 1 atendente
 *   pro        — R$197/mês, 500k tokens, 5 atendentes
 *   business   — R$397/mês, 1M tokens, 15 atendentes
 *
 * @module services/LicenseService
 */
/**
 * 🔑 LicenseService - Serviço de Licenciamento
 * WhatsHybrid Pro v7.1.0
 */

const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const crypto = require('crypto');

// Limites por plano
const PLAN_LIMITS = {
  free: {
    maxUsers: 1,
    maxContacts: 100,
    maxCampaigns: 5,
    aiEnabled: false,
    aiCredits: 0,
    features: ['basic_crm', 'manual_messaging']
  },
  starter: {
    maxUsers: 3,
    maxContacts: 1000,
    maxCampaigns: 20,
    aiEnabled: true,
    aiCredits: 1000,
    features: ['basic_crm', 'manual_messaging', 'campaigns', 'basic_ai', 'templates']
  },
  pro: {
    maxUsers: 10,
    maxContacts: 10000,
    maxCampaigns: 100,
    aiEnabled: true,
    aiCredits: 10000,
    features: ['full_crm', 'campaigns', 'advanced_ai', 'templates', 'analytics', 'webhooks', 'api']
  },
  enterprise: {
    maxUsers: -1, // ilimitado
    maxContacts: -1,
    maxCampaigns: -1,
    aiEnabled: true,
    aiCredits: 100000,
    features: ['full_crm', 'campaigns', 'advanced_ai', 'agents', 'rag', 'white_label', 'sso', 'dedicated_support', 'custom_integrations']
  }
};

class LicenseService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Gerar chave de licença
   */
  generateKey() {
    const segments = [];
    for (let i = 0; i < 4; i++) {
      segments.push(crypto.randomBytes(3).toString('hex').toUpperCase());
    }
    return segments.join('-'); // Formato: XXXX-XXXX-XXXX-XXXX
  }

  /**
   * Criar licença
   */
  async create(data) {
    const id = uuidv4();
    const key = data.key || this.generateKey();
    const plan = data.plan || 'free';
    const limits = PLAN_LIMITS[plan];

    if (!limits) {
      throw new Error('Plano inválido');
    }

    const license = await this.db.createLicense({
      id,
      key,
      email: data.email,
      name: data.name || null,
      plan,
      status: data.status || 'active',
      features: limits.features,
      aiEnabled: limits.aiEnabled,
      aiCredits: data.aiCredits || limits.aiCredits,
      aiCreditsUsed: 0,
      maxUsers: limits.maxUsers,
      maxContacts: limits.maxContacts,
      maxCampaigns: limits.maxCampaigns,
      boundClientId: null,
      activatedAt: null,
      expiresAt: data.expiresAt || null,
      trialEndsAt: data.trialEndsAt || null,
      stripeSubscriptionId: data.stripeSubscriptionId || null,
      workspaceId: data.workspaceId || null
    });

    return license;
  }

  /**
   * Validar licença
   */
  async validate(key, clientId = null) {
    const license = await this.db.findLicenseByKey(key);
    
    if (!license) {
      return { valid: false, error: 'Licença não encontrada' };
    }

    // Verificar status
    if (license.status === 'revoked') {
      return { valid: false, error: 'Licença revogada' };
    }

    // Verificar expiração
    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      await this.db.updateLicense(license.id, { status: 'expired' });
      return { valid: false, error: 'Licença expirada' };
    }

    // Verificar trial
    if (license.status === 'trial' && license.trialEndsAt) {
      if (new Date(license.trialEndsAt) < new Date()) {
        await this.db.updateLicense(license.id, { status: 'expired' });
        return { valid: false, error: 'Período de teste expirado' };
      }
    }

    // Verificar binding (se já está vinculada a outro cliente)
    if (license.boundClientId && clientId && license.boundClientId !== clientId) {
      return { valid: false, error: 'Licença já vinculada a outro dispositivo' };
    }

    // Ativar se primeira vez
    if (!license.activatedAt) {
      await this.db.updateLicense(license.id, {
        activatedAt: new Date(),
        boundClientId: clientId
      });
    }

    const limits = PLAN_LIMITS[license.plan];

    return {
      valid: true,
      license: {
        key: license.key,
        plan: license.plan,
        status: license.status,
        email: license.email,
        features: license.features,
        limits: {
          maxUsers: limits.maxUsers,
          maxContacts: limits.maxContacts,
          maxCampaigns: limits.maxCampaigns
        },
        ai: {
          enabled: license.aiEnabled,
          credits: license.aiCredits,
          used: license.aiCreditsUsed,
          remaining: license.aiCredits - license.aiCreditsUsed
        },
        expiresAt: license.expiresAt,
        trialEndsAt: license.trialEndsAt
      }
    };
  }

  /**
   * Ativar licença em workspace
   */
  async activate(key, workspaceId, clientId) {
    const validation = await this.validate(key, clientId);
    
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const license = await this.db.findLicenseByKey(key);

    // Verificar se já está vinculada a outro workspace
    if (license.workspaceId && license.workspaceId !== workspaceId) {
      throw new Error('Licença já vinculada a outro workspace');
    }

    await this.db.updateLicense(license.id, {
      workspaceId,
      boundClientId: clientId,
      activatedAt: license.activatedAt || new Date()
    });

    // Atualizar plano do workspace
    const limits = PLAN_LIMITS[license.plan];
    await this.db.updateWorkspace(workspaceId, {
      plan: license.plan
    });

    return validation;
  }

  /**
   * Consumir créditos de IA
   */
  async consumeCredits(key, amount, metadata = {}) {
    const license = await this.db.findLicenseByKey(key);
    
    if (!license) {
      throw new Error('Licença não encontrada');
    }

    if (!license.aiEnabled) {
      throw new Error('IA não habilitada nesta licença');
    }

    const remaining = license.aiCredits - license.aiCreditsUsed;
    if (remaining < amount) {
      throw new Error('Créditos insuficientes');
    }

    // Incrementar uso
    await this.db.updateLicense(license.id, {
      aiCreditsUsed: license.aiCreditsUsed + amount
    });

    // Registrar consumo
    await this.db.createAICredit({
      id: uuidv4(),
      licenseId: license.id,
      amount: -amount,
      type: 'consumed',
      description: metadata.description || 'AI usage',
      model: metadata.model,
      tokens: metadata.tokens,
      cost: metadata.cost
    });

    return {
      consumed: amount,
      remaining: remaining - amount
    };
  }

  /**
   * Adicionar créditos
   */
  async addCredits(key, amount, type = 'purchase', description = null) {
    const license = await this.db.findLicenseByKey(key);
    
    if (!license) {
      throw new Error('Licença não encontrada');
    }

    await this.db.updateLicense(license.id, {
      aiCredits: license.aiCredits + amount
    });

    await this.db.createAICredit({
      id: uuidv4(),
      licenseId: license.id,
      amount,
      type,
      description: description || `${type} de ${amount} créditos`
    });

    return {
      added: amount,
      total: license.aiCredits + amount
    };
  }

  /**
   * Resgatar código de recarga
   */
  async redeemTopup(key, code) {
    const license = await this.db.findLicenseByKey(key);
    if (!license) {
      throw new Error('Licença não encontrada');
    }

    const topup = await this.db.findTopupByCode(code);
    if (!topup) {
      throw new Error('Código inválido');
    }

    if (topup.status !== 'active') {
      throw new Error('Código já utilizado ou expirado');
    }

    if (topup.expiresAt && new Date(topup.expiresAt) < new Date()) {
      await this.db.updateTopup(topup.id, { status: 'expired' });
      throw new Error('Código expirado');
    }

    // Adicionar créditos
    await this.addCredits(key, topup.credits, 'bonus', `Recarga: ${code}`);

    // Marcar como resgatado
    await this.db.updateTopup(topup.id, {
      status: 'redeemed',
      redeemedAt: new Date(),
      redeemedByKey: key
    });

    return {
      credits: topup.credits,
      total: license.aiCredits + topup.credits
    };
  }

  /**
   * Upgrade de plano
   */
  async upgradePlan(key, newPlan, stripeSubscriptionId = null) {
    const license = await this.db.findLicenseByKey(key);
    if (!license) {
      throw new Error('Licença não encontrada');
    }

    const limits = PLAN_LIMITS[newPlan];
    if (!limits) {
      throw new Error('Plano inválido');
    }

    // Verificar se é upgrade
    const planOrder = ['free', 'starter', 'pro', 'enterprise'];
    const currentIndex = planOrder.indexOf(license.plan);
    const newIndex = planOrder.indexOf(newPlan);

    if (newIndex <= currentIndex) {
      throw new Error('Selecione um plano superior');
    }

    await this.db.updateLicense(license.id, {
      plan: newPlan,
      features: limits.features,
      aiEnabled: limits.aiEnabled,
      maxUsers: limits.maxUsers,
      maxContacts: limits.maxContacts,
      maxCampaigns: limits.maxCampaigns,
      stripeSubscriptionId
    });

    // Adicionar créditos bônus do novo plano
    if (limits.aiCredits > license.aiCredits) {
      const bonus = limits.aiCredits - license.aiCredits;
      await this.addCredits(key, bonus, 'bonus', `Upgrade para ${newPlan}`);
    }

    // Atualizar workspace
    if (license.workspaceId) {
      await this.db.updateWorkspace(license.workspaceId, { plan: newPlan });
    }

    return this.db.findLicenseByKey(key);
  }

  /**
   * Revogar licença
   */
  async revoke(key, reason = null) {
    const license = await this.db.findLicenseByKey(key);
    if (!license) {
      throw new Error('Licença não encontrada');
    }

    await this.db.updateLicense(license.id, {
      status: 'revoked'
    });

    return { success: true };
  }

  /**
   * Obter uso de IA
   */
  async getAIUsage(key, options = {}) {
    const license = await this.db.findLicenseByKey(key);
    if (!license) {
      throw new Error('Licença não encontrada');
    }

    const { startDate, endDate } = options;
    const credits = await this.db.getAICredits(license.id, startDate, endDate);

    return {
      total: license.aiCredits,
      used: license.aiCreditsUsed,
      remaining: license.aiCredits - license.aiCreditsUsed,
      history: credits
    };
  }

  /**
   * Verificar feature
   */
  async hasFeature(key, feature) {
    const validation = await this.validate(key);
    if (!validation.valid) {
      return false;
    }
    return validation.license.features.includes(feature);
  }

  /**
   * Verificar limite
   */
  async checkLimit(key, resource, current) {
    const validation = await this.validate(key);
    if (!validation.valid) {
      return { allowed: false, error: validation.error };
    }

    const limit = validation.license.limits[resource];
    if (limit === -1) {
      return { allowed: true, limit: 'unlimited' };
    }

    if (current >= limit) {
      return { allowed: false, error: `Limite de ${resource} atingido`, limit, current };
    }

    return { allowed: true, limit, current, remaining: limit - current };
  }
}

module.exports = LicenseService;
module.exports.PLAN_LIMITS = PLAN_LIMITS;
