/**
 * 🎓 AI Auto Learner - Aprendizado Contínuo Automático
 * WhatsHybrid v7.7.0
 * 
 * Features:
 * - Aprendizado automático de conversas bem-sucedidas
 * - Aprendizado de correções do usuário
 * - Detecção de padrões emergentes
 * - Poda de padrões ineficazes
 * - Feedback loop automático
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_ai_auto_learner';
  const LEARNING_INTERVAL = 5 * 60 * 1000; // 5 minutos
  const MAX_PENDING_LEARNINGS = 100;

  // ============================================
  // 🛡️ SECURITY: Prototype Pollution Protection
  // ============================================

  // SECURITY FIX P0-040: Prevent Prototype Pollution from storage
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !dangerousKeys.includes(key)) {
        const value = obj[key];
        if (Array.isArray(value)) {
          sanitized[key] = value.map(item =>
            (item && typeof item === 'object') ? sanitizeObject(item) : item
          );
        } else if (value && typeof value === 'object') {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  // ============================================
  // 🛡️ SECURITY: Training Data Sanitization
  // ============================================

  /**
   * Sanitizes training data to prevent data poisoning attacks
   * @param {string} text - Text to sanitize
   * @param {number} maxLength - Maximum length (default 2000)
   * @returns {string} - Sanitized text
   */
  function sanitizeTrainingData(text, maxLength = 2000) {
    if (!text || typeof text !== 'string') return '';

    let clean = String(text);

    // Remove control characters and zero-width spaces
    clean = clean.replace(/[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g, '');

    // Remove dangerous command injection patterns
    const dangerousPatterns = [
      /ignore\s+(all\s+)?(previous\s+)?(instructions?|commands?|rules?)/gi,
      /you\s+are\s+now/gi,
      /system\s*:/gi,
      /admin\s*:/gi,
      /override\s+(instructions?|settings?|config)/gi,
      /execute\s+(command|code|script)/gi,
      /(drop|delete|truncate)\s+(table|database)/gi,
      /\bexec\b.*\(/gi,
      /\beval\b.*\(/gi,
      /<script[\s\S]*?<\/script>/gi,
      /javascript\s*:/gi,
      /on(load|error|click)\s*=/gi
    ];

    for (const pattern of dangerousPatterns) {
      clean = clean.replace(pattern, '[FILTERED]');
    }

    // Limit length to prevent DoS via large training data
    if (clean.length > maxLength) {
      clean = clean.substring(0, maxLength) + '...';
    }

    // Remove excessive whitespace
    clean = clean.replace(/\s{3,}/g, ' ').trim();

    return clean;
  }

  /**
   * Validates and sanitizes training example quality scores
   * @param {number} quality - Quality score to validate
   * @param {number} max - Maximum allowed quality (default 0.7)
   * @returns {number} - Validated quality score
   */
  function validateQuality(quality, max = 0.7) {
    const score = parseFloat(quality);
    if (isNaN(score) || score < 0) return 0;
    return Math.min(score, max);
  }

  class AIAutoLearner {
    constructor() {
      this.pendingLearnings = [];
      this.corrections = [];
      this.patterns = new Map();
      this.metrics = {
        examplesAdded: 0,
        patternsPruned: 0,
        correctionsLearned: 0,
        batchesProcessed: 0
      };
      this.initialized = false;
      this.learningInterval = null;
    }

    // ============================================
    // INICIALIZAÇÃO
    // ============================================
    
    async init() {
      if (this.initialized) return;

      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          // SECURITY FIX P0-040: Sanitize to prevent Prototype Pollution
          const parsed = JSON.parse(data[STORAGE_KEY]);
          const stored = sanitizeObject(parsed);
          this.pendingLearnings = stored.pendingLearnings || [];
          this.corrections = stored.corrections || [];
          this.metrics = stored.metrics || this.metrics;

          if (stored.patterns) {
            Object.entries(stored.patterns).forEach(([key, value]) => {
              this.patterns.set(key, value);
            });
          }
        }

        this.initialized = true;
        this.start();
        
        console.log('[AIAutoLearner] ✅ Inicializado com', this.pendingLearnings.length, 'aprendizados pendentes');
        
      } catch (error) {
        console.error('[AIAutoLearner] Erro ao inicializar:', error);
      }
    }

    // ============================================
    // CONTROLE
    // ============================================
    
    start() {
      if (this.learningInterval) return;
      
      // Processar aprendizados periodicamente
      this.learningInterval = setInterval(() => this.processLearnings(), LEARNING_INTERVAL);
      
      // Configurar listeners
      this.setupEventListeners();
      
      console.log('[AIAutoLearner] ▶️ Aprendizado automático iniciado');
    }

    stop() {
      if (this.learningInterval) {
        clearInterval(this.learningInterval);
        this.learningInterval = null;
      }
      console.log('[AIAutoLearner] ⏹️ Aprendizado automático parado');
    }

    // ============================================
    // EVENT LISTENERS
    // ============================================
    
    setupEventListeners() {
      // Observar conversas bem-sucedidas
      if (window.EventBus) {
        window.EventBus.on('conversation:completed', (data) => {
          this.onConversationCompleted(data);
        });
        
        // Observar correções do usuário
        window.EventBus.on('suggestion:edited', (data) => {
          this.onSuggestionEdited(data);
        });
        
        // Observar feedbacks
        window.EventBus.on('feedback:received', (data) => {
          this.onFeedbackReceived(data);
        });
        
        // Observar uso de sugestões
        window.EventBus.on('suggestion:used', (data) => {
          this.onSuggestionUsed(data);
        });
      }
      
      // Observar mensagens enviadas pelo usuário (para detectar correções)
      this.observeUserMessages();
    }

    // ============================================
    // HANDLERS DE EVENTOS
    // ============================================
    
    /**
     * Quando conversa é completada com sucesso
     */
    onConversationCompleted(data) {
      if (!data || !data.messages || data.messages.length < 2) return;
      
      // Verificar se foi bem-sucedida
      const satisfaction = data.satisfaction || this.estimateSatisfaction(data);
      
      if (satisfaction > 0.7) {
        this.queueForLearning({
          type: 'successful_conversation',
          messages: data.messages,
          satisfaction,
          chatId: data.chatId,
          goalAchieved: data.goalAchieved,
          timestamp: Date.now()
        });
        
        console.log('[AIAutoLearner] 📚 Conversa bem-sucedida enfileirada para aprendizado');
      }
    }

    /**
     * Quando usuário edita sugestão antes de enviar
     */
    onSuggestionEdited(data) {
      if (!data || !data.original || !data.corrected) return;
      
      // Correção é aprendizado de alta qualidade
      this.corrections.push({
        original: data.original,
        corrected: data.corrected,
        context: data.context,
        timestamp: Date.now()
      });
      
      // Manter apenas últimas 100 correções
      if (this.corrections.length > 100) {
        this.corrections = this.corrections.slice(-100);
      }
      
      // Processar correção imediatamente
      this.learnFromCorrection(data);
      
      this.save();
    }

    /**
     * Quando feedback é recebido
     */
    onFeedbackReceived(data) {
      if (!data) return;
      
      // Atualizar peso de padrões baseado no feedback
      if (data.type === 'positive') {
        this.reinforcePattern(data.messagePattern, data.response);
      } else if (data.type === 'negative') {
        this.weakenPattern(data.messagePattern, data.response);
      }
    }

    /**
     * Quando sugestão é usada sem edição
     */
    onSuggestionUsed(data) {
      if (!data) return;
      
      // Sugestão usada sem edição = bom exemplo
      this.queueForLearning({
        type: 'suggestion_accepted',
        input: data.userMessage,
        output: data.suggestion,
        context: data.context,
        quality: 0.9,
        timestamp: Date.now()
      });
    }

    /**
     * Observa mensagens do usuário para detectar correções manuais
     */
    observeUserMessages() {
      // Armazenar última sugestão mostrada
      let lastSuggestion = null;
      
      if (window.EventBus) {
        window.EventBus.on('suggestion:shown', (data) => {
          lastSuggestion = {
            text: data.suggestion,
            timestamp: Date.now(),
            context: data.context
          };
        });
        
        window.EventBus.on('message:sent', (data) => {
          if (lastSuggestion && Date.now() - lastSuggestion.timestamp < 60000) {
            // Mensagem enviada logo após sugestão
            const similarity = this.calculateSimilarity(data.message, lastSuggestion.text);
            
            if (similarity < 0.5 && similarity > 0.1) {
              // Usuário escreveu algo diferente mas relacionado - possível correção
              this.onSuggestionEdited({
                original: lastSuggestion.text,
                corrected: data.message,
                context: lastSuggestion.context
              });
            }
          }
          
          lastSuggestion = null;
        });
      }
    }

    // ============================================
    // APRENDIZADO
    // ============================================
    
    /**
     * Enfileira item para aprendizado
     */
    queueForLearning(item) {
      this.pendingLearnings.push(item);
      
      // Limitar tamanho da fila
      if (this.pendingLearnings.length > MAX_PENDING_LEARNINGS) {
        this.pendingLearnings = this.pendingLearnings.slice(-MAX_PENDING_LEARNINGS);
      }
      
      this.save();
    }

    /**
     * Processa aprendizados pendentes
     */
    async processLearnings() {
      if (this.pendingLearnings.length === 0) return;
      
      const batch = this.pendingLearnings.splice(0, 10);
      
      console.log('[AIAutoLearner] 🔄 Processando', batch.length, 'aprendizados');
      
      for (const item of batch) {
        try {
          switch (item.type) {
            case 'successful_conversation':
              await this.learnFromConversation(item);
              break;
            case 'suggestion_accepted':
              await this.learnFromAcceptedSuggestion(item);
              break;
            default:
              console.warn('[AIAutoLearner] Tipo desconhecido:', item.type);
          }
        } catch (e) {
          console.error('[AIAutoLearner] Erro ao processar:', e);
        }
      }
      
      this.metrics.batchesProcessed++;
      this.save();
      
      // Periodicamente podar padrões ineficazes
      if (this.metrics.batchesProcessed % 10 === 0) {
        this.pruneIneffectivePatterns();
      }
    }

    /**
     * Aprende de conversa bem-sucedida
     */
    async learnFromConversation(item) {
      const { messages, satisfaction } = item;
      
      // Extrair pares pergunta-resposta
      for (let i = 0; i < messages.length - 1; i++) {
        const msg = messages[i];
        const nextMsg = messages[i + 1];
        
        // Se mensagem atual é do cliente e próxima é nossa resposta
        if (!msg.fromMe && nextMsg.fromMe) {
          const patterns = await this.extractPatterns(msg.body);
          
          for (const pattern of patterns) {
            this.updatePattern(pattern, nextMsg.body, satisfaction);
          }
          
          // Adicionar como exemplo de treinamento
          if (window.fewShotLearning && satisfaction > 0.8) {
            // SECURITY FIX (PARTIAL-011-P0.1): Sanitize training data to prevent poisoning
            const sanitizedInput = sanitizeTrainingData(msg.body);
            const sanitizedOutput = sanitizeTrainingData(nextMsg.body);
            const safeQuality = validateQuality(satisfaction, 0.7); // Max 0.7 for auto-learned

            await window.fewShotLearning.addExample({
              input: sanitizedInput,
              output: sanitizedOutput,
              context: {
                chatId: item.chatId,
                satisfaction
              },
              quality: safeQuality
            });

            this.metrics.examplesAdded++;
          }
        }
      }
    }

    /**
     * Aprende de sugestão aceita
     */
    async learnFromAcceptedSuggestion(item) {
      const { input, output, quality } = item;

      // Adicionar como exemplo
      if (window.fewShotLearning) {
        // SECURITY FIX (PARTIAL-011-P0.3): Sanitize accepted suggestions to prevent data poisoning
        const sanitizedInput = sanitizeTrainingData(input);
        const sanitizedOutput = sanitizeTrainingData(output);
        const safeQuality = validateQuality(quality, 0.7); // Max 0.7 for auto-accepted

        await window.fewShotLearning.addExample({
          input: sanitizedInput,
          output: sanitizedOutput,
          context: item.context,
          quality: safeQuality,
          source: 'auto_learner'
        });

        this.metrics.examplesAdded++;
      }

      // Atualizar padrões
      const patterns = await this.extractPatterns(input);
      for (const pattern of patterns) {
        this.updatePattern(pattern, output, quality);
      }
    }

    /**
     * Aprende de correção do usuário (mais valioso)
     */
    async learnFromCorrection(data) {
      const { original, corrected, context } = data;

      // Adicionar correção como exemplo de alta qualidade
      if (window.fewShotLearning && context?.userMessage) {
        // SECURITY FIX (PARTIAL-011-P0.2): Sanitize user corrections to prevent data poisoning
        const sanitizedInput = sanitizeTrainingData(context.userMessage);
        const sanitizedOutput = sanitizeTrainingData(corrected);

        // Limit quality to 0.75 - human corrections still need validation
        const safeQuality = validateQuality(0.75, 0.75);

        await window.fewShotLearning.addExample({
          input: sanitizedInput,
          output: sanitizedOutput,
          context: {
            ...context,
            userMessage: sanitizedInput // Sanitize context too
          },
          quality: safeQuality,
          isCorrection: true
        });

        this.metrics.correctionsLearned++;
      }
      
      // Penalizar padrões que geraram resposta incorreta
      if (original) {
        const originalPatterns = await this.extractPatterns(original);
        for (const pattern of originalPatterns) {
          this.weakenPattern(pattern, original);
        }
      }
      
      // Reforçar padrões da correção
      const correctedPatterns = await this.extractPatterns(corrected);
      for (const pattern of correctedPatterns) {
        this.reinforcePattern(pattern, corrected);
      }
      
      console.log('[AIAutoLearner] ✏️ Aprendizado de correção aplicado');
    }

    // ============================================
    // GESTÃO DE PADRÕES
    // ============================================
    
    /**
     * Extrai padrões de um texto
     */
    async extractPatterns(text) {
      if (!text) return [];
      
      const patterns = [];
      const lowerText = text.toLowerCase();
      
      // Padrões de intenção
      const intentPatterns = {
        'greeting': /^(oi|olá|hey|bom dia|boa tarde|boa noite)/i,
        'question_price': /(quanto|preço|valor|custa|orçamento)/i,
        'question_availability': /(tem|disponível|estoque|prazo)/i,
        'buy_intent': /(comprar|quero|pode mandar|fechar|confirmo)/i,
        'complaint': /(problema|reclamar|péssimo|horrível|não funciona)/i,
        'thanks': /(obrigad|valeu|agradeço|thanks)/i,
        'farewell': /(tchau|até|adeus|flw)/i
      };
      
      for (const [intent, regex] of Object.entries(intentPatterns)) {
        if (regex.test(lowerText)) {
          patterns.push(`intent:${intent}`);
        }
      }
      
      // Palavras-chave importantes (bigramas)
      const words = lowerText.split(/\s+/).filter(w => w.length > 3);
      for (let i = 0; i < words.length - 1; i++) {
        patterns.push(`bigram:${words[i]}_${words[i + 1]}`);
      }
      
      return patterns;
    }

    /**
     * Atualiza padrão com nova resposta
     */
    updatePattern(patternKey, response, quality) {
      const existing = this.patterns.get(patternKey) || {
        responses: [],
        successCount: 0,
        failCount: 0,
        lastUsed: null
      };
      
      // Adicionar resposta se não duplicada
      const isDuplicate = existing.responses.some(r => 
        this.calculateSimilarity(r.text, response) > 0.8
      );
      
      if (!isDuplicate) {
        existing.responses.push({
          text: response,
          quality,
          addedAt: Date.now()
        });
        
        // Manter apenas top 5 respostas
        existing.responses.sort((a, b) => b.quality - a.quality);
        existing.responses = existing.responses.slice(0, 5);
      }
      
      existing.successCount += quality > 0.7 ? 1 : 0;
      existing.lastUsed = Date.now();
      
      this.patterns.set(patternKey, existing);
    }

    /**
     * Reforça padrão (feedback positivo)
     */
    reinforcePattern(patternKey, response) {
      const existing = this.patterns.get(patternKey);
      if (!existing) return;
      
      existing.successCount++;
      
      // Aumentar qualidade da resposta específica
      const resp = existing.responses.find(r => 
        this.calculateSimilarity(r.text, response) > 0.7
      );
      if (resp) {
        resp.quality = Math.min(1, resp.quality + 0.05);
      }
      
      this.patterns.set(patternKey, existing);
    }

    /**
     * Enfraquece padrão (feedback negativo)
     */
    weakenPattern(patternKey, response) {
      const existing = this.patterns.get(patternKey);
      if (!existing) return;
      
      existing.failCount++;
      
      // Diminuir qualidade da resposta específica
      const resp = existing.responses.find(r => 
        this.calculateSimilarity(r.text, response) > 0.7
      );
      if (resp) {
        resp.quality = Math.max(0, resp.quality - 0.1);
      }
      
      this.patterns.set(patternKey, existing);
    }

    /**
     * Remove padrões ineficazes
     */
    pruneIneffectivePatterns() {
      let pruned = 0;
      
      for (const [key, pattern] of this.patterns.entries()) {
        const total = pattern.successCount + pattern.failCount;
        
        // Remover se:
        // 1. Baixa taxa de sucesso com suficiente dados
        // 2. Não usado há muito tempo
        const successRate = total > 0 ? pattern.successCount / total : 0;
        const daysSinceUse = (Date.now() - (pattern.lastUsed || 0)) / (24 * 60 * 60 * 1000);
        
        if ((total >= 5 && successRate < 0.3) || daysSinceUse > 30) {
          this.patterns.delete(key);
          pruned++;
        }
      }
      
      if (pruned > 0) {
        this.metrics.patternsPruned += pruned;
        console.log('[AIAutoLearner] 🧹 Podados', pruned, 'padrões ineficazes');
        this.save();
      }
    }

    // ============================================
    // UTILIDADES
    // ============================================
    
    /**
     * Estima satisfação de conversa
     */
    estimateSatisfaction(data) {
      const messages = data.messages || [];
      let score = 0.5;
      
      // Verificar última mensagem do cliente
      const lastClientMsg = [...messages].reverse().find(m => !m.fromMe);
      if (lastClientMsg) {
        const text = lastClientMsg.body.toLowerCase();
        
        // Indicadores positivos
        if (/obrigad|valeu|perfeito|ótimo|excelente|top/.test(text)) {
          score += 0.3;
        }
        
        // Indicadores negativos
        if (/problema|péssimo|horrível|não funciona|reclamar/.test(text)) {
          score -= 0.3;
        }
      }
      
      // Verificar se conversa teve resolução
      if (data.goalAchieved) score += 0.2;
      
      return Math.max(0, Math.min(1, score));
    }

    /**
     * Calcula similaridade entre textos
     */
    calculateSimilarity(text1, text2) {
      if (!text1 || !text2) return 0;
      
      const words1 = new Set(text1.toLowerCase().split(/\s+/));
      const words2 = new Set(text2.toLowerCase().split(/\s+/));
      
      let intersection = 0;
      for (const word of words1) {
        if (words2.has(word)) intersection++;
      }
      
      const union = words1.size + words2.size - intersection;
      return union > 0 ? intersection / union : 0;
    }

    // ============================================
    // PERSISTÊNCIA
    // ============================================
    
    async save() {
      try {
        const data = {
          pendingLearnings: this.pendingLearnings,
          corrections: this.corrections.slice(-50), // Manter apenas últimas 50
          patterns: Object.fromEntries(this.patterns),
          metrics: this.metrics,
          savedAt: Date.now()
        };
        
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(data)
        });
        
        return true;
      } catch (error) {
        console.error('[AIAutoLearner] Erro ao salvar:', error);
        return false;
      }
    }

    // ============================================
    // MÉTRICAS
    // ============================================
    
    getMetrics() {
      return {
        ...this.metrics,
        pendingLearnings: this.pendingLearnings.length,
        patterns: this.patterns.size,
        corrections: this.corrections.length,
        isRunning: !!this.learningInterval
      };
    }

    // ============================================
    // DEBUG
    // ============================================
    
    getPatterns() {
      return Array.from(this.patterns.entries()).map(([key, value]) => ({
        pattern: key,
        responses: value.responses.length,
        successRate: value.successCount / (value.successCount + value.failCount + 1),
        lastUsed: value.lastUsed
      }));
    }
  }

  // ============================================
  // EXPORTAR
  // ============================================
  
  window.AIAutoLearner = AIAutoLearner;
  
  if (!window.aiAutoLearner) {
    window.aiAutoLearner = new AIAutoLearner();
    window.aiAutoLearner.init().then(() => {
      console.log('[AIAutoLearner] ✅ Sistema de aprendizado automático inicializado');
    });
  }

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (window.aiAutoLearner?.stop) {
      window.aiAutoLearner.stop();
    }
  });

})();
