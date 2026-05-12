/**
 * FEAT-003: Proactive Suggestions - Sugestões proativas baseadas em contexto
 * 
 * Benefícios:
 * - IA antecipa necessidades do cliente
 * - Atendente recebe dicas úteis
 * - Aumenta eficiência do atendimento
 * 
 * @version 1.0.0
 * @since 7.9.14
 */

(function() {
  'use strict';

  const CONFIG = {
    STORAGE_KEY: 'whl_proactive_suggestions',
    CHECK_INTERVAL_MS: 5000,
    MAX_SUGGESTIONS: 3,
    DISPLAY_DURATION_MS: 10000,
    
    TRIGGERS: {
      IDLE_TIME_MS: 30000,      // Cliente sem responder
      TYPING_PAUSE_MS: 5000,   // Pausa na digitação
      SENTIMENT_NEGATIVE: -0.3,
      TOPIC_CHANGE: 0.5
    }
  };

  const SUGGESTION_TYPES = {
    FOLLOW_UP: { icon: '💬', priority: 1 },
    UPSELL: { icon: '💰', priority: 2 },
    FAQ: { icon: '❓', priority: 3 },
    EMPATHY: { icon: '🤗', priority: 1 },
    CLOSING: { icon: '✅', priority: 2 },
    ESCALATE: { icon: '🚨', priority: 1 }
  };

  const STYLES = `
    .whl-proactive-container {
      position: fixed;
      bottom: 80px;
      right: 20px;
      width: 300px;
      z-index: 9999;
    }
    .whl-proactive-suggestion {
      background: linear-gradient(135deg, #1F2C34 0%, #2A3942 100%);
      border-radius: 12px;
      padding: 12px 16px;
      margin-bottom: 8px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      border-left: 3px solid #00A884;
      animation: slideIn 0.3s ease;
    }
    @keyframes slideIn {
      from { transform: translateX(100px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    .whl-proactive-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .whl-proactive-icon { font-size: 18px; }
    .whl-proactive-title {
      color: #E9EDEF;
      font-size: 13px;
      font-weight: 600;
    }
    .whl-proactive-text {
      color: #8696A0;
      font-size: 12px;
      line-height: 1.4;
    }
    .whl-proactive-actions {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .whl-proactive-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .whl-proactive-btn.primary {
      background: #00A884;
      color: white;
    }
    .whl-proactive-btn.secondary {
      background: rgba(255,255,255,0.1);
      color: #8696A0;
    }
    .whl-proactive-btn:hover { transform: scale(1.05); }
  `;

  class ProactiveSuggestions {
    constructor() {
      this.activeSuggestions = [];
      this.conversationState = {};
      this.container = null;
      this.checkTimer = null;
      this.initialized = false;
    }

    async init() {
      this._injectStyles();
      this._createContainer();
      this._setupEventListeners();
      this._startMonitoring();
      this.initialized = true;
      console.log('[ProactiveSuggestions] Initialized');
    }

    _injectStyles() {
      if (document.getElementById('whl-proactive-styles')) return;
      const style = document.createElement('style');
      style.id = 'whl-proactive-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    _createContainer() {
      this.container = document.createElement('div');
      this.container.className = 'whl-proactive-container';
      document.body.appendChild(this.container);
    }

    _setupEventListeners() {
      if (window.WHLEventBus) {
        window.WHLEventBus.on('messageReceived', d => this._analyzeMessage(d));
        window.WHLEventBus.on('chatOpened', d => this._resetState(d));
        window.WHLEventBus.on('typingStarted', () => this._onTyping());
      }
    }

    _startMonitoring() {
      this.checkTimer = setInterval(() => this._checkTriggers(), CONFIG.CHECK_INTERVAL_MS);
    }

    _resetState(data) {
      this.conversationState = {
        contactId: data?.contactId,
        lastMessageTime: Date.now(),
        messageCount: 0,
        sentiment: 0,
        topics: [],
        isIdle: false
      };
      this._clearSuggestions();
    }

    _analyzeMessage(data) {
      const { message, isFromContact } = data;
      if (!message) return;

      this.conversationState.lastMessageTime = Date.now();
      this.conversationState.messageCount++;
      this.conversationState.isIdle = false;

      if (isFromContact) {
        this._analyzeSentiment(message);
        this._extractTopics(message);
        this._generateContextualSuggestions(message);
      }
    }

    _analyzeSentiment(message) {
      const negative = /(problema|erro|não funciona|péssimo|horrível|irritado|raiva|decepcionado)/i;
      const positive = /(obrigado|ótimo|excelente|perfeito|adorei|top|maravilhoso)/i;
      
      if (negative.test(message)) this.conversationState.sentiment -= 0.3;
      if (positive.test(message)) this.conversationState.sentiment += 0.3;
      
      this.conversationState.sentiment = Math.max(-1, Math.min(1, this.conversationState.sentiment));
    }

    _extractTopics(message) {
      const topics = {
        pricing: /(preço|valor|quanto|desconto|promoção)/i,
        availability: /(disponível|estoque|entrega|prazo)/i,
        support: /(ajuda|problema|erro|suporte)/i,
        closing: /(obrigado|valeu|até mais|tchau)/i
      };

      for (const [topic, pattern] of Object.entries(topics)) {
        if (pattern.test(message) && !this.conversationState.topics.includes(topic)) {
          this.conversationState.topics.push(topic);
        }
      }
    }

    _generateContextualSuggestions(message) {
      const suggestions = [];

      // Sugestão de empatia para sentimento negativo
      if (this.conversationState.sentiment < CONFIG.TRIGGERS.SENTIMENT_NEGATIVE) {
        suggestions.push({
          type: 'EMPATHY',
          title: 'Cliente frustrado detectado',
          text: 'Considere iniciar com uma mensagem empática antes de resolver o problema.',
          action: 'Sinto muito pelo inconveniente. Vou resolver isso para você agora mesmo.'
        });
      }

      // Sugestões por tópico
      if (this.conversationState.topics.includes('pricing')) {
        suggestions.push({
          type: 'UPSELL',
          title: 'Oportunidade de upsell',
          text: 'Cliente interessado em preços. Apresente pacotes ou promoções.',
          action: null
        });
      }

      if (this.conversationState.topics.includes('closing')) {
        suggestions.push({
          type: 'CLOSING',
          title: 'Momento de fechamento',
          text: 'Cliente parece satisfeito. Confirme se há mais alguma dúvida.',
          action: 'Posso ajudar em mais alguma coisa? 😊'
        });
      }

      this._showSuggestions(suggestions.slice(0, CONFIG.MAX_SUGGESTIONS));
    }

    _checkTriggers() {
      const now = Date.now();
      const idleTime = now - this.conversationState.lastMessageTime;

      // Check idle
      if (idleTime > CONFIG.TRIGGERS.IDLE_TIME_MS && !this.conversationState.isIdle) {
        this.conversationState.isIdle = true;
        this._showSuggestions([{
          type: 'FOLLOW_UP',
          title: 'Cliente sem resposta',
          text: `${Math.round(idleTime / 1000)}s sem resposta. Considere um follow-up.`,
          action: 'Olá! Você ainda está aí? Posso ajudar em mais alguma coisa?'
        }]);
      }
    }

    _onTyping() {
      this.conversationState.isIdle = false;
    }

    _showSuggestions(suggestions) {
      this._clearSuggestions();
      
      for (const suggestion of suggestions) {
        const typeConfig = SUGGESTION_TYPES[suggestion.type];
        
        const el = document.createElement('div');
        el.className = 'whl-proactive-suggestion';
        el.innerHTML = `
          <div class="whl-proactive-header">
            <span class="whl-proactive-icon">${typeConfig.icon}</span>
            <span class="whl-proactive-title">${suggestion.title}</span>
          </div>
          <div class="whl-proactive-text">${suggestion.text}</div>
          ${suggestion.action ? `
            <div class="whl-proactive-actions">
              <button class="whl-proactive-btn primary" data-action="use">Usar sugestão</button>
              <button class="whl-proactive-btn secondary" data-action="dismiss">Ignorar</button>
            </div>
          ` : ''}
        `;

        el.querySelector('[data-action="use"]')?.addEventListener('click', () => {
          this._useSuggestion(suggestion);
          el.remove();
        });

        el.querySelector('[data-action="dismiss"]')?.addEventListener('click', () => {
          el.remove();
        });

        this.container.appendChild(el);
        this.activeSuggestions.push({ element: el, suggestion });

        // Auto-dismiss
        setTimeout(() => {
          if (el.parentNode) el.remove();
        }, CONFIG.DISPLAY_DURATION_MS);
      }
    }

    _useSuggestion(suggestion) {
      if (suggestion.action && window.WHLEventBus) {
        window.WHLEventBus.emit('suggestionUsed', {
          type: suggestion.type,
          text: suggestion.action
        });
      }

      // Tentar inserir no campo de texto
      const input = document.querySelector('[data-testid="conversation-compose-box-input"]');
      if (input && suggestion.action) {
        input.focus();
        document.execCommand('insertText', false, suggestion.action);
      }
    }

    _clearSuggestions() {
      this.container.innerHTML = '';
      this.activeSuggestions = [];
    }

    /**
     * Adiciona sugestão manual
     */
    addSuggestion(config) {
      this._showSuggestions([config]);
    }

    /**
     * Obtém estado atual
     */
    getState() {
      return { ...this.conversationState };
    }

    destroy() {
      if (this.checkTimer) clearInterval(this.checkTimer);
      if (this.container) this.container.remove();
    }
  }

  // Inicialização
  const proactiveSuggestions = new ProactiveSuggestions();
  proactiveSuggestions.init();

  window.WHLProactiveSuggestions = proactiveSuggestions;
  window.WHLProactiveConfig = CONFIG;

  console.log('[FEAT-003] Proactive Suggestions initialized');

})();
