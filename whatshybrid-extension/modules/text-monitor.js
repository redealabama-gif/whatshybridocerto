/**
 * 📊 Text Monitor - Análise de Sentimento, Intenção e Urgência
 * Axion v7.6.0
 * 
 * Funcionalidades:
 * - Análise de sentimento (positivo/negativo/neutro)
 * - Detecção de intenção (saudação, despedida, dúvida, etc.)
 * - Análise de urgência (score 0-100)
 * - Monitoramento de mensagens em tempo real
 * - Auto-resposta baseada em padrões
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Keywords para análise de sentimento
  const POSITIVE_KEYWORDS = [
    'bom', 'bem', 'ótimo', 'excelente', 'obrigado', 'grato', 'feliz', 'perfeito',
    'maravilhoso', 'fantástico', 'incrível', 'adorei', 'amei', 'legal', 'show',
    'massa', 'bacana', 'top', 'sucesso', 'parabéns', 'satisfeito', 'contente',
    '👍', '😊', '❤️', '🙏', '😄', '🎉', '✨', '💯', '🤩', '😍'
  ];

  const NEGATIVE_KEYWORDS = [
    'ruim', 'mal', 'péssimo', 'problema', 'erro', 'não', 'insatisfeito', 'chateado',
    'decepcionado', 'horrível', 'terrível', 'pior', 'frustrado', 'cancelar',
    'reclamar', 'reclamação', 'demora', 'lento', 'nunca', 'difícil', 'complicado',
    '👎', '😠', '😡', '😤', '😔', '😢', '😞', '💔', '😣', '😖'
  ];

  const URGENT_KEYWORDS = [
    'urgente', 'emergência', 'agora', 'imediato', 'já', 'rápido', 'socorro',
    'ajuda', 'pressa', 'crítico', 'grave', 'importante', 'prioritário', 'asap',
    '🚨', '⚠️', '❗', '‼️', '🆘'
  ];

  // Padrões de intenção
  const INTENT_PATTERNS = {
    greeting: [
      /^(oi|olá|ola|hey|e aí|eai|bom dia|boa tarde|boa noite|salve)/i,
      /^(tudo bem|como vai|blz|beleza)/i
    ],
    farewell: [
      /^(tchau|adeus|até logo|até mais|falou|flw|abraço|até)/i,
      /^(obrigado e tchau|valeu e tchau)/i
    ],
    thanks: [
      /(obrigad[oa]|agradeço|grato|valeu|vlw|tmj)/i,
      /muito (obrigad[oa]|grato)/i
    ],
    question: [
      /^(como|quando|onde|por que|porque|quanto|qual|quem|o que|pode|consigo)/i,
      /\?$/,
      /(me ajud|me diz|me fal|pode me|consegue)/i
    ],
    request: [
      /(quero|preciso|gostaria|poderia|pode|consegue)/i,
      /(enviar|mandar|passar|informar|confirmar)/i
    ],
    confirmation: [
      /^(sim|s|yes|ok|pode ser|confirmo|correto|exato)/i,
      /^(tá bom|está bem|combinado|fechado)/i
    ],
    negation: [
      /^(não|n|nao|negativo|nem|nunca|jamais)/i
    ],
    price: [
      /(quanto custa|qual o valor|qual o preço|preço|valor|custo)/i,
      /(r\$|real|reais|dinheiro|pagar|pagamento)/i
    ],
    complaint: [
      /(reclamar|reclamação|problema|erro|defeito|bug|não funciona|parou)/i,
      /(insatisfeito|chateado|decepcionado|ruim|péssimo)/i
    ],
    product_info: [
      /(produto|item|artigo|mercadoria|estoque|disponível|tem)/i,
      /(detalhes|informações|especificações|características)/i
    ]
  };

  class WhatsAppTextMonitor {
    constructor() {
      this.isMonitoring = false;
      this.monitorInterval = null;
      this.lastProcessedMessage = null;
      this.autoResponsePatterns = [];
      this.messageHistory = new Map();
      this.options = {
        interval: 2000,
        detectTyping: true,
        trackMessageStatus: true
      };
    }

    /**
     * Analisa o sentimento de um texto
     * @param {string} text - Texto para análise
     * @returns {Object} - { sentiment, score, positiveWords, negativeWords }
     */
    analyzeSentiment(text) {
      if (!text) {
        return { sentiment: 'neutral', score: 0, positiveWords: [], negativeWords: [] };
      }

      const lowerText = text.toLowerCase();
      const positiveWords = [];
      const negativeWords = [];

      // Conta palavras positivas
      POSITIVE_KEYWORDS.forEach(keyword => {
        if (lowerText.includes(keyword.toLowerCase())) {
          positiveWords.push(keyword);
        }
      });

      // Conta palavras negativas
      NEGATIVE_KEYWORDS.forEach(keyword => {
        if (lowerText.includes(keyword.toLowerCase())) {
          negativeWords.push(keyword);
        }
      });

      // Calcula score (-100 a +100)
      const positiveCount = positiveWords.length;
      const negativeCount = negativeWords.length;
      const totalWords = text.split(/\s+/).length;
      
      let score = ((positiveCount - negativeCount) / Math.max(totalWords, 1)) * 100;
      score = Math.max(-100, Math.min(100, score));

      // Determina sentimento
      let sentiment = 'neutral';
      if (score > 10) sentiment = 'positive';
      else if (score < -10) sentiment = 'negative';

      return {
        sentiment,
        score: Math.round(score),
        positiveWords,
        negativeWords
      };
    }

    /**
     * Detecta a intenção de uma mensagem
     * @param {string} text - Texto para análise
     * @returns {Object} - { primaryIntent, allIntents, confidence }
     */
    detectIntent(text) {
      if (!text) {
        return { primaryIntent: 'unknown', allIntents: [], confidence: 0 };
      }

      const detectedIntents = [];

      // Testa cada padrão de intenção
      Object.entries(INTENT_PATTERNS).forEach(([intent, patterns]) => {
        let matches = 0;
        patterns.forEach(pattern => {
          if (pattern.test(text)) {
            matches++;
          }
        });
        if (matches > 0) {
          detectedIntents.push({ intent, matches });
        }
      });

      // Ordena por número de matches
      detectedIntents.sort((a, b) => b.matches - a.matches);

      const primaryIntent = detectedIntents.length > 0 
        ? detectedIntents[0].intent 
        : 'unknown';
      
      const allIntents = detectedIntents.map(d => d.intent);
      const confidence = detectedIntents.length > 0 
        ? Math.min(detectedIntents[0].matches * 30, 100) 
        : 0;

      return {
        primaryIntent,
        allIntents,
        confidence
      };
    }

    /**
     * Analisa urgência de uma mensagem
     * @param {string} text - Texto para análise
     * @param {Object} sentiment - Resultado da análise de sentimento
     * @param {Object} intent - Resultado da detecção de intenção
     * @returns {number} - Score de urgência (0-100)
     */
    analyzeUrgency(text, sentiment = null, intent = null) {
      if (!text) return 0;

      let urgencyScore = 0;
      const lowerText = text.toLowerCase();

      // Keywords urgentes
      URGENT_KEYWORDS.forEach(keyword => {
        if (lowerText.includes(keyword.toLowerCase())) {
          urgencyScore += 20;
        }
      });

      // Múltiplos pontos de exclamação
      const exclamationCount = (text.match(/!/g) || []).length;
      urgencyScore += Math.min(exclamationCount * 10, 30);

      // Caps lock (mais de 50% maiúsculas)
      const upperCount = (text.match(/[A-Z]/g) || []).length;
      const letterCount = (text.match(/[a-zA-Z]/g) || []).length;
      if (letterCount > 5 && upperCount / letterCount > 0.5) {
        urgencyScore += 20;
      }

      // Sentimento negativo aumenta urgência
      if (sentiment && sentiment.sentiment === 'negative') {
        urgencyScore += 15;
      }

      // Reclamação aumenta urgência
      if (intent && intent.allIntents.includes('complaint')) {
        urgencyScore += 15;
      }

      // Múltiplas perguntas
      const questionCount = (text.match(/\?/g) || []).length;
      if (questionCount > 1) {
        urgencyScore += 10;
      }

      return Math.min(urgencyScore, 100);
    }

    /**
     * Detecta se mensagem é saudação simples
     * @param {string} text - Texto
     * @returns {boolean}
     */
    isSimpleGreeting(text) {
      const greetings = [
        'oi', 'olá', 'ola', 'oie', 'oii', 'oiii',
        'bom dia', 'boa tarde', 'boa noite',
        'eae', 'eai', 'fala', 'salve',
        'hey', 'hi', 'hello',
        'opa', 'opaa', 'e aí', 'e ai',
        'blz', 'beleza', 'td bem', 'tudo bem'
      ];
      
      const normalized = (text || '').toLowerCase().trim();
      
      // Match exato ou começa com saudação + separador
      return greetings.some(g => {
        if (normalized === g) return true;
        if (normalized.startsWith(g)) {
          const nextChar = normalized.charAt(g.length);
          return /[\s,!?.]/.test(nextChar);
        }
        return false;
      });
    }

    /**
     * Análise completa de mensagem
     * @param {string} text - Texto para análise
     * @returns {Object} - Análise completa
     */
    analyzeMessage(text) {
      const sentiment = this.analyzeSentiment(text);
      const intent = this.detectIntent(text);
      const urgency = this.analyzeUrgency(text, sentiment, intent);

      return {
        text,
        sentiment,
        intent,
        urgency,
        timestamp: Date.now()
      };
    }

    /**
     * Inicia monitoramento de mensagens
     * @param {Object} options - Opções de monitoramento
     */
    start(options = {}) {
      if (this.isMonitoring) {
        console.log('[TextMonitor] Já está monitorando');
        return;
      }

      this.options = { ...this.options, ...options };
      this.isMonitoring = true;

      console.log('[TextMonitor] Iniciando monitoramento...', this.options);

      this.monitorInterval = setInterval(() => {
        this.check();
      }, this.options.interval);

      // Emite evento de início
      if (window.EventBus) {
        window.EventBus.emit('text-monitor:started', { options: this.options });
      }
    }

    /**
     * Para monitoramento
     */
    stop() {
      if (!this.isMonitoring) return;

      this.isMonitoring = false;
      if (this.monitorInterval) {
        clearInterval(this.monitorInterval);
        this.monitorInterval = null;
      }

      console.log('[TextMonitor] Monitoramento parado');

      if (window.EventBus) {
        window.EventBus.emit('text-monitor:stopped');
      }
    }

    /**
     * Verifica novas mensagens
     */
    check() {
      if (!this.isMonitoring) return;

      try {
        // Busca última mensagem na conversa ativa
        const messageElements = document.querySelectorAll('[data-testid="msg-container"]');
        if (messageElements.length === 0) return;

        const lastMessage = messageElements[messageElements.length - 1];
        const messageId = lastMessage.getAttribute('data-id');

        // Verifica se já foi processada
        if (messageId === this.lastProcessedMessage) return;

        // Extrai texto da mensagem
        const textElement = lastMessage.querySelector('.selectable-text span');
        if (!textElement) return;

        const text = textElement.textContent.trim();
        if (!text) return;

        // Verifica se é mensagem recebida (não enviada por mim)
        const isIncoming = lastMessage.querySelector('.message-in') !== null;
        if (!isIncoming) return;

        // Processa mensagem
        this.lastProcessedMessage = messageId;
        const analysis = this.analyzeMessage(text);

        console.log('[TextMonitor] Nova mensagem analisada:', analysis);

        // Emite evento
        if (window.EventBus) {
          window.EventBus.emit('text-monitor:message-analyzed', analysis);
        }

        // Verifica auto-resposta
        this.checkAutoResponse(text, analysis);

      } catch (error) {
        console.error('[TextMonitor] Erro ao verificar mensagens:', error);
      }
    }

    /**
     * Configura padrões de auto-resposta
     * @param {Array} patterns - Array de { regex, response }
     */
    watchForAutoResponses(patterns) {
      this.autoResponsePatterns = patterns || [];
      console.log('[TextMonitor] Padrões de auto-resposta configurados:', patterns.length);
    }

    /**
     * Verifica se deve enviar auto-resposta
     * @param {string} text - Texto da mensagem
     * @param {Object} analysis - Análise da mensagem
     */
    checkAutoResponse(text, analysis) {
      if (this.autoResponsePatterns.length === 0) return;

      for (const pattern of this.autoResponsePatterns) {
        const regex = pattern.regex instanceof RegExp 
          ? pattern.regex 
          : new RegExp(pattern.regex, 'i');

        if (regex.test(text)) {
          console.log('[TextMonitor] Auto-resposta ativada:', pattern.response);

          if (window.EventBus) {
            window.EventBus.emit('text-monitor:auto-response', {
              pattern,
              analysis,
              response: pattern.response
            });
          }

          break;
        }
      }
    }

    /**
     * Obtém histórico de mensagens analisadas
     * @param {string} chatId - ID do chat
     * @returns {Array} - Histórico de análises
     */
    getHistory(chatId) {
      return this.messageHistory.get(chatId) || [];
    }

    /**
     * Limpa histórico
     */
    clearHistory() {
      this.messageHistory.clear();
    }

    /**
     * Verifica status de digitação (typing indicator)
     * Detecta quando alguém está digitando e dispara callback onTyping
     */
    checkTypingStatus() {
      try {
        // Observa mudanças no status de digitação
        const typingIndicator = document.querySelector('[data-testid="typing-indicator"]');
        
        if (typingIndicator && typingIndicator.style.display !== 'none') {
          // Alguém está digitando
          if (this.options.onTyping && typeof this.options.onTyping === 'function') {
            this.options.onTyping({ isTyping: true, timestamp: Date.now() });
          }
          
          if (window.EventBus) {
            window.EventBus.emit('text-monitor:typing', { isTyping: true });
          }
          
          return true;
        }
        
        return false;
      } catch (error) {
        console.warn('[TextMonitor] Erro ao verificar status de digitação:', error);
        return false;
      }
    }

    /**
     * Observa mensagens e responde automaticamente baseado em patterns
     * @param {Array} patterns - Array de padrões { trigger: string|RegExp, response: string }
     * @returns {Function} - Função unsubscribe
     */
    watchForAutoResponses(patterns) {
      if (!Array.isArray(patterns) || patterns.length === 0) {
        console.warn('[TextMonitor] Patterns inválidos para watchForAutoResponses');
        return () => {};
      }

      console.log('[TextMonitor] Iniciando observação de auto-respostas com', patterns.length, 'padrões');

      // Armazena patterns
      this.autoResponsePatterns = patterns.map(p => ({
        trigger: typeof p.trigger === 'string' ? new RegExp(p.trigger, 'i') : p.trigger,
        response: p.response,
        category: p.category || 'auto'
      }));

      // Observer de mutações para detectar novas mensagens (com debounce)
      const debouncedHandleMessage = debounce((node) => {
        const textElement = node.querySelector('.selectable-text span');
        if (textElement) {
          const text = textElement.textContent || '';
          this.checkAutoResponse(text);
        }
      }, 300);

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === 1 && node.hasAttribute?.('data-testid')) {
                const testId = node.getAttribute('data-testid');
                if (testId === 'msg-container') {
                  // Nova mensagem detectada
                  debouncedHandleMessage(node);
                }
              }
            });
          }
        }
      });

      // Observa container de mensagens
      const messagesContainer = document.querySelector('#main');
      if (messagesContainer) {
        observer.observe(messagesContainer, {
          childList: true,
          subtree: true
        });
      }

      // Retorna função unsubscribe
      return () => {
        observer.disconnect();
        this.autoResponsePatterns = [];
        console.log('[TextMonitor] Auto-respostas desativadas');
      };
    }

    /**
     * Obtém estatísticas do chat atual
     * @returns {Object} - { total, incoming, outgoing, ratioInOut, averageLength }
     */
    getChatStats() {
      try {
        const messageElements = document.querySelectorAll('[data-testid="msg-container"]');
        
        let total = 0;
        let incoming = 0;
        let outgoing = 0;
        let totalLength = 0;

        messageElements.forEach(msg => {
          total++;
          
          // Detecta direção da mensagem
          const isOutgoing = msg.classList.contains('message-out') || 
                           msg.querySelector('[data-testid="msg-meta"] [data-icon="msg-dblcheck"]') ||
                           msg.querySelector('[data-testid="msg-meta"] [data-icon="msg-check"]');
          
          if (isOutgoing) {
            outgoing++;
          } else {
            incoming++;
          }

          // Calcula comprimento
          const textElement = msg.querySelector('.selectable-text span');
          if (textElement) {
            totalLength += (textElement.textContent || '').length;
          }
        });

        const averageLength = total > 0 ? Math.round(totalLength / total) : 0;
        const ratioInOut = incoming > 0 ? (outgoing / incoming).toFixed(2) : 0;

        return {
          total,
          incoming,
          outgoing,
          ratioInOut: parseFloat(ratioInOut),
          averageLength
        };
      } catch (error) {
        console.warn('[TextMonitor] Erro ao obter estatísticas do chat:', error);
        return {
          total: 0,
          incoming: 0,
          outgoing: 0,
          ratioInOut: 0,
          averageLength: 0
        };
      }
    }
  }

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (window.textMonitor?.stop) {
      window.textMonitor.stop();
    }
  });

  // Exporta globalmente
  window.WhatsAppTextMonitor = WhatsAppTextMonitor;

  // Cria instância global
  if (!window.textMonitor) {
    window.textMonitor = new WhatsAppTextMonitor();
    console.log('[TextMonitor] ✅ Módulo carregado');
  }

})();
