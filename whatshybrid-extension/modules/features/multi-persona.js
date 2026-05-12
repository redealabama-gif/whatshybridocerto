/**
 * FEAT-001: Multi-Persona System - Sistema de múltiplas personas de IA
 * 
 * TODO: AUDIT-NEW-018 (P3) - i18n AI Prompts
 * This module has hardcoded Portuguese persona prompts.
 * See: docs/internal/PEND-MED-003-I18N-AI-PROMPTS-FIX.md for full implementation guide.
 * Lines affected: 29-69 (PERSONAS definitions)
 * 
 * Benefícios:
 * - Atendimento personalizado por departamento/produto
 * - Tom e estilo adequados ao contexto
 * - Gerenciamento centralizado de personas
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_multi_persona',
    MAX_PERSONAS: 20,
    DEFAULT_PERSONA_ID: 'default'
  };

  const DEFAULT_PERSONAS = {
    default: {
      id: 'default',
      name: 'Assistente Padrão',
      description: 'Assistente geral para todas as situações',
      tone: 'professional',
      language: 'pt-BR',
      systemPrompt: 'Você é um assistente virtual profissional e amigável.',
      rules: ['Seja cordial', 'Responda de forma clara', 'Use emojis moderadamente'],
      triggers: { keywords: [], categories: [], contacts: [] },
      settings: { temperature: 0.7, maxTokens: 500, useFewShot: true },
      stats: { uses: 0, avgRating: 0 },
      createdAt: Date.now(),
      isDefault: true
    },
    sales: {
      id: 'sales',
      name: 'Vendas',
      description: 'Especialista em vendas e conversão',
      tone: 'persuasive',
      language: 'pt-BR',
      systemPrompt: 'Você é um especialista em vendas. Seja persuasivo mas não agressivo.',
      rules: ['Destaque benefícios', 'Crie urgência sutil', 'Ofereça soluções'],
      triggers: { keywords: ['preço', 'comprar', 'desconto'], categories: ['pricing'], contacts: [] },
      settings: { temperature: 0.8, maxTokens: 600, useFewShot: true },
      stats: { uses: 0, avgRating: 0 },
      createdAt: Date.now()
    },
    support: {
      id: 'support',
      name: 'Suporte Técnico',
      description: 'Suporte técnico paciente e detalhado',
      tone: 'helpful',
      language: 'pt-BR',
      systemPrompt: 'Você é um especialista em suporte técnico. Seja paciente e detalhado.',
      rules: ['Explique passo a passo', 'Confirme entendimento', 'Ofereça alternativas'],
      triggers: { keywords: ['problema', 'erro', 'não funciona', 'ajuda'], categories: ['support', 'troubleshooting'], contacts: [] },
      settings: { temperature: 0.5, maxTokens: 800, useFewShot: true },
      stats: { uses: 0, avgRating: 0 },
      createdAt: Date.now()
    },
    friendly: {
      id: 'friendly',
      name: 'Atendimento Amigável',
      description: 'Tom casual e descontraído',
      tone: 'casual',
      language: 'pt-BR',
      systemPrompt: 'Você é um assistente super amigável e descontraído.',
      rules: ['Use emojis', 'Seja informal', 'Demonstre entusiasmo'],
      triggers: { keywords: ['oi', 'olá', 'eai'], categories: ['greeting'], contacts: [] },
      settings: { temperature: 0.9, maxTokens: 400, useFewShot: true },
      stats: { uses: 0, avgRating: 0 },
      createdAt: Date.now()
    }
  };

  class MultiPersonaSystem {
    constructor() {
      this.personas = new Map();
      this.activePersona = CONFIG.DEFAULT_PERSONA_ID;
      this.contactPersonaMap = new Map();
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this._setupEventListeners();
      this.initialized = true;
      console.log('[MultiPersona] Initialized with', this.personas.size, 'personas');
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data?.personas) {
          for (const [id, persona] of Object.entries(data.personas)) {
            this.personas.set(id, persona);
          }
          this.contactPersonaMap = new Map(Object.entries(data.contactMap || {}));
        } else {
          // Carregar personas padrão
          for (const [id, persona] of Object.entries(DEFAULT_PERSONAS)) {
            this.personas.set(id, persona);
          }
        }
      } catch (e) {
        console.warn('[MultiPersona] Load failed:', e);
        for (const [id, persona] of Object.entries(DEFAULT_PERSONAS)) {
          this.personas.set(id, persona);
        }
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        personas: Object.fromEntries(this.personas),
        contactMap: Object.fromEntries(this.contactPersonaMap),
        activePersona: this.activePersona
      });
    }

    _getStorage(key) {
      return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get([key], r => resolve(r[key]));
        } else resolve(null);
      });
    }

    _setStorage(key, value) {
      return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.set({ [key]: value }, resolve);
        } else resolve();
      });
    }

    _setupEventListeners() {
      if (window.WHLEventBus) {
        window.WHLEventBus.on('chatOpened', data => this._autoSelectPersona(data));
        window.WHLEventBus.on('messageReceived', data => this._checkTriggers(data));
      }
    }

    _autoSelectPersona(data) {
      const { contactId } = data;
      if (this.contactPersonaMap.has(contactId)) {
        this.activePersona = this.contactPersonaMap.get(contactId);
      } else {
        this.activePersona = CONFIG.DEFAULT_PERSONA_ID;
      }
    }

    _checkTriggers(data) {
      const { message, category } = data;
      if (!message) return;

      const messageLower = message.toLowerCase();

      for (const [id, persona] of this.personas) {
        if (id === CONFIG.DEFAULT_PERSONA_ID) continue;

        const { triggers } = persona;
        
        // Check keywords
        if (triggers.keywords?.some(kw => messageLower.includes(kw.toLowerCase()))) {
          this.activePersona = id;
          return;
        }

        // Check categories
        if (category && triggers.categories?.includes(category)) {
          this.activePersona = id;
          return;
        }
      }
    }

    /**
     * Obtém a persona atual
     */
    getCurrentPersona() {
      return this.personas.get(this.activePersona) || this.personas.get(CONFIG.DEFAULT_PERSONA_ID);
    }

    /**
     * Define a persona ativa
     */
    setActivePersona(personaId) {
      if (this.personas.has(personaId)) {
        this.activePersona = personaId;
        this._saveData();
        return true;
      }
      return false;
    }

    /**
     * Associa uma persona a um contato
     */
    setContactPersona(contactId, personaId) {
      if (personaId && this.personas.has(personaId)) {
        this.contactPersonaMap.set(contactId, personaId);
      } else {
        this.contactPersonaMap.delete(contactId);
      }
      this._saveData();
    }

    /**
     * Cria uma nova persona
     */
    async createPersona(config) {
      if (this.personas.size >= CONFIG.MAX_PERSONAS) {
        throw new Error('Maximum personas reached');
      }

      const id = `persona_${Date.now()}`;
      const persona = {
        id,
        name: config.name || 'Nova Persona',
        description: config.description || '',
        tone: config.tone || 'professional',
        language: config.language || 'pt-BR',
        systemPrompt: config.systemPrompt || '',
        rules: config.rules || [],
        triggers: config.triggers || { keywords: [], categories: [], contacts: [] },
        settings: { temperature: 0.7, maxTokens: 500, useFewShot: true, ...config.settings },
        stats: { uses: 0, avgRating: 0 },
        createdAt: Date.now()
      };

      this.personas.set(id, persona);
      await this._saveData();
      return persona;
    }

    /**
     * Atualiza uma persona
     */
    async updatePersona(personaId, updates) {
      const persona = this.personas.get(personaId);
      if (!persona) return null;

      const updated = { ...persona, ...updates, id: personaId, updatedAt: Date.now() };
      this.personas.set(personaId, updated);
      await this._saveData();
      return updated;
    }

    /**
     * Remove uma persona
     */
    async deletePersona(personaId) {
      if (personaId === CONFIG.DEFAULT_PERSONA_ID) return false;
      
      this.personas.delete(personaId);
      
      // Limpar referências de contatos
      for (const [contactId, pid] of this.contactPersonaMap) {
        if (pid === personaId) this.contactPersonaMap.delete(contactId);
      }
      
      if (this.activePersona === personaId) {
        this.activePersona = CONFIG.DEFAULT_PERSONA_ID;
      }
      
      await this._saveData();
      return true;
    }

    /**
     * Gera system prompt para a persona atual
     */
    generateSystemPrompt(additionalContext = '') {
      const persona = this.getCurrentPersona();
      
      let prompt = persona.systemPrompt;
      
      if (persona.rules.length > 0) {
        prompt += `\n\nRegras:\n${persona.rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
      }
      
      if (additionalContext) {
        prompt += `\n\n${additionalContext}`;
      }
      
      return prompt;
    }

    /**
     * Obtém configurações de IA para a persona atual
     */
    getAISettings() {
      const persona = this.getCurrentPersona();
      return {
        temperature: persona.settings.temperature,
        maxTokens: persona.settings.maxTokens,
        systemPrompt: this.generateSystemPrompt()
      };
    }

    /**
     * Registra uso e feedback
     */
    recordUsage(rating = null) {
      const persona = this.getCurrentPersona();
      persona.stats.uses++;
      
      if (rating !== null) {
        const { uses, avgRating } = persona.stats;
        persona.stats.avgRating = ((avgRating * (uses - 1)) + rating) / uses;
      }
      
      this._saveData();
    }

    /**
     * Lista todas as personas
     */
    listPersonas() {
      return Array.from(this.personas.values()).map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        tone: p.tone,
        stats: p.stats,
        isDefault: p.isDefault,
        isActive: p.id === this.activePersona
      }));
    }

    /**
     * Obtém estatísticas
     */
    getStats() {
      const personas = Array.from(this.personas.values());
      return {
        totalPersonas: personas.length,
        activePersona: this.activePersona,
        totalUses: personas.reduce((sum, p) => sum + p.stats.uses, 0),
        avgRating: personas.reduce((sum, p) => sum + p.stats.avgRating, 0) / personas.length,
        contactMappings: this.contactPersonaMap.size
      };
    }

    /**
     * Exporta dados
     */
    exportData() {
      return {
        personas: Object.fromEntries(this.personas),
        contactMap: Object.fromEntries(this.contactPersonaMap),
        stats: this.getStats(),
        exportedAt: new Date().toISOString()
      };
    }
  }

  // Inicialização
  const multiPersona = new MultiPersonaSystem();
  multiPersona.init();

  // Expor globalmente
  window.WHLMultiPersona = multiPersona;
  window.WHLPersonaConfig = CONFIG;

  console.log('[FEAT-001] Multi-Persona System initialized');

})();
