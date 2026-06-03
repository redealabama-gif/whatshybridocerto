/**
 * DealService — pipeline CRM (lead → qualified → proposal → won/lost).
 *
 * Estados padrão: new, contacted, qualified, proposal, negotiation,
 * won, lost. Customizáveis via workspace_settings.
 *
 * @module services/DealService
 */
/**
 * 💰 DealService - Serviço de Negócios/Deals
 * WhatsHybrid Pro v7.1.0
 */

const { v4: uuidv4 } = require('../utils/uuid-wrapper');

class DealService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Criar deal
   */
  async create(workspaceId, data) {
    const id = uuidv4();

    // Validar estágio
    if (data.stageId) {
      const stage = await this.db.findPipelineStageById(data.stageId);
      if (!stage) {
        throw new Error('Estágio não encontrado');
      }
    }

    // Validar contato
    if (data.contactId) {
      const contact = await this.db.findContactById(data.contactId);
      if (!contact || contact.workspaceId !== workspaceId) {
        throw new Error('Contato não encontrado');
      }
    }

    const deal = await this.db.createDeal({
      id,
      workspaceId,
      title: data.title,
      value: data.value || 0,
      currency: data.currency || 'BRL',
      status: 'open',
      probability: data.probability || 50,
      expectedCloseDate: data.expectedCloseDate || null,
      notes: data.notes || null,
      contactId: data.contactId || null,
      stageId: data.stageId || null,
      assigneeId: data.assigneeId || null,
      customFields: data.customFields || {}
    });

    // Criar atividade
    await this.db.createActivity({
      id: uuidv4(),
      type: 'deal_created',
      dealId: id,
      contactId: data.contactId,
      content: `Negócio "${data.title}" criado`,
      metadata: { value: data.value, currency: data.currency }
    });

    // Atualizar analytics
    await this.incrementDailyMetric(workspaceId, 'dealsCreated');

    return deal;
  }

  /**
   * Atualizar deal
   */
  async update(id, workspaceId, data) {
    const deal = await this.db.findDealById(id);
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new Error('Negócio não encontrado');
    }

    // Registrar mudança de estágio
    if (data.stageId && data.stageId !== deal.stageId) {
      const oldStage = deal.stageId ? await this.db.findPipelineStageById(deal.stageId) : null;
      const newStage = await this.db.findPipelineStageById(data.stageId);

      await this.db.createActivity({
        id: uuidv4(),
        type: 'stage_changed',
        dealId: id,
        contactId: deal.contactId,
        content: `Movido de "${oldStage?.name || 'Sem estágio'}" para "${newStage?.name}"`,
        metadata: { 
          oldStageId: deal.stageId, 
          newStageId: data.stageId,
          oldStageName: oldStage?.name,
          newStageName: newStage?.name
        }
      });
    }

    return this.db.updateDeal(id, {
      ...data,
      updatedAt: new Date()
    });
  }

  /**
   * Mover deal para estágio
   */
  async moveToStage(dealId, stageId, workspaceId) {
    return this.update(dealId, workspaceId, { stageId });
  }

  /**
   * Marcar como ganho
   */
  async markAsWon(id, workspaceId, data = {}) {
    const deal = await this.db.findDealById(id);
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new Error('Negócio não encontrado');
    }

    if (deal.status !== 'open') {
      throw new Error('Apenas negócios abertos podem ser marcados como ganhos');
    }

    await this.db.updateDeal(id, {
      status: 'won',
      probability: 100,
      ...data,
      updatedAt: new Date()
    });

    await this.db.createActivity({
      id: uuidv4(),
      type: 'deal_won',
      dealId: id,
      contactId: deal.contactId,
      content: `Negócio "${deal.title}" ganho!`,
      metadata: { value: deal.value, currency: deal.currency }
    });

    // Atualizar analytics
    await this.incrementDailyMetric(workspaceId, 'dealsWon');
    await this.incrementDailyRevenue(workspaceId, deal.value);

    // Atualizar estágio do contato
    if (deal.contactId) {
      await this.db.updateContact(deal.contactId, { stage: 'won' });
    }

    return this.db.findDealById(id);
  }

  /**
   * Marcar como perdido
   */
  async markAsLost(id, workspaceId, lostReason = null) {
    const deal = await this.db.findDealById(id);
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new Error('Negócio não encontrado');
    }

    if (deal.status !== 'open') {
      throw new Error('Apenas negócios abertos podem ser marcados como perdidos');
    }

    await this.db.updateDeal(id, {
      status: 'lost',
      probability: 0,
      lostReason,
      updatedAt: new Date()
    });

    await this.db.createActivity({
      id: uuidv4(),
      type: 'deal_lost',
      dealId: id,
      contactId: deal.contactId,
      content: `Negócio "${deal.title}" perdido`,
      metadata: { lostReason, value: deal.value }
    });

    // Atualizar analytics
    await this.incrementDailyMetric(workspaceId, 'dealsLost');

    // Atualizar estágio do contato
    if (deal.contactId) {
      await this.db.updateContact(deal.contactId, { stage: 'lost' });
    }

    return this.db.findDealById(id);
  }

  /**
   * Reabrir deal
   */
  async reopen(id, workspaceId) {
    const deal = await this.db.findDealById(id);
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new Error('Negócio não encontrado');
    }

    if (deal.status === 'open') {
      throw new Error('Negócio já está aberto');
    }

    await this.db.updateDeal(id, {
      status: 'open',
      probability: 50,
      lostReason: null,
      updatedAt: new Date()
    });

    await this.db.createActivity({
      id: uuidv4(),
      type: 'deal_reopened',
      dealId: id,
      contactId: deal.contactId,
      content: `Negócio "${deal.title}" reaberto`
    });

    return this.db.findDealById(id);
  }

  /**
   * Deletar deal
   */
  async delete(id, workspaceId) {
    const deal = await this.db.findDealById(id);
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new Error('Negócio não encontrado');
    }

    await this.db.deleteDeal(id);
    return { success: true };
  }

  /**
   * Buscar deal por ID
   */
  async findById(id, workspaceId) {
    const deal = await this.db.findDealById(id);
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new Error('Negócio não encontrado');
    }
    return deal;
  }

  /**
   * Listar deals
   */
  async list(workspaceId, options = {}) {
    const {
      page = 1,
      limit = 50,
      status = null,
      stageId = null,
      contactId = null,
      assigneeId = null,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    const offset = (page - 1) * limit;

    const { deals, total } = await this.db.listDeals(workspaceId, {
      offset,
      limit,
      status,
      stageId,
      contactId,
      assigneeId,
      sortBy,
      sortOrder
    });

    return {
      deals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Obter deals por pipeline (Kanban)
   */
  async getByPipeline(workspaceId, pipelineId = null) {
    // Se não especificou, pegar pipeline padrão
    let pipeline;
    if (pipelineId) {
      pipeline = await this.db.findPipelineById(pipelineId);
    } else {
      pipeline = await this.db.findDefaultPipeline(workspaceId);
    }

    if (!pipeline || pipeline.workspaceId !== workspaceId) {
      throw new Error('Pipeline não encontrado');
    }

    // Buscar estágios
    const stages = await this.db.getPipelineStages(pipeline.id);

    // Buscar deals por estágio
    const result = await Promise.all(
      stages.map(async (stage) => {
        const deals = await this.db.getDealsByStage(stage.id);
        return {
          ...stage,
          deals,
          totalValue: deals.reduce((sum, d) => sum + (d.value || 0), 0),
          count: deals.length
        };
      })
    );

    return {
      pipeline,
      stages: result
    };
  }

  /**
   * Obter métricas de deals
   */
  async getMetrics(workspaceId, options = {}) {
    const { startDate, endDate } = options;

    const metrics = await this.db.getDealMetrics(workspaceId, startDate, endDate);

    return {
      total: metrics.total,
      open: metrics.open,
      won: metrics.won,
      lost: metrics.lost,
      totalValue: metrics.totalValue,
      wonValue: metrics.wonValue,
      lostValue: metrics.lostValue,
      avgDealSize: metrics.avgDealSize,
      winRate: metrics.total > 0 ? (metrics.won / metrics.total * 100).toFixed(1) : 0,
      avgSalesCycle: metrics.avgSalesCycle // dias
    };
  }

  /**
   * Obter forecast
   */
  async getForecast(workspaceId, months = 3) {
    const deals = await this.db.getOpenDeals(workspaceId);
    
    const forecast = [];
    const now = new Date();

    for (let i = 0; i < months; i++) {
      const month = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + i + 1, 0);

      const monthDeals = deals.filter(d => {
        if (!d.expectedCloseDate) return false;
        const closeDate = new Date(d.expectedCloseDate);
        return closeDate >= month && closeDate <= monthEnd;
      });

      const weighted = monthDeals.reduce((sum, d) => 
        sum + (d.value * (d.probability / 100)), 0
      );

      forecast.push({
        month: month.toISOString().slice(0, 7),
        dealCount: monthDeals.length,
        totalValue: monthDeals.reduce((sum, d) => sum + d.value, 0),
        weightedValue: weighted
      });
    }

    return forecast;
  }

  /**
   * Adicionar nota ao deal
   */
  async addNote(dealId, workspaceId, userId, content) {
    const deal = await this.db.findDealById(dealId);
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new Error('Negócio não encontrado');
    }

    await this.db.createActivity({
      id: uuidv4(),
      type: 'note',
      dealId,
      contactId: deal.contactId,
      userId,
      content
    });

    return { success: true };
  }

  /**
   * Obter timeline do deal
   */
  async getTimeline(dealId, workspaceId, limit = 50) {
    const deal = await this.db.findDealById(dealId);
    if (!deal || deal.workspaceId !== workspaceId) {
      throw new Error('Negócio não encontrado');
    }

    return this.db.getDealActivities(dealId, limit);
  }

  /**
   * Incrementar métrica diária
   */
  async incrementDailyMetric(workspaceId, metric) {
    const today = new Date().toISOString().split('T')[0];
    await this.db.incrementAnalyticsDaily(workspaceId, today, metric);
  }

  /**
   * Incrementar revenue diário
   */
  async incrementDailyRevenue(workspaceId, value) {
    const today = new Date().toISOString().split('T')[0];
    await this.db.incrementAnalyticsDaily(workspaceId, today, 'revenue', value);
  }
}

module.exports = DealService;
