/**
 * 🌍 WhatsHybrid - Sistema de Internacionalização (i18n)
 * Gerenciador completo de traduções para toda a extensão
 * 
 * @version 7.9.13
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_language';
  const DEFAULT_LANGUAGE = 'pt-BR';
  
  /**
   * Idiomas suportados
   */
  const SUPPORTED_LANGUAGES = {
    'pt-BR': {
      name: 'Português (Brasil)',
      nativeName: 'Português (Brasil)',
      flag: '🇧🇷',
      direction: 'ltr'
    },
    'en': {
      name: 'English',
      nativeName: 'English',
      flag: '🇺🇸',
      direction: 'ltr'
    },
    'es': {
      name: 'Spanish',
      nativeName: 'Español',
      flag: '🇪🇸',
      direction: 'ltr'
    },
    'fr': {
      name: 'French',
      nativeName: 'Français',
      flag: '🇫🇷',
      direction: 'ltr'
    },
    'de': {
      name: 'German',
      nativeName: 'Deutsch',
      flag: '🇩🇪',
      direction: 'ltr'
    },
    'it': {
      name: 'Italian',
      nativeName: 'Italiano',
      flag: '🇮🇹',
      direction: 'ltr'
    },
    'zh': {
      name: 'Chinese (Simplified)',
      nativeName: '简体中文',
      flag: '🇨🇳',
      direction: 'ltr'
    },
    'ja': {
      name: 'Japanese',
      nativeName: '日本語',
      flag: '🇯🇵',
      direction: 'ltr'
    },
    'ko': {
      name: 'Korean',
      nativeName: '한국어',
      flag: '🇰🇷',
      direction: 'ltr'
    },
    'ar': {
      name: 'Arabic',
      nativeName: 'العربية',
      flag: '🇸🇦',
      direction: 'rtl'
    },
    'he': {
      name: 'Hebrew',
      nativeName: 'עברית',
      flag: '🇮🇱',
      direction: 'rtl'
    },
    'ru': {
      name: 'Russian',
      nativeName: 'Русский',
      flag: '🇷🇺',
      direction: 'ltr'
    }
  };

  /**
   * Cache de traduções carregadas
   */
  const translationsCache = new Map();

  /**
   * Gerenciador de i18n
   */
  class I18nManager {
    constructor() {
      this.currentLanguage = DEFAULT_LANGUAGE;
      this.translations = {};
      this.fallbackTranslations = {};
      this.initialized = false;
      this.observers = [];
    }

    /**
     * Inicializa o sistema de i18n
     */
    async init() {
      if (this.initialized) return;

      // Carregar idioma salvo
      await this.loadSavedLanguage();
      
      // Carregar traduções do idioma atual
      await this.loadTranslations(this.currentLanguage);
      
      // Carregar fallback (pt-BR)
      if (this.currentLanguage !== DEFAULT_LANGUAGE) {
        await this.loadTranslations(DEFAULT_LANGUAGE, true);
      }

      this.initialized = true;
      console.log(`[i18n] Inicializado: ${this.currentLanguage}`);
      
      // Aplicar traduções na página
      this.translatePage();
    }

    /**
     * Carrega idioma salvo do storage
     */
    async loadSavedLanguage() {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.get([STORAGE_KEY], (result) => {
            if (result[STORAGE_KEY] && SUPPORTED_LANGUAGES[result[STORAGE_KEY]]) {
              this.currentLanguage = result[STORAGE_KEY];
            } else {
              // Detectar idioma do navegador
              const browserLang = navigator.language || navigator.userLanguage;
              if (SUPPORTED_LANGUAGES[browserLang]) {
                this.currentLanguage = browserLang;
              } else {
                const shortLang = browserLang.split('-')[0];
                if (SUPPORTED_LANGUAGES[shortLang]) {
                  this.currentLanguage = shortLang;
                }
              }
            }
            resolve();
          });
        } else {
          // Fallback para localStorage
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved && SUPPORTED_LANGUAGES[saved]) {
            this.currentLanguage = saved;
          }
          resolve();
        }
      });
    }

    /**
     * Carrega traduções de um idioma
     */
    async loadTranslations(language, isFallback = false) {
      // Verificar cache
      if (translationsCache.has(language)) {
        if (isFallback) {
          this.fallbackTranslations = translationsCache.get(language);
        } else {
          this.translations = translationsCache.get(language);
        }
        return;
      }

      try {
        // Tentar carregar do arquivo
        const url = chrome.runtime?.getURL 
          ? chrome.runtime.getURL(`i18n/locales/${language}.json`)
          : `i18n/locales/${language}.json`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        translationsCache.set(language, data);
        
        if (isFallback) {
          this.fallbackTranslations = data;
        } else {
          this.translations = data;
        }
      } catch (error) {
        console.warn(`[i18n] Não foi possível carregar ${language}:`, error.message);
        
        // Usar traduções embutidas como fallback
        const embedded = this.getEmbeddedTranslations(language);
        if (embedded) {
          translationsCache.set(language, embedded);
          if (isFallback) {
            this.fallbackTranslations = embedded;
          } else {
            this.translations = embedded;
          }
        }
      }
    }

    /**
     * Obtém traduções embutidas (fallback)
     */
    getEmbeddedTranslations(language) {
      // Traduções essenciais embutidas
      const embedded = {
        'pt-BR': TRANSLATIONS_PT_BR,
        'en': TRANSLATIONS_EN,
        'es': TRANSLATIONS_ES
      };
      return embedded[language] || null;
    }

    /**
     * Traduz uma chave
     */
    t(key, params = {}) {
      // Buscar no idioma atual
      let text = this.getNestedValue(this.translations, key);
      
      // Fallback para pt-BR
      if (!text && this.currentLanguage !== DEFAULT_LANGUAGE) {
        text = this.getNestedValue(this.fallbackTranslations, key);
      }
      
      // Se não encontrou, retorna a própria chave
      if (!text) {
        console.warn(`[i18n] Tradução não encontrada: ${key}`);
        return key;
      }

      // Interpolação de variáveis
      return this.interpolate(text, params);
    }

    /**
     * Alias para t()
     */
    translate(key, params) {
      return this.t(key, params);
    }

    /**
     * Acessa valor aninhado em objeto
     */
    getNestedValue(obj, path) {
      return path.split('.').reduce((current, key) => 
        current && current[key] !== undefined ? current[key] : null, obj);
    }

    /**
     * Interpola variáveis no texto
     */
    interpolate(text, params) {
      if (!params || Object.keys(params).length === 0) return text;
      
      return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return params[key] !== undefined ? params[key] : match;
      });
    }

    /**
     * Muda o idioma atual
     */
    async setLanguage(language) {
      if (!SUPPORTED_LANGUAGES[language]) {
        console.error(`[i18n] Idioma não suportado: ${language}`);
        return false;
      }

      if (language === this.currentLanguage) return true;

      this.currentLanguage = language;

      // Salvar preferência
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ [STORAGE_KEY]: language });
      } else {
        localStorage.setItem(STORAGE_KEY, language);
      }

      // Carregar novas traduções
      await this.loadTranslations(language);

      // Aplicar direção do texto
      this.applyTextDirection();

      // Notificar observers
      this.notifyObservers();

      // Re-traduzir página
      this.translatePage();

      console.log(`[i18n] Idioma alterado para: ${language}`);
      return true;
    }

    /**
     * Obtém idioma atual
     */
    getLanguage() {
      return this.currentLanguage;
    }

    /**
     * Obtém info do idioma atual
     */
    getLanguageInfo() {
      return SUPPORTED_LANGUAGES[this.currentLanguage];
    }

    /**
     * Obtém lista de idiomas disponíveis
     */
    getAvailableLanguages() {
      return Object.entries(SUPPORTED_LANGUAGES).map(([code, info]) => ({
        code,
        ...info,
        current: code === this.currentLanguage
      }));
    }

    /**
     * Aplica direção do texto (LTR/RTL)
     */
    applyTextDirection() {
      const info = SUPPORTED_LANGUAGES[this.currentLanguage];
      if (info) {
        document.documentElement.dir = info.direction;
        document.documentElement.lang = this.currentLanguage;
      }
    }

    /**
     * Traduz elementos da página
     */
    translatePage() {
      // Traduzir elementos com data-i18n
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const params = this.parseDataParams(el);
        el.textContent = this.t(key, params);
      });

      // Traduzir placeholders
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = this.t(key);
      });

      // Traduzir títulos (tooltips)
      document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = this.t(key);
      });

      // Traduzir atributos aria-label
      document.querySelectorAll('[data-i18n-aria]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria');
        el.setAttribute('aria-label', this.t(key));
      });

      // Traduzir innerHTML (para HTML)
      document.querySelectorAll('[data-i18n-html]').forEach(el => {
        const key = el.getAttribute('data-i18n-html');
        el.innerHTML = this.t(key);
      });
    }

    /**
     * Parse parâmetros de data attributes
     */
    parseDataParams(el) {
      const params = {};
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith('data-i18n-param-')) {
          const paramName = attr.name.replace('data-i18n-param-', '');
          params[paramName] = attr.value;
        }
      });
      return params;
    }

    /**
     * Adiciona observer para mudanças de idioma
     */
    onLanguageChange(callback) {
      this.observers.push(callback);
      return () => {
        this.observers = this.observers.filter(cb => cb !== callback);
      };
    }

    /**
     * Notifica observers
     */
    notifyObservers() {
      const info = {
        language: this.currentLanguage,
        ...SUPPORTED_LANGUAGES[this.currentLanguage]
      };
      this.observers.forEach(cb => {
        try { cb(info); } catch (e) { console.error('[i18n] Observer error:', e); }
      });
    }

    /**
     * Formata data no idioma atual
     */
    formatDate(date, options = {}) {
      const d = date instanceof Date ? date : new Date(date);
      return new Intl.DateTimeFormat(this.currentLanguage, {
        dateStyle: options.dateStyle || 'medium',
        timeStyle: options.timeStyle,
        ...options
      }).format(d);
    }

    /**
     * Formata número no idioma atual
     */
    formatNumber(number, options = {}) {
      return new Intl.NumberFormat(this.currentLanguage, options).format(number);
    }

    /**
     * Formata moeda no idioma atual
     */
    formatCurrency(amount, currency = 'BRL') {
      return new Intl.NumberFormat(this.currentLanguage, {
        style: 'currency',
        currency
      }).format(amount);
    }

    /**
     * Formata tempo relativo
     */
    formatRelativeTime(date) {
      const d = date instanceof Date ? date : new Date(date);
      const now = new Date();
      const diff = now - d;
      
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      const rtf = new Intl.RelativeTimeFormat(this.currentLanguage, { numeric: 'auto' });

      if (days > 0) return rtf.format(-days, 'day');
      if (hours > 0) return rtf.format(-hours, 'hour');
      if (minutes > 0) return rtf.format(-minutes, 'minute');
      return rtf.format(-seconds, 'second');
    }

    /**
     * Pluralização
     */
    plural(count, options) {
      const rules = new Intl.PluralRules(this.currentLanguage);
      const category = rules.select(count);
      
      // options: { zero, one, two, few, many, other }
      return options[category] || options.other || String(count);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRADUÇÕES EMBUTIDAS
  // ═══════════════════════════════════════════════════════════════════════════

  const TRANSLATIONS_PT_BR = {
    common: {
      save: 'Salvar',
      cancel: 'Cancelar',
      delete: 'Excluir',
      edit: 'Editar',
      close: 'Fechar',
      confirm: 'Confirmar',
      search: 'Buscar',
      loading: 'Carregando...',
      error: 'Erro',
      success: 'Sucesso',
      warning: 'Atenção',
      info: 'Informação',
      yes: 'Sim',
      no: 'Não',
      ok: 'OK',
      back: 'Voltar',
      next: 'Próximo',
      previous: 'Anterior',
      refresh: 'Atualizar',
      settings: 'Configurações',
      help: 'Ajuda',
      about: 'Sobre',
      version: 'Versão',
      language: 'Idioma',
      export: 'Exportar',
      import: 'Importar'
    },
    
    nav: {
      home: 'Início',
      chat: 'Chat',
      contacts: 'Contatos',
      crm: 'CRM',
      tasks: 'Tarefas',
      training: 'Treinamento',
      analytics: 'Análises',
      settings: 'Configurações',
      team: 'Equipe'
    },
    
    ai: {
      title: 'Sugestão de IA',
      generating: 'Gerando sugestão...',
      suggestion: 'Sugestão',
      use: 'Usar Sugestão',
      regenerate: 'Gerar Novamente',
      confidence: 'Confiança',
      noProvider: 'Nenhum provedor de IA configurado',
      error: 'Erro ao gerar sugestão',
      retry: 'Tentar Novamente',
      useFallback: 'Usar Sugestão Básica',
      networkError: 'Falha de conexão com a IA. Verifique sua internet.',
      configureFirst: 'Configure um provedor de IA primeiro'
    },
    
    autopilot: {
      title: 'Copiloto Automático',
      status: 'Status',
      running: 'Rodando',
      paused: 'Pausado',
      stopped: 'Parado',
      start: 'Iniciar',
      pause: 'Pausar',
      resume: 'Retomar',
      stop: 'Parar',
      queue: 'Fila',
      messages: 'Mensagens',
      sent: 'Enviadas',
      failed: 'Falharam',
      skipped: 'Puladas',
      blacklist: 'Lista de Exclusão',
      addToBlacklist: 'Adicionar à Lista de Exclusão',
      removeFromBlacklist: 'Remover da Lista de Exclusão',
      workingHours: 'Horário de Trabalho',
      minConfidence: 'Confiança Mínima',
      delay: 'Intervalo entre Mensagens'
    },
    
    crm: {
      title: 'CRM',
      contacts: 'Contatos',
      newContact: 'Novo Contato',
      editContact: 'Editar Contato',
      deleteContact: 'Excluir Contato',
      name: 'Nome',
      phone: 'Telefone',
      email: 'Email',
      company: 'Empresa',
      notes: 'Notas',
      tags: 'Tags',
      lastContact: 'Último Contato',
      deals: 'Negócios',
      stage: 'Etapa',
      value: 'Valor',
      priority: 'Prioridade',
      high: 'Alta',
      medium: 'Média',
      low: 'Baixa',
      noContacts: 'Nenhum contato encontrado',
      importContacts: 'Importar Contatos',
      exportContacts: 'Exportar Contatos'
    },
    
    tasks: {
      title: 'Tarefas',
      newTask: 'Nova Tarefa',
      editTask: 'Editar Tarefa',
      deleteTask: 'Excluir Tarefa',
      description: 'Descrição',
      dueDate: 'Data de Vencimento',
      assignee: 'Responsável',
      status: 'Status',
      todo: 'A Fazer',
      inProgress: 'Em Andamento',
      done: 'Concluído',
      overdue: 'Atrasada',
      noTasks: 'Nenhuma tarefa encontrada'
    },
    
    training: {
      title: 'Treinamento',
      knowledgeBase: 'Base de Conhecimento',
      faqs: 'Perguntas Frequentes',
      products: 'Produtos',
      policies: 'Políticas',
      addFaq: 'Adicionar FAQ',
      editFaq: 'Editar FAQ',
      question: 'Pergunta',
      answer: 'Resposta',
      category: 'Categoria',
      addProduct: 'Adicionar Produto',
      productName: 'Nome do Produto',
      productDescription: 'Descrição',
      price: 'Preço',
      fewShot: 'Exemplos de Resposta',
      addExample: 'Adicionar Exemplo',
      userMessage: 'Mensagem do Usuário',
      assistantResponse: 'Resposta do Assistente',
      syncWithBackend: 'Sincronizar com Servidor',
      lastSync: 'Última Sincronização'
    },
    
    analytics: {
      title: 'Análises',
      overview: 'Visão Geral',
      messages: 'Mensagens',
      conversations: 'Conversas',
      responseTime: 'Tempo de Resposta',
      satisfaction: 'Satisfação',
      topContacts: 'Principais Contatos',
      period: 'Período',
      today: 'Hoje',
      week: 'Esta Semana',
      month: 'Este Mês',
      year: 'Este Ano',
      custom: 'Personalizado'
    },
    
    settings: {
      title: 'Configurações',
      general: 'Geral',
      appearance: 'Aparência',
      theme: 'Tema',
      themeLight: 'Claro',
      themeDark: 'Escuro',
      themeAuto: 'Automático',
      language: 'Idioma',
      notifications: 'Notificações',
      sound: 'Som',
      desktop: 'Desktop',
      ai: 'Inteligência Artificial',
      provider: 'Provedor',
      apiKey: 'Chave de API',
      model: 'Modelo',
      temperature: 'Temperatura',
      backup: 'Backup',
      createBackup: 'Criar Backup',
      restoreBackup: 'Restaurar Backup',
      account: 'Conta',
      logout: 'Sair',
      subscription: 'Assinatura',
      plan: 'Plano',
      upgrade: 'Fazer Upgrade'
    },
    
    team: {
      title: 'Equipe',
      members: 'Membros',
      addMember: 'Adicionar Membro',
      removeMember: 'Remover Membro',
      role: 'Função',
      admin: 'Administrador',
      agent: 'Agente',
      viewer: 'Visualizador',
      persona: 'Persona',
      assignPersona: 'Atribuir Persona'
    },
    
    recover: {
      title: 'Recuperar Mensagens',
      deleted: 'Mensagens Apagadas',
      noDeleted: 'Nenhuma mensagem apagada detectada',
      recover: 'Recuperar',
      viewChat: 'Ver no Chat',
      downloadMedia: 'Baixar Mídia',
      time: 'Horário',
      content: 'Conteúdo',
      type: 'Tipo',
      text: 'Texto',
      image: 'Imagem',
      video: 'Vídeo',
      audio: 'Áudio',
      document: 'Documento',
      sticker: 'Figurinha'
    },
    
    errors: {
      networkError: 'Erro de conexão. Verifique sua internet.',
      serverError: 'Erro no servidor. Tente novamente mais tarde.',
      authError: 'Erro de autenticação. Faça login novamente.',
      validationError: 'Dados inválidos. Verifique os campos.',
      notFound: 'Não encontrado.',
      rateLimitError: 'Muitas requisições. Aguarde um momento.',
      unknownError: 'Ocorreu um erro inesperado.'
    },
    
    messages: {
      saved: 'Salvo com sucesso!',
      deleted: 'Excluído com sucesso!',
      updated: 'Atualizado com sucesso!',
      copied: 'Copiado para a área de transferência!',
      sent: 'Enviado com sucesso!',
      confirmDelete: 'Tem certeza que deseja excluir?',
      unsavedChanges: 'Você tem alterações não salvas. Deseja sair mesmo assim?'
    }
  };

  const TRANSLATIONS_EN = {
    common: {
      save: 'Save',
      cancel: 'Cancel',
      delete: 'Delete',
      edit: 'Edit',
      close: 'Close',
      confirm: 'Confirm',
      search: 'Search',
      loading: 'Loading...',
      error: 'Error',
      success: 'Success',
      warning: 'Warning',
      info: 'Information',
      yes: 'Yes',
      no: 'No',
      ok: 'OK',
      back: 'Back',
      next: 'Next',
      previous: 'Previous',
      refresh: 'Refresh',
      settings: 'Settings',
      help: 'Help',
      about: 'About',
      version: 'Version',
      language: 'Language',
      export: 'Export',
      import: 'Import'
    },
    
    nav: {
      home: 'Home',
      chat: 'Chat',
      contacts: 'Contacts',
      crm: 'CRM',
      tasks: 'Tasks',
      training: 'Training',
      analytics: 'Analytics',
      settings: 'Settings',
      team: 'Team'
    },
    
    ai: {
      title: 'AI Suggestion',
      generating: 'Generating suggestion...',
      suggestion: 'Suggestion',
      use: 'Use Suggestion',
      regenerate: 'Regenerate',
      confidence: 'Confidence',
      noProvider: 'No AI provider configured',
      error: 'Error generating suggestion',
      retry: 'Try Again',
      useFallback: 'Use Basic Suggestion',
      networkError: 'Connection failed. Check your internet.',
      configureFirst: 'Configure an AI provider first'
    },
    
    autopilot: {
      title: 'Auto Copilot',
      status: 'Status',
      running: 'Running',
      paused: 'Paused',
      stopped: 'Stopped',
      start: 'Start',
      pause: 'Pause',
      resume: 'Resume',
      stop: 'Stop',
      queue: 'Queue',
      messages: 'Messages',
      sent: 'Sent',
      failed: 'Failed',
      skipped: 'Skipped',
      blacklist: 'Exclusion List',
      addToBlacklist: 'Add to Exclusion List',
      removeFromBlacklist: 'Remove from Exclusion List',
      workingHours: 'Working Hours',
      minConfidence: 'Minimum Confidence',
      delay: 'Message Interval'
    },
    
    crm: {
      title: 'CRM',
      contacts: 'Contacts',
      newContact: 'New Contact',
      editContact: 'Edit Contact',
      deleteContact: 'Delete Contact',
      name: 'Name',
      phone: 'Phone',
      email: 'Email',
      company: 'Company',
      notes: 'Notes',
      tags: 'Tags',
      lastContact: 'Last Contact',
      deals: 'Deals',
      stage: 'Stage',
      value: 'Value',
      priority: 'Priority',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      noContacts: 'No contacts found',
      importContacts: 'Import Contacts',
      exportContacts: 'Export Contacts'
    },
    
    tasks: {
      title: 'Tasks',
      newTask: 'New Task',
      editTask: 'Edit Task',
      deleteTask: 'Delete Task',
      description: 'Description',
      dueDate: 'Due Date',
      assignee: 'Assignee',
      status: 'Status',
      todo: 'To Do',
      inProgress: 'In Progress',
      done: 'Done',
      overdue: 'Overdue',
      noTasks: 'No tasks found'
    },
    
    training: {
      title: 'Training',
      knowledgeBase: 'Knowledge Base',
      faqs: 'FAQs',
      products: 'Products',
      policies: 'Policies',
      addFaq: 'Add FAQ',
      editFaq: 'Edit FAQ',
      question: 'Question',
      answer: 'Answer',
      category: 'Category',
      addProduct: 'Add Product',
      productName: 'Product Name',
      productDescription: 'Description',
      price: 'Price',
      fewShot: 'Response Examples',
      addExample: 'Add Example',
      userMessage: 'User Message',
      assistantResponse: 'Assistant Response',
      syncWithBackend: 'Sync with Server',
      lastSync: 'Last Sync'
    },
    
    analytics: {
      title: 'Analytics',
      overview: 'Overview',
      messages: 'Messages',
      conversations: 'Conversations',
      responseTime: 'Response Time',
      satisfaction: 'Satisfaction',
      topContacts: 'Top Contacts',
      period: 'Period',
      today: 'Today',
      week: 'This Week',
      month: 'This Month',
      year: 'This Year',
      custom: 'Custom'
    },
    
    settings: {
      title: 'Settings',
      general: 'General',
      appearance: 'Appearance',
      theme: 'Theme',
      themeLight: 'Light',
      themeDark: 'Dark',
      themeAuto: 'Auto',
      language: 'Language',
      notifications: 'Notifications',
      sound: 'Sound',
      desktop: 'Desktop',
      ai: 'Artificial Intelligence',
      provider: 'Provider',
      apiKey: 'API Key',
      model: 'Model',
      temperature: 'Temperature',
      backup: 'Backup',
      createBackup: 'Create Backup',
      restoreBackup: 'Restore Backup',
      account: 'Account',
      logout: 'Logout',
      subscription: 'Subscription',
      plan: 'Plan',
      upgrade: 'Upgrade'
    },
    
    team: {
      title: 'Team',
      members: 'Members',
      addMember: 'Add Member',
      removeMember: 'Remove Member',
      role: 'Role',
      admin: 'Admin',
      agent: 'Agent',
      viewer: 'Viewer',
      persona: 'Persona',
      assignPersona: 'Assign Persona'
    },
    
    recover: {
      title: 'Recover Messages',
      deleted: 'Deleted Messages',
      noDeleted: 'No deleted messages detected',
      recover: 'Recover',
      viewChat: 'View in Chat',
      downloadMedia: 'Download Media',
      time: 'Time',
      content: 'Content',
      type: 'Type',
      text: 'Text',
      image: 'Image',
      video: 'Video',
      audio: 'Audio',
      document: 'Document',
      sticker: 'Sticker'
    },
    
    errors: {
      networkError: 'Connection error. Check your internet.',
      serverError: 'Server error. Try again later.',
      authError: 'Authentication error. Please log in again.',
      validationError: 'Invalid data. Check the fields.',
      notFound: 'Not found.',
      rateLimitError: 'Too many requests. Please wait.',
      unknownError: 'An unexpected error occurred.'
    },
    
    messages: {
      saved: 'Saved successfully!',
      deleted: 'Deleted successfully!',
      updated: 'Updated successfully!',
      copied: 'Copied to clipboard!',
      sent: 'Sent successfully!',
      confirmDelete: 'Are you sure you want to delete?',
      unsavedChanges: 'You have unsaved changes. Do you want to leave anyway?'
    }
  };

  const TRANSLATIONS_ES = {
    common: {
      save: 'Guardar',
      cancel: 'Cancelar',
      delete: 'Eliminar',
      edit: 'Editar',
      close: 'Cerrar',
      confirm: 'Confirmar',
      search: 'Buscar',
      loading: 'Cargando...',
      error: 'Error',
      success: 'Éxito',
      warning: 'Atención',
      info: 'Información',
      yes: 'Sí',
      no: 'No',
      ok: 'OK',
      back: 'Volver',
      next: 'Siguiente',
      previous: 'Anterior',
      refresh: 'Actualizar',
      settings: 'Configuración',
      help: 'Ayuda',
      about: 'Acerca de',
      version: 'Versión',
      language: 'Idioma',
      export: 'Exportar',
      import: 'Importar'
    },
    
    nav: {
      home: 'Inicio',
      chat: 'Chat',
      contacts: 'Contactos',
      crm: 'CRM',
      tasks: 'Tareas',
      training: 'Entrenamiento',
      analytics: 'Análisis',
      settings: 'Configuración',
      team: 'Equipo'
    },
    
    ai: {
      title: 'Sugerencia de IA',
      generating: 'Generando sugerencia...',
      suggestion: 'Sugerencia',
      use: 'Usar Sugerencia',
      regenerate: 'Regenerar',
      confidence: 'Confianza',
      noProvider: 'No hay proveedor de IA configurado',
      error: 'Error al generar sugerencia',
      retry: 'Intentar de Nuevo',
      useFallback: 'Usar Sugerencia Básica',
      networkError: 'Fallo de conexión. Verifica tu internet.',
      configureFirst: 'Configura un proveedor de IA primero'
    },
    
    autopilot: {
      title: 'Copiloto Automático',
      status: 'Estado',
      running: 'Ejecutando',
      paused: 'Pausado',
      stopped: 'Detenido',
      start: 'Iniciar',
      pause: 'Pausar',
      resume: 'Reanudar',
      stop: 'Detener',
      queue: 'Cola',
      messages: 'Mensajes',
      sent: 'Enviados',
      failed: 'Fallados',
      skipped: 'Omitidos',
      blacklist: 'Lista de Exclusión',
      addToBlacklist: 'Agregar a Lista de Exclusión',
      removeFromBlacklist: 'Quitar de Lista de Exclusión',
      workingHours: 'Horario de Trabajo',
      minConfidence: 'Confianza Mínima',
      delay: 'Intervalo entre Mensajes'
    },
    
    crm: {
      title: 'CRM',
      contacts: 'Contactos',
      newContact: 'Nuevo Contacto',
      editContact: 'Editar Contacto',
      deleteContact: 'Eliminar Contacto',
      name: 'Nombre',
      phone: 'Teléfono',
      email: 'Email',
      company: 'Empresa',
      notes: 'Notas',
      tags: 'Etiquetas',
      lastContact: 'Último Contacto',
      deals: 'Negocios',
      stage: 'Etapa',
      value: 'Valor',
      priority: 'Prioridad',
      high: 'Alta',
      medium: 'Media',
      low: 'Baja',
      noContacts: 'No se encontraron contactos',
      importContacts: 'Importar Contactos',
      exportContacts: 'Exportar Contactos'
    },
    
    settings: {
      title: 'Configuración',
      general: 'General',
      appearance: 'Apariencia',
      theme: 'Tema',
      themeLight: 'Claro',
      themeDark: 'Oscuro',
      themeAuto: 'Automático',
      language: 'Idioma',
      notifications: 'Notificaciones',
      sound: 'Sonido',
      desktop: 'Escritorio',
      ai: 'Inteligencia Artificial',
      provider: 'Proveedor',
      apiKey: 'Clave de API',
      model: 'Modelo',
      temperature: 'Temperatura',
      backup: 'Respaldo',
      createBackup: 'Crear Respaldo',
      restoreBackup: 'Restaurar Respaldo',
      account: 'Cuenta',
      logout: 'Cerrar Sesión',
      subscription: 'Suscripción',
      plan: 'Plan',
      upgrade: 'Mejorar Plan'
    },
    
    errors: {
      networkError: 'Error de conexión. Verifica tu internet.',
      serverError: 'Error del servidor. Intenta más tarde.',
      authError: 'Error de autenticación. Inicia sesión de nuevo.',
      validationError: 'Datos inválidos. Verifica los campos.',
      notFound: 'No encontrado.',
      rateLimitError: 'Demasiadas solicitudes. Por favor espera.',
      unknownError: 'Ocurrió un error inesperado.'
    },
    
    messages: {
      saved: '¡Guardado con éxito!',
      deleted: '¡Eliminado con éxito!',
      updated: '¡Actualizado con éxito!',
      copied: '¡Copiado al portapapeles!',
      sent: '¡Enviado con éxito!',
      confirmDelete: '¿Estás seguro de que deseas eliminar?',
      unsavedChanges: 'Tienes cambios sin guardar. ¿Deseas salir de todos modos?'
    }
  };

  // Criar instância singleton
  const i18n = new I18nManager();

  // Expor globalmente
  window.WHLi18n = i18n;
  window.t = (key, params) => i18n.t(key, params);
  window.__ = (key, params) => i18n.t(key, params); // Alias

  // Auto-init quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => i18n.init());
  } else {
    i18n.init();
  }
})();
