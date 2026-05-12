/**
 * FEAT-006: Smart Templates - Templates inteligentes com variáveis dinâmicas
 * 
 * Benefícios:
 * - Respostas rápidas personalizadas
 * - Variáveis dinâmicas (nome, data, etc)
 * - Templates adaptativos por contexto
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_smart_templates',
    MAX_TEMPLATES: 100,
    
    VARIABLE_PATTERNS: {
      NAME: /\{\{nome\}\}/gi,
      FIRST_NAME: /\{\{primeiro_nome\}\}/gi,
      DATE: /\{\{data\}\}/gi,
      TIME: /\{\{hora\}\}/gi,
      WEEKDAY: /\{\{dia_semana\}\}/gi,
      GREETING: /\{\{saudacao\}\}/gi,
      COMPANY: /\{\{empresa\}\}/gi,
      PRODUCT: /\{\{produto\}\}/gi,
      PRICE: /\{\{preco\}\}/gi,
      CUSTOM: /\{\{(\w+)\}\}/g
    },
    
    CATEGORIES: ['greeting', 'closing', 'pricing', 'support', 'follow_up', 'custom']
  };

  const DEFAULT_TEMPLATES = [
    {
      id: 'welcome',
      name: 'Boas-vindas',
      category: 'greeting',
      content: '{{saudacao}}, {{primeiro_nome}}! 👋\nSeja bem-vindo(a)! Como posso ajudar você hoje?',
      shortcut: '/oi',
      usageCount: 0
    },
    {
      id: 'pricing',
      name: 'Informar Preço',
      category: 'pricing',
      content: 'O valor do {{produto}} é {{preco}}.\nPosso ajudar com mais alguma informação?',
      shortcut: '/preco',
      usageCount: 0
    },
    {
      id: 'thanks',
      name: 'Agradecimento',
      category: 'closing',
      content: 'Obrigado por entrar em contato, {{primeiro_nome}}! 🙏\nQualquer dúvida, estou à disposição.',
      shortcut: '/obg',
      usageCount: 0
    },
    {
      id: 'wait',
      name: 'Aguardar',
      category: 'support',
      content: 'Um momento, {{primeiro_nome}}! Estou verificando isso para você. ⏳',
      shortcut: '/aguarde',
      usageCount: 0
    },
    {
      id: 'followup',
      name: 'Follow-up',
      category: 'follow_up',
      content: 'Olá, {{primeiro_nome}}! 👋\nPassando aqui para saber se posso ajudar em algo mais.',
      shortcut: '/follow',
      usageCount: 0
    }
  ];

  class SmartTemplates {
    constructor() {
      this.templates = new Map();
      this.shortcuts = new Map();
      this.variables = new Map();
      this.initialized = false;
    }

    async init() {
      await this._loadData();
      this._setupEventListeners();
      this._setupShortcutListener();
      this.initialized = true;
      console.log('[SmartTemplates] Initialized with', this.templates.size, 'templates');
    }

    async _loadData() {
      try {
        const data = await this._getStorage(CONFIG.STORAGE_KEY);
        if (data?.templates) {
          for (const t of data.templates) {
            this.templates.set(t.id, t);
            if (t.shortcut) this.shortcuts.set(t.shortcut, t.id);
          }
          if (data.variables) {
            this.variables = new Map(Object.entries(data.variables));
          }
        } else {
          // Carregar templates padrão
          for (const t of DEFAULT_TEMPLATES) {
            this.templates.set(t.id, t);
            if (t.shortcut) this.shortcuts.set(t.shortcut, t.id);
          }
        }
      } catch (e) {
        console.warn('[SmartTemplates] Load failed:', e);
        for (const t of DEFAULT_TEMPLATES) {
          this.templates.set(t.id, t);
          if (t.shortcut) this.shortcuts.set(t.shortcut, t.id);
        }
      }
    }

    async _saveData() {
      await this._setStorage(CONFIG.STORAGE_KEY, {
        templates: Array.from(this.templates.values()),
        variables: Object.fromEntries(this.variables)
      });
    }

    _getStorage(key) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.get([key], res => r(res[key]));
        else r(null);
      });
    }

    _setStorage(key, value) {
      return new Promise(r => {
        if (typeof chrome !== 'undefined' && chrome.storage)
          chrome.storage.local.set({ [key]: value }, r);
        else r();
      });
    }

    _setupEventListeners() {
      if (window.WHLEventBus) {
        window.WHLEventBus.on('chatOpened', d => this._updateContext(d));
      }
    }

    _setupShortcutListener() {
      document.addEventListener('input', e => {
        const input = e.target;
        if (!input.matches('[data-testid="conversation-compose-box-input"]')) return;
        
        const text = input.textContent || input.innerText;
        this._checkShortcut(text, input);
      });
    }

    _checkShortcut(text, input) {
      for (const [shortcut, templateId] of this.shortcuts) {
        if (text.trim() === shortcut) {
          const template = this.templates.get(templateId);
          if (template) {
            this._applyTemplate(template, input);
          }
        }
      }
    }

    _updateContext(data) {
      if (data?.contactName) {
        this.variables.set('nome', data.contactName);
        this.variables.set('primeiro_nome', data.contactName.split(' ')[0]);
      }
      if (data?.contactId) {
        this.variables.set('contactId', data.contactId);
      }
    }

    _applyTemplate(template, input) {
      const processed = this.processTemplate(template.content);
      
      // Limpar input
      if (input) {
        input.textContent = '';
        input.focus();
        document.execCommand('insertText', false, processed);
      }

      // Atualizar contagem de uso
      template.usageCount = (template.usageCount || 0) + 1;
      this._saveData();

      return processed;
    }

    /**
     * Processa variáveis em um template
     */
    processTemplate(content, customVars = {}) {
      let processed = content;

      // Variáveis de contexto
      const context = {
        nome: this.variables.get('nome') || 'Cliente',
        primeiro_nome: this.variables.get('primeiro_nome') || 'Cliente',
        data: new Date().toLocaleDateString('pt-BR'),
        hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        dia_semana: new Date().toLocaleDateString('pt-BR', { weekday: 'long' }),
        saudacao: this._getGreeting(),
        empresa: this.variables.get('empresa') || 'Empresa',
        ...customVars
      };

      // Substituir variáveis padrão
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.NAME, context.nome);
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.FIRST_NAME, context.primeiro_nome);
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.DATE, context.data);
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.TIME, context.hora);
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.WEEKDAY, context.dia_semana);
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.GREETING, context.saudacao);
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.COMPANY, context.empresa);
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.PRODUCT, context.produto || '');
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.PRICE, context.preco || '');

      // Substituir variáveis customizadas
      processed = processed.replace(CONFIG.VARIABLE_PATTERNS.CUSTOM, (match, varName) => {
        return context[varName] || customVars[varName] || match;
      });

      return processed;
    }

    _getGreeting() {
      const hour = new Date().getHours();
      if (hour < 12) return 'Bom dia';
      if (hour < 18) return 'Boa tarde';
      return 'Boa noite';
    }

    /**
     * Cria novo template
     */
    async createTemplate(config) {
      if (this.templates.size >= CONFIG.MAX_TEMPLATES) {
        throw new Error('Maximum templates reached');
      }

      const id = `template_${Date.now()}`;
      const template = {
        id,
        name: config.name || 'Novo Template',
        category: config.category || 'custom',
        content: config.content || '',
        shortcut: config.shortcut || null,
        usageCount: 0,
        createdAt: Date.now()
      };

      this.templates.set(id, template);
      if (template.shortcut) {
        this.shortcuts.set(template.shortcut, id);
      }

      await this._saveData();
      return template;
    }

    /**
     * Atualiza template
     */
    async updateTemplate(templateId, updates) {
      const template = this.templates.get(templateId);
      if (!template) return null;

      // Remover shortcut antigo
      if (template.shortcut && updates.shortcut !== template.shortcut) {
        this.shortcuts.delete(template.shortcut);
      }

      const updated = { ...template, ...updates, updatedAt: Date.now() };
      this.templates.set(templateId, updated);
      
      if (updated.shortcut) {
        this.shortcuts.set(updated.shortcut, templateId);
      }

      await this._saveData();
      return updated;
    }

    /**
     * Remove template
     */
    async deleteTemplate(templateId) {
      const template = this.templates.get(templateId);
      if (!template) return false;

      if (template.shortcut) {
        this.shortcuts.delete(template.shortcut);
      }
      this.templates.delete(templateId);
      await this._saveData();
      return true;
    }

    /**
     * Define variável global
     */
    setVariable(name, value) {
      this.variables.set(name, value);
      this._saveData();
    }

    /**
     * Lista templates
     */
    listTemplates(category = null) {
      let templates = Array.from(this.templates.values());
      
      if (category) {
        templates = templates.filter(t => t.category === category);
      }

      return templates.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
    }

    /**
     * Busca por shortcut
     */
    getByShortcut(shortcut) {
      const templateId = this.shortcuts.get(shortcut);
      return templateId ? this.templates.get(templateId) : null;
    }

    /**
     * Usa template por ID
     */
    useTemplate(templateId, customVars = {}) {
      const template = this.templates.get(templateId);
      if (!template) return null;

      template.usageCount = (template.usageCount || 0) + 1;
      this._saveData();

      return this.processTemplate(template.content, customVars);
    }

    /**
     * Obtém estatísticas
     */
    getStats() {
      const templates = Array.from(this.templates.values());
      const byCategory = {};
      
      for (const cat of CONFIG.CATEGORIES) {
        byCategory[cat] = templates.filter(t => t.category === cat).length;
      }

      return {
        total: templates.length,
        byCategory,
        totalUsage: templates.reduce((sum, t) => sum + (t.usageCount || 0), 0),
        mostUsed: templates.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0)).slice(0, 5)
      };
    }

    /**
     * Exporta templates
     */
    exportData() {
      return {
        templates: Array.from(this.templates.values()),
        variables: Object.fromEntries(this.variables),
        stats: this.getStats(),
        exportedAt: new Date().toISOString()
      };
    }
  }

  // Inicialização
  const smartTemplates = new SmartTemplates();
  smartTemplates.init();

  window.WHLSmartTemplates = smartTemplates;
  window.WHLTemplateConfig = CONFIG;

  console.log('[FEAT-006] Smart Templates initialized');

})();
