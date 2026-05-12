/**
 * ContactService — CRUD multi-tenant de contatos.
 *
 * Todos os métodos exigem `workspaceId` no primeiro parâmetro
 * (multi-tenant isolation). Sem isso, falha na validação de auth.
 *
 * @module services/ContactService
 */
/**
 * 📇 ContactService - Serviço de Contatos
 * WhatsHybrid Pro v7.1.0
 */

const { v4: uuidv4 } = require('../utils/uuid-wrapper');

class ContactService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Criar contato
   */
  async create(workspaceId, data) {
    const id = uuidv4();
    
    // Normalizar telefone
    const phone = this.normalizePhone(data.phone);
    
    // Verificar duplicidade
    const existing = await this.db.findContactByPhone(workspaceId, phone);
    if (existing) {
      throw new Error('Contato já existe com este telefone');
    }

    const contact = await this.db.createContact({
      id,
      workspaceId,
      phone,
      name: data.name || null,
      email: data.email || null,
      company: data.company || null,
      notes: data.notes || null,
      source: data.source || 'whatsapp',
      avatar: data.avatar || null,
      stage: data.stage || 'new',
      score: data.score || 0,
      customFields: data.customFields || {},
      metadata: data.metadata || {}
    });

    // Criar atividade
    await this.db.createActivity({
      id: uuidv4(),
      type: 'contact_created',
      contactId: id,
      content: 'Contato criado',
      metadata: { source: data.source }
    });

    // Atualizar analytics
    await this.incrementDailyMetric(workspaceId, 'contactsCreated');

    return contact;
  }

  /**
   * Atualizar contato
   */
  async update(id, workspaceId, data) {
    const contact = await this.db.findContactById(id);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error('Contato não encontrado');
    }

    // Se alterando telefone, verificar duplicidade
    if (data.phone && data.phone !== contact.phone) {
      const phone = this.normalizePhone(data.phone);
      const existing = await this.db.findContactByPhone(workspaceId, phone);
      if (existing && existing.id !== id) {
        throw new Error('Já existe outro contato com este telefone');
      }
      data.phone = phone;
    }

    // Registrar mudança de estágio
    if (data.stage && data.stage !== contact.stage) {
      await this.db.createActivity({
        id: uuidv4(),
        type: 'stage_changed',
        contactId: id,
        content: `Estágio alterado de ${contact.stage} para ${data.stage}`,
        metadata: { oldStage: contact.stage, newStage: data.stage }
      });
    }

    return this.db.updateContact(id, {
      ...data,
      updatedAt: new Date()
    });
  }

  /**
   * Deletar contato
   */
  async delete(id, workspaceId) {
    const contact = await this.db.findContactById(id);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error('Contato não encontrado');
    }

    await this.db.deleteContact(id);
    return { success: true };
  }

  /**
   * Buscar contato por ID
   */
  async findById(id, workspaceId) {
    const contact = await this.db.findContactById(id);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error('Contato não encontrado');
    }
    return contact;
  }

  /**
   * Buscar contato por telefone
   */
  async findByPhone(workspaceId, phone) {
    const normalizedPhone = this.normalizePhone(phone);
    return this.db.findContactByPhone(workspaceId, normalizedPhone);
  }

  /**
   * Listar contatos com filtros
   */
  async list(workspaceId, options = {}) {
    const {
      page = 1,
      limit = 50,
      search = '',
      stage = null,
      labelId = null,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = options;

    const offset = (page - 1) * limit;

    const { contacts, total } = await this.db.listContacts(workspaceId, {
      offset,
      limit,
      search,
      stage,
      labelId,
      sortBy,
      sortOrder
    });

    return {
      contacts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Adicionar label a contato
   */
  async addLabel(contactId, labelId, workspaceId) {
    const contact = await this.db.findContactById(contactId);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error('Contato não encontrado');
    }

    const label = await this.db.findLabelById(labelId);
    if (!label || label.workspaceId !== workspaceId) {
      throw new Error('Etiqueta não encontrada');
    }

    await this.db.addContactLabel(contactId, labelId);

    await this.db.createActivity({
      id: uuidv4(),
      type: 'label_added',
      contactId,
      content: `Etiqueta "${label.name}" adicionada`,
      metadata: { labelId, labelName: label.name }
    });

    return { success: true };
  }

  /**
   * Remover label de contato
   */
  async removeLabel(contactId, labelId, workspaceId) {
    const contact = await this.db.findContactById(contactId);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error('Contato não encontrado');
    }

    await this.db.removeContactLabel(contactId, labelId);

    return { success: true };
  }

  /**
   * Atualizar score do contato
   */
  async updateScore(contactId, score, workspaceId) {
    const contact = await this.db.findContactById(contactId);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error('Contato não encontrado');
    }

    return this.db.updateContact(contactId, { score });
  }

  /**
   * Merge de contatos duplicados
   */
  async merge(primaryId, secondaryId, workspaceId) {
    const primary = await this.db.findContactById(primaryId);
    const secondary = await this.db.findContactById(secondaryId);

    if (!primary || primary.workspaceId !== workspaceId) {
      throw new Error('Contato primário não encontrado');
    }
    if (!secondary || secondary.workspaceId !== workspaceId) {
      throw new Error('Contato secundário não encontrado');
    }

    // Transferir dados do secundário para o primário
    const mergedData = {
      name: primary.name || secondary.name,
      email: primary.email || secondary.email,
      company: primary.company || secondary.company,
      notes: [primary.notes, secondary.notes].filter(Boolean).join('\n\n---\n\n'),
      score: Math.max(primary.score, secondary.score),
      customFields: { ...secondary.customFields, ...primary.customFields }
    };

    await this.db.updateContact(primaryId, mergedData);

    // Transferir relacionamentos
    await this.db.transferContactRelations(secondaryId, primaryId);

    // Deletar secundário
    await this.db.deleteContact(secondaryId);

    await this.db.createActivity({
      id: uuidv4(),
      type: 'contacts_merged',
      contactId: primaryId,
      content: `Contato mesclado com ${secondary.phone}`,
      metadata: { mergedContactId: secondaryId }
    });

    return this.db.findContactById(primaryId);
  }

  /**
   * Importar contatos em massa
   */
  async bulkImport(workspaceId, contacts, options = {}) {
    const { skipDuplicates = true, updateExisting = false } = options;
    
    const results = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    for (const data of contacts) {
      try {
        const phone = this.normalizePhone(data.phone);
        const existing = await this.db.findContactByPhone(workspaceId, phone);

        if (existing) {
          if (updateExisting) {
            await this.update(existing.id, workspaceId, data);
            results.updated++;
          } else if (skipDuplicates) {
            results.skipped++;
          } else {
            results.errors.push({ phone: data.phone, error: 'Duplicado' });
          }
        } else {
          await this.create(workspaceId, { ...data, phone });
          results.created++;
        }
      } catch (error) {
        results.errors.push({ phone: data.phone, error: error.message });
      }
    }

    return results;
  }

  /**
   * Exportar contatos
   */
  async export(workspaceId, options = {}) {
    const { format = 'json', fields = null } = options;
    
    const { contacts } = await this.db.listContacts(workspaceId, {
      offset: 0,
      limit: 100000
    });

    if (format === 'csv') {
      return this.toCSV(contacts, fields);
    }

    return contacts;
  }

  /**
   * Obter timeline de atividades
   */
  async getTimeline(contactId, workspaceId, limit = 50) {
    const contact = await this.db.findContactById(contactId);
    if (!contact || contact.workspaceId !== workspaceId) {
      throw new Error('Contato não encontrado');
    }

    return this.db.getContactActivities(contactId, limit);
  }

  /**
   * Normalizar telefone
   */
  normalizePhone(phone) {
    if (!phone) throw new Error('Telefone é obrigatório');
    
    // Remove tudo que não é número
    let normalized = phone.replace(/\D/g, '');
    
    // Adiciona código do país se não tiver
    if (normalized.length === 10 || normalized.length === 11) {
      normalized = '55' + normalized;
    }
    
    return normalized;
  }

  /**
   * Converter para CSV
   */
  toCSV(contacts, fields = null) {
    const defaultFields = ['phone', 'name', 'email', 'company', 'stage', 'score', 'createdAt'];
    const useFields = fields || defaultFields;
    
    const header = useFields.join(',');
    const rows = contacts.map(c => 
      useFields.map(f => `"${(c[f] || '').toString().replace(/"/g, '""')}"`).join(',')
    );
    
    return [header, ...rows].join('\n');
  }

  /**
   * Incrementar métrica diária
   */
  async incrementDailyMetric(workspaceId, metric) {
    const today = new Date().toISOString().split('T')[0];
    await this.db.incrementAnalyticsDaily(workspaceId, today, metric);
  }
}

module.exports = ContactService;
