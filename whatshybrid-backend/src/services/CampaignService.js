/**
 * CampaignService — gestão de campanhas de WhatsApp em lote.
 *
 * Cria filas no Redis (BullMQ) pra envio sequencial respeitando
 * rate limit (1 msg / 5s por contato pra não cair em ban).
 *
 * @module services/CampaignService
 */
/**
 * 📢 CampaignService - Serviço de Campanhas
 * WhatsHybrid Pro v7.1.0
 */

const { v4: uuidv4 } = require('../utils/uuid-wrapper');

class CampaignService {
  constructor(db, eventEmitter = null) {
    this.db = db;
    this.eventEmitter = eventEmitter;
    this.activeCampaigns = new Map();
  }

  /**
   * Criar campanha
   */
  async create(workspaceId, userId, data) {
    const id = uuidv4();

    const campaign = await this.db.createCampaign({
      id,
      workspaceId,
      createdById: userId,
      name: data.name,
      description: data.description || null,
      message: data.message,
      mediaUrl: data.mediaUrl || null,
      mediaType: data.mediaType || null,
      status: 'draft',
      scheduleAt: data.scheduleAt || null,
      intervalMs: data.intervalMs || 3000,
      batchSize: data.batchSize || 10,
      totalContacts: 0,
      sentCount: 0,
      failedCount: 0,
      deliveredCount: 0,
      readCount: 0
    });

    return campaign;
  }

  /**
   * Adicionar contatos à campanha
   */
  async addContacts(campaignId, workspaceId, contacts) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    if (campaign.status !== 'draft') {
      throw new Error('Só é possível adicionar contatos em campanhas em rascunho');
    }

    let added = 0;
    for (const item of contacts) {
      const phone = typeof item === 'string' ? item : item.phone;
      const contactId = typeof item === 'object' ? item.contactId : null;

      // Verificar se já existe
      const existing = await this.db.findCampaignItem(campaignId, phone);
      if (!existing) {
        await this.db.createCampaignItem({
          id: uuidv4(),
          campaignId,
          phone,
          contactId,
          status: 'pending'
        });
        added++;
      }
    }

    // Atualizar total
    await this.db.updateCampaign(campaignId, {
      totalContacts: campaign.totalContacts + added
    });

    return { added, total: campaign.totalContacts + added };
  }

  /**
   * Remover contatos da campanha
   */
  async removeContacts(campaignId, workspaceId, phones) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    if (campaign.status !== 'draft') {
      throw new Error('Só é possível remover contatos em campanhas em rascunho');
    }

    let removed = 0;
    for (const phone of phones) {
      const deleted = await this.db.deleteCampaignItem(campaignId, phone);
      if (deleted) removed++;
    }

    await this.db.updateCampaign(campaignId, {
      totalContacts: Math.max(0, campaign.totalContacts - removed)
    });

    return { removed };
  }

  /**
   * Iniciar campanha
   */
  async start(campaignId, workspaceId) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    if (campaign.status !== 'draft' && campaign.status !== 'paused') {
      throw new Error('Campanha não pode ser iniciada');
    }

    if (campaign.totalContacts === 0) {
      throw new Error('Adicione contatos antes de iniciar');
    }

    await this.db.updateCampaign(campaignId, {
      status: 'running',
      startedAt: campaign.startedAt || new Date()
    });

    // Emitir evento para worker processar
    if (this.eventEmitter) {
      this.eventEmitter.emit('campaign:start', { campaignId, workspaceId });
    }

    this.activeCampaigns.set(campaignId, { workspaceId, status: 'running' });

    return this.db.findCampaignById(campaignId);
  }

  /**
   * Pausar campanha
   */
  async pause(campaignId, workspaceId) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    if (campaign.status !== 'running') {
      throw new Error('Apenas campanhas em execução podem ser pausadas');
    }

    await this.db.updateCampaign(campaignId, { status: 'paused' });

    if (this.eventEmitter) {
      this.eventEmitter.emit('campaign:pause', { campaignId });
    }

    this.activeCampaigns.delete(campaignId);

    return this.db.findCampaignById(campaignId);
  }

  /**
   * Cancelar campanha
   */
  async cancel(campaignId, workspaceId) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    if (campaign.status === 'completed' || campaign.status === 'cancelled') {
      throw new Error('Campanha já finalizada');
    }

    await this.db.updateCampaign(campaignId, { status: 'cancelled' });

    if (this.eventEmitter) {
      this.eventEmitter.emit('campaign:cancel', { campaignId });
    }

    this.activeCampaigns.delete(campaignId);

    return this.db.findCampaignById(campaignId);
  }

  /**
   * Agendar campanha
   */
  async schedule(campaignId, workspaceId, scheduleAt) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    if (campaign.status !== 'draft') {
      throw new Error('Apenas rascunhos podem ser agendados');
    }

    const scheduleDate = new Date(scheduleAt);
    if (scheduleDate <= new Date()) {
      throw new Error('Data de agendamento deve ser no futuro');
    }

    await this.db.updateCampaign(campaignId, {
      status: 'scheduled',
      scheduleAt: scheduleDate
    });

    return this.db.findCampaignById(campaignId);
  }

  /**
   * Atualizar progresso
   */
  async updateProgress(campaignId, itemId, status, error = null) {
    const now = new Date();

    await this.db.updateCampaignItem(itemId, {
      status,
      error,
      lastAttemptAt: now,
      ...(status === 'sent' && { sentAt: now }),
      ...(status === 'delivered' && { deliveredAt: now }),
      ...(status === 'read' && { readAt: now }),
      ...(status === 'failed' && { retries: { increment: 1 } })
    });

    // Atualizar contadores da campanha
    const updates = {};
    if (status === 'sent') updates.sentCount = { increment: 1 };
    if (status === 'failed') updates.failedCount = { increment: 1 };
    if (status === 'delivered') updates.deliveredCount = { increment: 1 };
    if (status === 'read') updates.readCount = { increment: 1 };

    await this.db.updateCampaignCounters(campaignId, updates);

    // Verificar se completou
    const campaign = await this.db.findCampaignById(campaignId);
    const pending = await this.db.countPendingCampaignItems(campaignId);

    if (pending === 0 && campaign.status === 'running') {
      await this.db.updateCampaign(campaignId, {
        status: 'completed',
        completedAt: now
      });
      
      this.activeCampaigns.delete(campaignId);
      
      if (this.eventEmitter) {
        this.eventEmitter.emit('campaign:completed', { campaignId });
      }
    }
  }

  /**
   * Obter próximo item para enviar
   */
  async getNextItem(campaignId) {
    return this.db.getNextPendingCampaignItem(campaignId);
  }

  /**
   * Listar campanhas
   */
  async list(workspaceId, options = {}) {
    const {
      page = 1,
      limit = 20,
      status = null,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    const offset = (page - 1) * limit;

    const { campaigns, total } = await this.db.listCampaigns(workspaceId, {
      offset,
      limit,
      status,
      sortBy,
      sortOrder
    });

    return {
      campaigns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Obter campanha por ID
   */
  async findById(campaignId, workspaceId) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }
    return campaign;
  }

  /**
   * Obter itens da campanha
   */
  async getItems(campaignId, workspaceId, options = {}) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    const { page = 1, limit = 100, status = null } = options;
    const offset = (page - 1) * limit;

    return this.db.getCampaignItems(campaignId, { offset, limit, status });
  }

  /**
   * Obter métricas da campanha
   */
  async getMetrics(campaignId, workspaceId) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    const itemCounts = await this.db.getCampaignItemCounts(campaignId);

    return {
      total: campaign.totalContacts,
      sent: campaign.sentCount,
      failed: campaign.failedCount,
      delivered: campaign.deliveredCount,
      read: campaign.readCount,
      pending: itemCounts.pending,
      sendRate: campaign.totalContacts > 0 
        ? ((campaign.sentCount / campaign.totalContacts) * 100).toFixed(1) 
        : 0,
      deliveryRate: campaign.sentCount > 0 
        ? ((campaign.deliveredCount / campaign.sentCount) * 100).toFixed(1) 
        : 0,
      readRate: campaign.deliveredCount > 0 
        ? ((campaign.readCount / campaign.deliveredCount) * 100).toFixed(1) 
        : 0,
      errorRate: campaign.sentCount > 0 
        ? ((campaign.failedCount / campaign.sentCount) * 100).toFixed(1) 
        : 0
    };
  }

  /**
   * Duplicar campanha
   */
  async duplicate(campaignId, workspaceId, userId) {
    const original = await this.db.findCampaignById(campaignId);
    if (!original || original.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    const newCampaign = await this.create(workspaceId, userId, {
      name: `${original.name} (cópia)`,
      description: original.description,
      message: original.message,
      mediaUrl: original.mediaUrl,
      mediaType: original.mediaType,
      intervalMs: original.intervalMs,
      batchSize: original.batchSize
    });

    // Copiar contatos
    const items = await this.db.getAllCampaignItems(campaignId);
    for (const item of items) {
      await this.db.createCampaignItem({
        id: uuidv4(),
        campaignId: newCampaign.id,
        phone: item.phone,
        contactId: item.contactId,
        status: 'pending'
      });
    }

    await this.db.updateCampaign(newCampaign.id, {
      totalContacts: items.length
    });

    return this.db.findCampaignById(newCampaign.id);
  }

  /**
   * Deletar campanha
   */
  async delete(campaignId, workspaceId) {
    const campaign = await this.db.findCampaignById(campaignId);
    if (!campaign || campaign.workspaceId !== workspaceId) {
      throw new Error('Campanha não encontrada');
    }

    if (campaign.status === 'running') {
      throw new Error('Pause a campanha antes de deletar');
    }

    await this.db.deleteCampaign(campaignId);
    return { success: true };
  }
}

module.exports = CampaignService;
