/**
 * 📇 ContactManager - Gerenciador Avançado de Contatos
 * WhatsHybrid v7.7.0
 * 
 * Camada de gerenciamento que integra:
 * - ContactImporter (import Excel/CSV)
 * - Extractor v7 (extração de contatos)
 * - CRM Module (sincronização)
 * 
 * Recursos NOVOS:
 * - Blacklist/Whitelist
 * - Histórico de interações
 * - Sistema de tags centralizado
 * - Filtros avançados
 * - Detecção de contatos inativos
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  class ContactManager {
    constructor() {
      this.contacts = new Map();
      this.blacklist = new Set();
      this.whitelist = new Set();
      this.tags = new Map(); // tag -> Set of phone numbers
      this.history = new Map(); // phone -> interaction history
      this.config = {
        autoSync: true,
        syncInterval: 300000, // 5 minutos
        maxHistory: 100,
        deduplicateOnImport: true
      };
      this.syncTimer = null;
    }

    /**
     * SECURITY FIX P0-003: Sanitize objects to prevent Prototype Pollution
     * Filters out dangerous keys (__proto__, constructor, prototype)
     */
    _sanitizeObject(obj) {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return obj;
      }

      const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
      const sanitized = {};

      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (dangerousKeys.includes(key)) {
            console.warn('[ContactManager Security] Blocked prototype pollution attempt:', key);
            continue;
          }

          // Recursively sanitize nested objects
          if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            sanitized[key] = this._sanitizeObject(obj[key]);
          } else {
            sanitized[key] = obj[key];
          }
        }
      }

      return sanitized;
    }

    /**
     * Inicializa o ContactManager
     */
    async initialize() {
      console.log('[ContactManager] 🚀 Inicializando...');
      
      await this.loadContacts();
      await this.loadBlacklist();
      await this.loadHistory();
      
      if (this.config.autoSync) {
        this.startAutoSync();
      }
      
      console.log('[ContactManager] ✅ Inicializado com', this.contacts.size, 'contatos');
      console.log('[ContactManager] 🚫 Blacklist:', this.blacklist.size, 'números');
      console.log('[ContactManager] ⭐ Whitelist:', this.whitelist.size, 'números');
    }

    // ============================================
    // IMPORTAÇÃO E EXPORTAÇÃO
    // ============================================

    /**
     * Importa contatos de CSV
     * Integra com o sistema de validação existente
     */
    async importFromCSV(csvContent, options = {}) {
      const { 
        skipHeader = true, 
        phoneColumn = 0, 
        nameColumn = 1,
        emailColumn = 2,
        tagColumn = 3,
        delimiter = ',',
        merge = true 
      } = options;

      const lines = csvContent.split('\n').filter(l => l.trim());
      const startIdx = skipHeader ? 1 : 0;
      
      let imported = 0;
      let skipped = 0;
      let duplicates = 0;

      for (let i = startIdx; i < lines.length; i++) {
        const values = this.parseCSVLine(lines[i], delimiter);
        const phone = this.normalizePhone(values[phoneColumn]);
        
        if (!phone) {
          skipped++;
          continue;
        }

        if (this.contacts.has(phone) && !merge) {
          duplicates++;
          continue;
        }

        const contact = {
          phone,
          name: values[nameColumn] || '',
          email: values[emailColumn] || '',
          tags: values[tagColumn] ? values[tagColumn].split(';').map(t => t.trim()) : [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: 'csv_import',
          metadata: {},
          history: [],
          messageCount: 0,
          lastInteraction: null
        };

        // Se merge, preservar dados existentes
        if (merge && this.contacts.has(phone)) {
          const existing = this.contacts.get(phone);
          contact.createdAt = existing.createdAt;
          contact.history = existing.history || [];
          contact.tags = [...new Set([...existing.tags, ...contact.tags])];
          duplicates++;
        }

        this.contacts.set(phone, contact);
        
        // Indexar tags
        contact.tags.forEach(tag => this.addToTagIndex(tag, phone));
        
        imported++;
      }

      await this.saveContacts();
      
      console.log(`[ContactManager] 📥 Importação: ${imported} novos, ${duplicates} atualizados, ${skipped} ignorados`);
      
      return { imported, skipped, duplicates, total: this.contacts.size };
    }

    /**
     * Importa contatos de JSON
     */
    async importFromJSON(jsonContent) {
      const data = typeof jsonContent === 'string' ? JSON.parse(jsonContent) : jsonContent;
      
      let imported = 0;
      for (const contact of data) {
        const phone = this.normalizePhone(contact.phone || contact.telefone);
        if (phone) {
          // SECURITY FIX P0-003: Sanitize contact before spread to prevent prototype pollution
          const sanitizedContact = this._sanitizeObject(contact);
          this.contacts.set(phone, {
            ...sanitizedContact,
            phone,
            updatedAt: Date.now()
          });
          
          // Indexar tags
          if (contact.tags) {
            contact.tags.forEach(tag => this.addToTagIndex(tag, phone));
          }
          
          imported++;
        }
      }
      
      await this.saveContacts();
      return { imported, total: this.contacts.size };
    }

    /**
     * Exporta para CSV
     */
    exportToCSV(filter = {}) {
      const contacts = this.filterContacts(filter);
      
      const headers = ['phone', 'name', 'email', 'tags', 'createdAt', 'lastInteraction', 'messageCount'];
      const rows = contacts.map(c => [
        c.phone,
        c.name || '',
        c.email || '',
        (c.tags || []).join(';'),
        c.createdAt ? new Date(c.createdAt).toISOString() : '',
        c.lastInteraction ? new Date(c.lastInteraction).toISOString() : '',
        c.messageCount || 0
      ]);
      
      return [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    }

    /**
     * Exporta para JSON
     */
    exportToJSON(filter = {}) {
      const contacts = this.filterContacts(filter);
      return JSON.stringify(contacts, null, 2);
    }

    // ============================================
    // GERENCIAMENTO DE CONTATOS
    // ============================================

    /**
     * Adiciona um contato
     */
    addContact(phone, data = {}) {
      const normalizedPhone = this.normalizePhone(phone);
      if (!normalizedPhone) return null;

      const contact = {
        phone: normalizedPhone,
        name: data.name || '',
        email: data.email || '',
        tags: data.tags || [],
        notes: data.notes || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: data.source || 'manual',
        metadata: data.metadata || {},
        history: [],
        messageCount: 0,
        lastInteraction: null
      };

      this.contacts.set(normalizedPhone, contact);
      contact.tags.forEach(tag => this.addToTagIndex(tag, normalizedPhone));
      this.saveContacts();
      
      return contact;
    }

    /**
     * Atualiza um contato
     */
    updateContact(phone, updates) {
      const contact = this.contacts.get(phone);
      if (!contact) return null;

      // Remover tags antigas do índice
      if (updates.tags && contact.tags) {
        contact.tags.forEach(tag => this.removeFromTagIndex(tag, phone));
      }

      // SECURITY FIX P0-003: Sanitize updates to prevent prototype pollution via Object.assign
      const sanitizedUpdates = this._sanitizeObject(updates);
      Object.assign(contact, sanitizedUpdates, { updatedAt: Date.now() });
      
      // Adicionar novas tags ao índice
      if (contact.tags) {
        contact.tags.forEach(tag => this.addToTagIndex(tag, phone));
      }

      this.saveContacts();
      return contact;
    }

    /**
     * Deleta um contato
     */
    deleteContact(phone) {
      const contact = this.contacts.get(phone);
      if (!contact) return false;

      // Remover do índice de tags
      if (contact.tags) {
        contact.tags.forEach(tag => this.removeFromTagIndex(tag, phone));
      }

      this.contacts.delete(phone);
      this.history.delete(phone);
      this.saveContacts();
      
      return true;
    }

    /**
     * Obtém um contato
     */
    getContact(phone) {
      return this.contacts.get(this.normalizePhone(phone)) || null;
    }

    /**
     * Lista todos os contatos com paginação
     */
    listContacts(options = {}) {
      const { page = 1, limit = 50, sortBy = 'name', sortOrder = 'asc' } = options;
      
      let contacts = Array.from(this.contacts.values());
      
      // Ordenar
      contacts.sort((a, b) => {
        const valA = a[sortBy] || '';
        const valB = b[sortBy] || '';
        const comparison = valA.toString().localeCompare(valB.toString());
        return sortOrder === 'asc' ? comparison : -comparison;
      });
      
      // Paginar
      const start = (page - 1) * limit;
      const paginated = contacts.slice(start, start + limit);
      
      return {
        contacts: paginated,
        total: contacts.length,
        page,
        totalPages: Math.ceil(contacts.length / limit)
      };
    }

    // ============================================
    // BUSCA E FILTROS AVANÇADOS
    // ============================================

    /**
     * Busca contatos por texto
     */
    searchContacts(query, options = {}) {
      const { fields = ['name', 'phone', 'email', 'notes'], limit = 50 } = options;
      const lowerQuery = query.toLowerCase();
      
      const results = [];
      
      for (const contact of this.contacts.values()) {
        for (const field of fields) {
          const value = contact[field];
          if (value && value.toString().toLowerCase().includes(lowerQuery)) {
            results.push({ ...contact, matchField: field });
            break;
          }
        }
        if (results.length >= limit) break;
      }
      
      return results;
    }

    /**
     * Filtra contatos com critérios avançados
     */
    filterContacts(filter = {}) {
      let contacts = Array.from(this.contacts.values());
      
      // Filtrar por tags
      if (filter.tags && filter.tags.length > 0) {
        contacts = contacts.filter(c => 
          filter.tags.some(tag => c.tags && c.tags.includes(tag))
        );
      }
      
      // Filtrar por data de criação
      if (filter.createdAfter) {
        contacts = contacts.filter(c => c.createdAt >= filter.createdAfter);
      }
      if (filter.createdBefore) {
        contacts = contacts.filter(c => c.createdAt <= filter.createdBefore);
      }
      
      // Filtrar por última interação
      if (filter.lastInteractionAfter) {
        contacts = contacts.filter(c => c.lastInteraction >= filter.lastInteractionAfter);
      }
      if (filter.lastInteractionBefore) {
        contacts = contacts.filter(c => c.lastInteraction <= filter.lastInteractionBefore);
      }
      
      // Filtrar por contagem de mensagens
      if (filter.minMessages !== undefined) {
        contacts = contacts.filter(c => (c.messageCount || 0) >= filter.minMessages);
      }
      if (filter.maxMessages !== undefined) {
        contacts = contacts.filter(c => (c.messageCount || 0) <= filter.maxMessages);
      }
      
      // Excluir blacklist
      if (filter.excludeBlacklist !== false) {
        contacts = contacts.filter(c => !this.blacklist.has(c.phone));
      }
      
      // Apenas whitelist
      if (filter.onlyWhitelist) {
        contacts = contacts.filter(c => this.whitelist.has(c.phone));
      }
      
      return contacts;
    }

    /**
     * Obtém contatos por tag
     */
    getContactsByTag(tag) {
      const phones = this.tags.get(tag) || new Set();
      return Array.from(phones).map(phone => this.contacts.get(phone)).filter(Boolean);
    }

    /**
     * Obtém contatos inativos
     */
    getInactiveContacts(days = 30) {
      const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
      return Array.from(this.contacts.values()).filter(c => 
        !c.lastInteraction || c.lastInteraction < threshold
      );
    }

    // ============================================
    // BLACKLIST E WHITELIST
    // ============================================

    /**
     * Adiciona número à blacklist
     */
    addToBlacklist(phone, reason = '') {
      const normalizedPhone = this.normalizePhone(phone);
      if (!normalizedPhone) return false;
      
      this.blacklist.add(normalizedPhone);
      
      // Registrar motivo
      const contact = this.contacts.get(normalizedPhone);
      if (contact) {
        contact.blacklistReason = reason;
        contact.blacklistedAt = Date.now();
      }
      
      this.saveBlacklist();
      console.log('[ContactManager] 🚫 Adicionado à blacklist:', normalizedPhone);
      return true;
    }

    /**
     * Remove da blacklist
     */
    removeFromBlacklist(phone) {
      const normalizedPhone = this.normalizePhone(phone);
      this.blacklist.delete(normalizedPhone);
      
      const contact = this.contacts.get(normalizedPhone);
      if (contact) {
        delete contact.blacklistReason;
        delete contact.blacklistedAt;
      }
      
      this.saveBlacklist();
      return true;
    }

    /**
     * Verifica se está na blacklist
     */
    isBlacklisted(phone) {
      return this.blacklist.has(this.normalizePhone(phone));
    }

    /**
     * Adiciona à whitelist
     */
    addToWhitelist(phone) {
      const normalizedPhone = this.normalizePhone(phone);
      if (!normalizedPhone) return false;
      
      this.whitelist.add(normalizedPhone);
      this.saveWhitelist();
      return true;
    }

    /**
     * Remove da whitelist
     */
    removeFromWhitelist(phone) {
      this.whitelist.delete(this.normalizePhone(phone));
      this.saveWhitelist();
      return true;
    }

    /**
     * Lista blacklist
     */
    listBlacklist() {
      return Array.from(this.blacklist).map(phone => ({
        phone,
        contact: this.contacts.get(phone) || null
      }));
    }

    // ============================================
    // HISTÓRICO DE INTERAÇÕES
    // ============================================

    /**
     * Registra uma interação
     */
    recordInteraction(phone, interaction) {
      const normalizedPhone = this.normalizePhone(phone);
      const contact = this.contacts.get(normalizedPhone);
      
      const record = {
        type: interaction.type || 'message',
        direction: interaction.direction || 'outgoing',
        content: interaction.content || '',
        timestamp: Date.now(),
        metadata: interaction.metadata || {}
      };
      
      if (!this.history.has(normalizedPhone)) {
        this.history.set(normalizedPhone, []);
      }
      
      const history = this.history.get(normalizedPhone);
      history.push(record);
      
      // Limitar tamanho do histórico
      if (history.length > this.config.maxHistory) {
        history.shift();
      }
      
      // Atualizar contato
      if (contact) {
        contact.lastInteraction = Date.now();
        contact.messageCount = (contact.messageCount || 0) + 1;
      }
      
      this.saveHistory();
      return record;
    }

    /**
     * Obtém histórico de um contato
     */
    getHistory(phone, options = {}) {
      const { limit = 50, type = null } = options;
      const normalizedPhone = this.normalizePhone(phone);
      
      let history = this.history.get(normalizedPhone) || [];
      
      if (type) {
        history = history.filter(h => h.type === type);
      }
      
      return history.slice(-limit);
    }

    /**
     * Limpa histórico de um contato
     */
    clearHistory(phone) {
      this.history.delete(this.normalizePhone(phone));
      this.saveHistory();
    }

    // ============================================
    // TAGS E ORGANIZAÇÃO
    // ============================================

    /**
     * Adiciona tag a um contato
     */
    addTag(phone, tag) {
      const contact = this.contacts.get(this.normalizePhone(phone));
      if (!contact) return false;
      
      if (!contact.tags) contact.tags = [];
      if (!contact.tags.includes(tag)) {
        contact.tags.push(tag);
        this.addToTagIndex(tag, phone);
        this.saveContacts();
      }
      
      return true;
    }

    /**
     * Remove tag de um contato
     */
    removeTag(phone, tag) {
      const contact = this.contacts.get(this.normalizePhone(phone));
      if (!contact || !contact.tags) return false;
      
      const idx = contact.tags.indexOf(tag);
      if (idx > -1) {
        contact.tags.splice(idx, 1);
        this.removeFromTagIndex(tag, phone);
        this.saveContacts();
      }
      
      return true;
    }

    /**
     * Lista todas as tags com contagem
     */
    listTags() {
      const tagStats = [];
      for (const [tag, phones] of this.tags) {
        tagStats.push({
          tag,
          count: phones.size
        });
      }
      return tagStats.sort((a, b) => b.count - a.count);
    }

    /**
     * Adiciona ao índice de tags
     */
    addToTagIndex(tag, phone) {
      if (!this.tags.has(tag)) {
        this.tags.set(tag, new Set());
      }
      this.tags.get(tag).add(phone);
    }

    /**
     * Remove do índice de tags
     */
    removeFromTagIndex(tag, phone) {
      if (this.tags.has(tag)) {
        this.tags.get(tag).delete(phone);
        if (this.tags.get(tag).size === 0) {
          this.tags.delete(tag);
        }
      }
    }

    // ============================================
    // SINCRONIZAÇÃO COM CRM
    // ============================================

    /**
     * Sincroniza com o CRM interno
     */
    async syncWithCRM() {
      if (!window.CRMModule) {
        console.warn('[ContactManager] CRM não disponível');
        return { synced: 0, total: this.contacts.size };
      }
      
      const crmContacts = window.CRMModule.getContacts ? window.CRMModule.getContacts() : [];
      let synced = 0;
      
      for (const crmContact of crmContacts) {
        const phone = this.normalizePhone(crmContact.phone);
        if (!phone) continue;
        
        const existing = this.contacts.get(phone);
        
        if (existing) {
          // Merge dados
          existing.crmId = crmContact.id;
          existing.name = existing.name || crmContact.name;
          existing.email = existing.email || crmContact.email;
          existing.crmData = crmContact;
          existing.updatedAt = Date.now();
        } else {
          // Criar novo
          this.addContact(phone, {
            name: crmContact.name,
            email: crmContact.email,
            source: 'crm_sync',
            metadata: { crmId: crmContact.id }
          });
        }
        synced++;
      }
      
      await this.saveContacts();
      console.log(`[ContactManager] 🔄 Sincronizados ${synced} contatos com CRM`);
      
      return { synced, total: this.contacts.size };
    }

    /**
     * Inicia sincronização automática
     */
    startAutoSync() {
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
      }
      
      this.syncTimer = setInterval(() => {
        this.syncWithCRM();
      }, this.config.syncInterval);
      
      console.log('[ContactManager] 🔄 Auto-sync iniciado');
    }

    /**
     * Para sincronização automática
     */
    stopAutoSync() {
      if (this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
        console.log('[ContactManager] 🔄 Auto-sync parado');
      }
    }

    // ============================================
    // PERSISTÊNCIA
    // ============================================

    /**
     * Salva contatos no storage
     */
    async saveContacts() {
      const data = Object.fromEntries(this.contacts);
      await chrome.storage.local.set({ contactManager_contacts: data });
    }

    /**
     * Carrega contatos do storage
     */
    async loadContacts() {
      return new Promise(resolve => {
        chrome.storage.local.get(['contactManager_contacts'], result => {
          if (result.contactManager_contacts) {
            this.contacts = new Map(Object.entries(result.contactManager_contacts));
            // Reconstruir índice de tags
            for (const contact of this.contacts.values()) {
              if (contact.tags) {
                contact.tags.forEach(tag => this.addToTagIndex(tag, contact.phone));
              }
            }
          }
          resolve();
        });
      });
    }

    /**
     * Salva blacklist e whitelist
     */
    async saveBlacklist() {
      await chrome.storage.local.set({ 
        contactManager_blacklist: Array.from(this.blacklist)
      });
    }

    /**
     * Salva whitelist
     */
    async saveWhitelist() {
      await chrome.storage.local.set({ 
        contactManager_whitelist: Array.from(this.whitelist)
      });
    }

    /**
     * Carrega blacklist e whitelist
     */
    async loadBlacklist() {
      return new Promise(resolve => {
        chrome.storage.local.get(['contactManager_blacklist', 'contactManager_whitelist'], result => {
          if (result.contactManager_blacklist) {
            this.blacklist = new Set(result.contactManager_blacklist);
          }
          if (result.contactManager_whitelist) {
            this.whitelist = new Set(result.contactManager_whitelist);
          }
          resolve();
        });
      });
    }

    /**
     * Salva histórico
     */
    async saveHistory() {
      const data = Object.fromEntries(this.history);
      await chrome.storage.local.set({ contactManager_history: data });
    }

    /**
     * Carrega histórico
     */
    async loadHistory() {
      return new Promise(resolve => {
        chrome.storage.local.get(['contactManager_history'], result => {
          if (result.contactManager_history) {
            this.history = new Map(Object.entries(result.contactManager_history));
          }
          resolve();
        });
      });
    }

    // ============================================
    // UTILITÁRIOS
    // ============================================

    /**
     * Normaliza número de telefone
     */
    normalizePhone(phone) {
      if (!phone) return null;
      let normalized = phone.toString().replace(/\D/g, '');
      if (normalized.length >= 10 && normalized.length <= 13) {
        if (!normalized.startsWith('55') && normalized.length <= 11) {
          normalized = '55' + normalized;
        }
        return normalized;
      }
      return null;
    }

    /**
     * Parse linha CSV
     */
    parseCSVLine(line, delimiter = ',') {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      
      return result;
    }

    /**
     * Obtém estatísticas
     */
    getStats() {
      return {
        totalContacts: this.contacts.size,
        blacklisted: this.blacklist.size,
        whitelisted: this.whitelist.size,
        totalTags: this.tags.size,
        withHistory: this.history.size
      };
    }
  }

  // ============================================
  // MÓDULO GLOBAL
  // ============================================

  const contactManagerInstance = new ContactManager();
  
  // Adicionar método init para compatibilidade com init.js
  contactManagerInstance.init = async function() {
    await this.initialize();
  };

  window.ContactManager = contactManagerInstance;

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (window.ContactManager?.stopAutoSync) {
      window.ContactManager.stopAutoSync();
    }
  });

  // Expor para uso como módulo
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContactManager;
  }

  console.log('[ContactManager] 📇 Classe carregada');

})();
