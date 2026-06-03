/**
 * 🎓 Few-Shot Learning - Sistema de Exemplos de Treinamento
 * WhatsHybrid v7.6.0
 * 
 * TODO: AUDIT-NEW-018 (P3) - i18n AI Prompts
 * This module has hardcoded Portuguese labels for few-shot examples.
 * See: docs/internal/PEND-MED-003-I18N-AI-PROMPTS-FIX.md for full implementation guide.
 * Lines affected: 545-561 (formatForPrompt labels)
 * 
 * Funcionalidades:
 * - Armazenamento de exemplos de treinamento
 * - Seleção inteligente de exemplos relevantes
 * - Sincronização com backend
 * - Limite de exemplos para otimização
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_few_shot_examples';
  const MAX_EXAMPLES = 60;
  const FALLBACK_COUNT = 2; // AI-003: Max examples to return when no keyword matches (conservative fallback)
  const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');

  // v9.5.2: Synonym groups for keyword matching — words in the same group are treated as equivalent.
  // Domain-specific (Brazilian Portuguese WhatsApp commerce) — extend as needed.
  const SYNONYM_GROUPS = [
    ['preco', 'preço', 'valor', 'custo', 'quanto', 'orcamento', 'orçamento'],
    ['entrega', 'frete', 'envio', 'enviar', 'mandar', 'despachar', 'postagem'],
    ['cancelar', 'cancelamento', 'desistir', 'devolver', 'devolucao', 'devolução', 'estorno'],
    ['pagamento', 'pagar', 'pago', 'boleto', 'pix', 'cartao', 'cartão', 'credito', 'crédito'],
    ['horario', 'horário', 'funciona', 'aberto', 'fechado', 'expediente', 'atendimento'],
    ['estoque', 'disponivel', 'disponível', 'tem', 'existe', 'sobrou', 'restante'],
    ['desconto', 'promocao', 'promoção', 'oferta', 'cupom', 'liquidacao', 'liquidação'],
    ['garantia', 'troca', 'defeito', 'problema', 'quebrado', 'estragado', 'reclamar', 'reclamacao'],
    ['endereco', 'endereço', 'localizacao', 'localização', 'onde', 'rua', 'cep'],
    ['contato', 'telefone', 'whatsapp', 'celular', 'numero', 'número', 'falar']
  ];

  // Build O(1) lookup: word → canonical token (first word of group)
  const SYNONYM_LOOKUP = (() => {
    const map = new Map();
    for (const group of SYNONYM_GROUPS) {
      const canonical = group[0];
      for (const word of group) map.set(word, canonical);
    }
    return map;
  })();

  function normalizeWord(w) {
    return SYNONYM_LOOKUP.get(w) || w;
  }

  // ============================================
  // SECURITY HELPERS
  // ============================================

  // SECURITY FIX P0-041: Prevent Prototype Pollution from JSON import
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

  /**
   * SECURITY FIX P0-031: Sanitize training examples to prevent Prompt Injection and Training Data Poisoning
   * Critical: Examples are directly embedded in AI prompts - malicious examples = compromised AI responses
   */
  function sanitizeTrainingExample(example) {
    if (!example || typeof example !== 'object') {
      return null;
    }

    // Helper: Sanitize text to prevent prompt injection
    const sanitizeText = (text, maxLength = 2000) => {
      if (!text) return '';

      let sanitized = String(text).slice(0, maxLength);

      // Remove control characters that could break prompt formatting
      sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

      // Detect and neutralize prompt injection attempts
      const injectionPatterns = [
        /ignore\s+(all\s+)?previous\s+instructions/gi,
        /disregard\s+(all\s+)?above/gi,
        /forget\s+(all\s+)?previous/gi,
        /new\s+instructions?:/gi,
        /system\s*:/gi,
        /assistant\s*:/gi,
        /you\s+are\s+now/gi,
        /<\|.*?\|>/g, // Special tokens
        /\[INST\]/gi,
        /\[\/INST\]/gi
      ];

      injectionPatterns.forEach(pattern => {
        if (pattern.test(sanitized)) {
          console.warn('[FewShotLearning Security] Prompt injection attempt detected and neutralized');
          sanitized = sanitized.replace(pattern, '[FILTERED]');
        }
      });

      return sanitized.trim();
    };

    // Validate and sanitize all fields
    const sanitized = {
      id: Number(example.id) || Date.now(),
      input: sanitizeText(example.input, 2000),
      output: sanitizeText(example.output, 3000),
      context: sanitizeText(example.context || '', 500),
      category: sanitizeText(example.category || 'Geral', 50),
      tags: Array.isArray(example.tags)
        ? example.tags.slice(0, 20).map(t => sanitizeText(String(t), 30))
        : [],
      createdAt: Number(example.createdAt) || Date.now(),
      usageCount: Number(example.usageCount) || 0,
      lastUsed: example.lastUsed ? Number(example.lastUsed) : null,
      score: Number(example.score) || 1.0
    };

    // Reject examples with empty input/output (after sanitization)
    if (!sanitized.input || !sanitized.output) {
      console.warn('[FewShotLearning Security] Rejecting example with empty input/output after sanitization');
      return null;
    }

    return sanitized;
  }

  class FewShotLearning {
    constructor() {
      this.examples = [];
      this.initialized = false;
    }

    /**
     * Inicializa e carrega exemplos do storage
     */
    async init() {
      if (this.initialized) return;

      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          // AI-008 FIX: Handle both string (correct) and object (legacy) formats
          const raw = data[STORAGE_KEY];
          let rawExamples;
          
          if (typeof raw === 'string') {
            rawExamples = JSON.parse(raw);
            if (WHL_DEBUG) console.log('[AI-008] ✅ FSL loaded examples from JSON string');
          } else if (Array.isArray(raw)) {
            rawExamples = raw;
            if (WHL_DEBUG) console.log('[AI-008] ⚠️ FSL loaded examples from legacy object format');
          } else {
            rawExamples = [];
          }

          // SECURITY FIX P0-031: Sanitize examples loaded from storage to prevent Training Data Poisoning
          // Storage could be compromised or contain legacy unsanitized data
          this.examples = rawExamples
            .map(ex => sanitizeTrainingExample(ex))
            .filter(ex => ex !== null);

          const rejectedCount = rawExamples.length - this.examples.length;
          if (rejectedCount > 0) {
            console.warn(`[FewShotLearning Security] ${rejectedCount} examples rejected during load`);
          }

          if (WHL_DEBUG) console.log('[FewShotLearning] Exemplos carregados (sanitizados):', this.examples.length);
        }
        this.initialized = true;
      } catch (error) {
        console.error('[FewShotLearning] Erro ao inicializar:', error);
        this.examples = [];
      }
    }

    /**
     * Salva exemplos no storage
     */
    async save() {
      try {
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(this.examples)
        });
        if (WHL_DEBUG) console.log('[FewShotLearning] Exemplos salvos');
        return true;
      } catch (error) {
        console.error('[FewShotLearning] Erro ao salvar:', error);
        return false;
      }
    }

    /**
     * Adiciona exemplo de treinamento
     * @param {Object} example - { input, output, context, category, tags }
     * @returns {Object} - Exemplo adicionado
     */
    async addExample(example) {
      if (!example.input || !example.output) {
        console.warn('[FewShotLearning] Exemplo inválido: input e output são obrigatórios');
        return null;
      }

      // SECURITY FIX P0-031: Sanitize example to prevent Prompt Injection and Training Data Poisoning
      const sanitized = sanitizeTrainingExample({
        id: Date.now(),
        input: example.input,
        output: example.output,
        context: example.context || '',
        category: example.category || 'Geral',
        tags: example.tags || this.extractTags(example.input + ' ' + example.output),
        createdAt: Date.now(),
        usageCount: 0,
        lastUsed: null,
        score: 1.0
      });

      if (!sanitized) {
        console.warn('[FewShotLearning Security] Example rejected after sanitization');
        return null;
      }

      this.examples.push(sanitized);

      // Limita número de exemplos (remove menos utilizados)
      if (this.examples.length > MAX_EXAMPLES) {
        const beforeLen = this.examples.length;
        // v9.5.4: Per-category cap to preserve topic diversity. Without this, 50 "preço" examples
        // can crowd out "entrega"/"garantia"/"cancelamento" entirely. Each category keeps top-15
        // by score; survivors compete globally for remaining slots.
        const MAX_PER_CATEGORY = 15;
        const sortByScore = (a, b) => {
          const qa = (Number(a.quality) || 9) >= 10 ? 1.5 : 1.0;
          const qb = (Number(b.quality) || 9) >= 10 ? 1.5 : 1.0;
          return ((b.score * qb) + (b.usageCount * 0.05)) - ((a.score * qa) + (a.usageCount * 0.05));
        };
        const grouped = new Map();
        for (const ex of this.examples) {
          const cat = ex.category || 'Geral';
          if (!grouped.has(cat)) grouped.set(cat, []);
          grouped.get(cat).push(ex);
        }
        const survivors = [];
        const remainder = [];
        for (const [, list] of grouped) {
          list.sort(sortByScore);
          survivors.push(...list.slice(0, MAX_PER_CATEGORY));
          remainder.push(...list.slice(MAX_PER_CATEGORY));
        }
        if (survivors.length >= MAX_EXAMPLES) {
          survivors.sort(sortByScore);
          this.examples = survivors.slice(0, MAX_EXAMPLES);
        } else {
          remainder.sort(sortByScore);
          this.examples = [...survivors, ...remainder.slice(0, MAX_EXAMPLES - survivors.length)];
        }
        // Keep the original sort behavior afterwards so other code sees ranked order.
        this.examples.sort(sortByScore);

        this.examples = this.examples.slice(0, MAX_EXAMPLES);
        if (WHL_DEBUG) console.log('[FewShotLearning] Limite de exemplos atingido, removendo menos utilizados');
        const removedCount = Math.max(0, beforeLen - MAX_EXAMPLES);
        if (removedCount > 0 && typeof window !== 'undefined') {
          // Preferir NotificationsModule (fonte única de toast)
          if (window.NotificationsModule?.toast) {
            window.NotificationsModule.toast(`${removedCount} exemplos excederam o limite e foram descartados`, 'warning', 3000);
          } else if (window.NotificationsModule?.warning) {
            window.NotificationsModule.warning('Limite de exemplos', `${removedCount} exemplos excederam o limite e foram descartados`);
          } else {
            console.warn(`[FewShotLearning] ${removedCount} exemplos excederam o limite e foram descartados`);
          }
        }
      }

      await this.save();

      // Emite evento
      if (window.EventBus) {
        window.EventBus.emit('few-shot:example-added', sanitized);
      }

      // Envia para backend
      this.pushToBackend(sanitized);

      return sanitized;
    }

    /**
     * Remove exemplo
     * @param {number} id - ID do exemplo
     */
    async removeExample(id) {
      this.examples = this.examples.filter(ex => ex.id !== id);
      await this.save();
      if (WHL_DEBUG) console.log('[FewShotLearning] Exemplo removido:', id);
    }

    /**
     * Obtém todos os exemplos
     * @returns {Array} - Lista de exemplos (cópia)
     */
    getExamples() {
      return [...this.examples];
    }

    /**
     * Alias para getExamples (compatibilidade)
     * @returns {Array} - Lista de exemplos (cópia)
     */
    getAll() {
      return [...this.examples];
    }

    /**
     * Obtém exemplos por categoria
     * @param {string} category - Categoria
     * @returns {Array} - Exemplos da categoria
     */
    getExamplesByCategory(category) {
      return this.examples.filter(ex => ex.category === category);
    }

    /**
     * Seleciona exemplos mais relevantes baseado em keyword overlap
     * Baseado em CERTO-WHATSAPPLITE-main-21/05chromeextensionwhatsapp/content/content.js pickExamples()
     * 
     * @param {string} transcript - Transcrição atual
     * @param {number} max - Máximo de exemplos
     * @returns {Array} - Exemplos ordenados por relevância
     */
    pickRelevantExamples(transcript, max = 3) {
      const examples = this.getAll();

      if (!examples.length || !transcript) {
        return examples.slice(0, max);
      }

      const transcriptLower = transcript.toLowerCase();
      // v9.5.2: Normalize transcript words via synonym lookup so "preço" and "valor" match the same token.
      const transcriptWords = new Set(
        transcriptLower.split(/\W+/)
          .filter(w => w.length >= 4)
          .map(normalizeWord)
      );

      const now = Date.now();
      const DAY_MS = 86400000;

      // v9.5.2: Multi-factor scoring — keyword overlap (synonym-aware) × quality × recency.
      const scored = examples.map(ex => {
        const userText = (ex.user || ex.input || '').toLowerCase();
        const userWords = userText.split(/\W+/).filter(w => w.length >= 4).map(normalizeWord);

        let keywordScore = 0;
        for (const word of userWords.slice(0, 18)) {
          if (transcriptWords.has(word)) keywordScore += 1;
        }

        // Quality boost: edited examples (quality 10) get 50% bonus over plain approvals (quality 9).
        const quality = Number(ex.quality) || 9;
        const qualityMultiplier = quality >= 10 ? 1.5 : 1.0;

        // Recency decay: linear over 180 days, floor at 0.4 so old examples still count.
        const ageInDays = ex.createdAt ? Math.max(0, (now - ex.createdAt) / DAY_MS) : 0;
        const recencyMultiplier = Math.max(0.4, 1 - (ageInDays / 180) * 0.6);

        const score = keywordScore * qualityMultiplier * recencyMultiplier;

        return { example: ex, score, keywordScore };
      });

      const relevant = scored
        .sort((a, b) => b.score - a.score)
        .filter(s => s.keywordScore > 0)
        .slice(0, max)
        .map(s => s.example);

      // AI-003 FIX: Fallback - if no keyword overlap, return most-used examples
      // Returns max FALLBACK_COUNT examples as a conservative fallback to avoid poor quality matches
      if (relevant.length === 0 && examples.length > 0) {
        console.log('[AI-003] ⚠️ No keyword matches, using fallback to most-used examples');
        return examples
          .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
          .slice(0, Math.min(max, FALLBACK_COUNT));
      }

      return relevant;
    }

    /**
     * v9.5.2: Increments usage counter for an example after it has been picked.
     * Wired from ai-suggestion-fixed.js so the most-helpful examples rise to the top over time.
     */
    async incrementUsage(exampleId) {
      const ex = this.examples.find(e => e.id === exampleId);
      if (!ex) return;
      ex.usageCount = (Number(ex.usageCount) || 0) + 1;
      ex.lastUsed = Date.now();
      await this.save();
    }

    /**
     * Seleciona exemplos mais relevantes para um contexto (versão avançada)
     * Usa ranking multi-fator: similaridade, intenção, sentimento, recência, sucesso
     * 
     * @param {Array} examples - Lista de exemplos (opcional, usa todos se não fornecido)
     * @param {string} transcript - Transcrição/contexto atual
     * @param {number} max - Número máximo de exemplos a retornar
     * @param {Object} context - Contexto adicional (intent, sentiment, category)
     * @returns {Array} - Exemplos selecionados com scores
     */
    pickExamples(examples = null, transcript = '', max = 3, context = {}) {
      const exampleList = examples || this.examples;
      
      if (exampleList.length === 0) {
        return [];
      }

      if (!transcript) {
        // Se não há contexto, retorna exemplos mais recentes/usados
        return exampleList
          .sort((a, b) => b.usageCount - a.usageCount)
          .slice(0, max);
      }

      // Weights para ranking multi-fator
      const weights = {
        textSimilarity: 0.25,      // Similaridade do texto
        intentMatch: 0.20,         // Mesma intenção detectada
        sentimentMatch: 0.10,      // Sentimento similar
        recency: 0.10,             // Exemplos mais recentes
        successRate: 0.20,         // Taxa de sucesso (feedbacks positivos)
        categoryMatch: 0.15        // Mesma categoria/produto
      };

      // Calcula relevância multi-fator
      const transcriptWords = this.extractTags(transcript.toLowerCase());
      const now = Date.now();
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      
      const scored = exampleList.map(example => {
        let score = 0;
        
        // 1. Similaridade textual (keywords)
        let keywordScore = 0;
        example.tags.forEach(tag => {
          if (transcriptWords.includes(tag)) {
            keywordScore += 2;
          }
        });
        const maxKeywordScore = Math.max(example.tags.length, transcriptWords.length) || 1;
        score += (keywordScore / maxKeywordScore) * weights.textSimilarity;
        
        // 2. Match de intenção
        if (context.intent && example.intent) {
          if (example.intent === context.intent) {
            score += weights.intentMatch;
          } else if (this.areRelatedIntents(example.intent, context.intent)) {
            score += weights.intentMatch * 0.5;
          }
        }
        
        // 3. Match de sentimento
        if (context.sentiment !== undefined && example.sentiment !== undefined) {
          const sentimentDiff = Math.abs(context.sentiment - example.sentiment);
          if (sentimentDiff < 0.3) {
            score += weights.sentimentMatch;
          } else if (sentimentDiff < 0.6) {
            score += weights.sentimentMatch * 0.5;
          }
        }
        
        // 4. Recência (exemplos recentes = mais relevantes)
        const age = now - (example.createdAt || 0);
        const recencyScore = Math.max(0, 1 - (age / thirtyDays));
        score += recencyScore * weights.recency;
        
        // 5. Taxa de sucesso
        const totalFeedback = (example.positiveCount || 0) + (example.negativeCount || 0);
        if (totalFeedback > 0) {
          const successRate = (example.positiveCount || 0) / totalFeedback;
          score += successRate * weights.successRate;
        } else {
          score += 0.5 * weights.successRate; // Neutro se sem feedback
        }
        
        // 6. Match de categoria
        if (context.category && example.category) {
          if (example.category === context.category) {
            score += weights.categoryMatch;
          }
        }

        // Bonus por usage count (exemplos bem sucedidos)
        score += Math.min(example.usageCount * 0.02, 0.1);

        // Bonus por score do exemplo
        score += (example.score || 1) * 0.1;

        // Penalidade por idade (favorece exemplos mais recentes)
        const ageInDays = (Date.now() - example.createdAt) / (1000 * 60 * 60 * 24);
        score -= ageInDays * 0.01;

        return { ...example, relevanceScore: score };
      });

      // Ordena por relevância e retorna top N
      return scored
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, max);
    }

    /**
     * Registra uso de um exemplo
     * @param {number} id - ID do exemplo
     */
    async recordUsage(id) {
      const example = this.examples.find(ex => ex.id === id);
      if (example) {
        example.usageCount = (example.usageCount || 0) + 1;
        example.lastUsed = Date.now();
        await this.save();
      }
    }

    /**
     * Atualiza score de um exemplo
     * @param {number} id - ID do exemplo
     * @param {number} delta - Mudança no score (+/-)
     */
    async updateScore(id, delta) {
      const example = this.examples.find(ex => ex.id === id);
      if (example) {
        example.score = Math.max(0, Math.min(10, example.score + delta));
        await this.save();
      }
    }

    /**
     * Verifica se duas intenções são relacionadas
     * @param {string} intent1 
     * @param {string} intent2 
     * @returns {boolean}
     */
    areRelatedIntents(intent1, intent2) {
      const relatedGroups = [
        ['greeting', 'hello', 'hi', 'oi'],
        ['farewell', 'bye', 'goodbye', 'tchau'],
        ['question', 'question_price', 'question_availability', 'question_info'],
        ['purchase', 'buy', 'order', 'compra'],
        ['complaint', 'problem', 'issue', 'reclamacao'],
        ['thanks', 'gratitude', 'obrigado'],
        ['support', 'help', 'suporte', 'ajuda']
      ];
      
      for (const group of relatedGroups) {
        if (group.includes(intent1) && group.includes(intent2)) {
          return true;
        }
      }
      
      return false;
    }

    /**
     * Atualiza feedback de um exemplo (para ranking)
     * @param {number} id - ID do exemplo
     * @param {boolean} positive - Se feedback é positivo
     */
    async recordFeedback(id, positive = true) {
      const example = this.examples.find(ex => ex.id === id);
      if (example) {
        if (positive) {
          example.positiveCount = (example.positiveCount || 0) + 1;
          example.score = Math.min(10, (example.score || 1) + 0.1);
        } else {
          example.negativeCount = (example.negativeCount || 0) + 1;
          example.score = Math.max(0, (example.score || 1) - 0.2);
        }
        await this.save();
      }
    }

    /**
     * Encontra exemplos similares a um texto
     * @param {string} text - Texto para comparar
     * @param {number} threshold - Threshold de similaridade (0-1)
     * @returns {Array} - Exemplos similares
     */
    findSimilar(text, threshold = 0.5) {
      if (!text) return [];
      
      const textWords = new Set(this.extractTags(text.toLowerCase()));
      
      return this.examples.filter(ex => {
        const exWords = new Set(ex.tags || []);
        
        let intersection = 0;
        for (const word of textWords) {
          if (exWords.has(word)) intersection++;
        }
        
        const union = textWords.size + exWords.size - intersection;
        const similarity = union > 0 ? intersection / union : 0;
        
        return similarity >= threshold;
      });
    }

    /**
     * Extrai tags/keywords de um texto
     * @param {string} text - Texto
     * @returns {Array} - Tags extraídas
     */
    extractTags(text) {
      const words = text.toLowerCase()
        .replace(/[^\wáàâãéèêíïóôõöúçñ\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3);
      
      // Remove duplicatas
      return [...new Set(words)];
    }

    /**
     * Formata exemplos para uso em prompt
     * @param {Array} examples - Lista de exemplos
     * @returns {string} - Exemplos formatados
     */
    formatForPrompt(examples) {
      if (!examples || examples.length === 0) {
        return '';
      }

      let formatted = 'Exemplos de conversas anteriores:\n\n';

      examples.forEach((example, index) => {
        formatted += `Exemplo ${index + 1}:\n`;
        if (example.context) {
          formatted += `Contexto: ${example.context}\n`;
        }
        formatted += `Cliente: ${example.input}\n`;
        formatted += `Atendente: ${example.output}\n\n`;
      });

      return formatted;
    }

    /**
     * Envia exemplo para backend
     * @param {Object} example - Exemplo
     */
    pushToBackend(example) {
      try {
        const event = {
          type: 'example_added',
          example,
          timestamp: Date.now()
        };

        chrome.runtime.sendMessage({
          action: 'FEW_SHOT_PUSH',
          event
        }).catch(err => {
          console.warn('[FewShotLearning] Erro ao enviar para backend:', err);
        });

      } catch (error) {
        console.error('[FewShotLearning] Erro ao fazer push:', error);
      }
    }

    /**
     * Sincroniza exemplos com backend
     */
    async syncWithBackend() {
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'FEW_SHOT_SYNC'
        });

        if (response && response.success && response.examples) {
          // Mescla com exemplos locais
          this.mergeExamples(response.examples);
          await this.save();
          console.log('[FewShotLearning] Sincronizado com backend');
        }
      } catch (error) {
        console.error('[FewShotLearning] Erro ao sincronizar:', error);
      }
    }

    /**
     * Mescla exemplos externos com locais
     * @param {Array} externalExamples - Exemplos externos
     */
    mergeExamples(externalExamples) {
      const existingIds = new Set(this.examples.map(ex => ex.id));

      externalExamples.forEach(external => {
        // SECURITY FIX P0-031: Sanitize external examples to prevent Training Data Poisoning
        const sanitized = sanitizeTrainingExample(external);
        if (!sanitized) {
          console.warn('[FewShotLearning Security] External example rejected after sanitization');
          return;
        }

        if (!existingIds.has(sanitized.id)) {
          this.examples.push(sanitized);
        } else {
          // Atualiza exemplo existente se o externo for mais recente
          const index = this.examples.findIndex(ex => ex.id === sanitized.id);
          if (index >= 0 && sanitized.lastUsed > this.examples[index].lastUsed) {
            this.examples[index] = sanitized;
          }
        }
      });

      // Aplica limite
      if (this.examples.length > MAX_EXAMPLES) {
        const beforeLen = this.examples.length;
        this.examples.sort((a, b) => b.usageCount - a.usageCount);
        this.examples = this.examples.slice(0, MAX_EXAMPLES);
        const removed = Math.max(0, beforeLen - MAX_EXAMPLES);
        if (removed > 0) {
          console.warn(`[FewShotLearning] ${removed} exemplos descartados por limite (merge)`);
        }
      }
    }

    /**
     * Exporta exemplos como JSON
     * @returns {string} - JSON dos exemplos
     */
    exportJSON() {
      return JSON.stringify(this.examples, null, 2);
    }

    /**
     * Importa exemplos de JSON
     * @param {string} json - JSON dos exemplos
     */
    async importJSON(json) {
      try {
        const parsed = JSON.parse(json);

        // SECURITY FIX P0-041: Sanitize to prevent Prototype Pollution
        const imported = Array.isArray(parsed) ? parsed.map(item => sanitizeObject(item)) : [];

        if (imported.length === 0 && parsed && parsed.length > 0) {
          throw new Error('JSON inválido: sanitização removeu todos os elementos');
        }

        this.mergeExamples(imported);
        await this.save();
        console.log('[FewShotLearning] Exemplos importados:', imported.length);
        return true;
      } catch (error) {
        console.error('[FewShotLearning] Erro ao importar JSON:', error);
        return false;
      }
    }

    /**
     * Limpa todos os exemplos
     */
    async clearAll() {
      this.examples = [];
      await this.save();
      console.log('[FewShotLearning] Todos os exemplos limpos');
    }

    /**
     * Obtém estatísticas
     * @returns {Object} - Estatísticas
     */
    getStats() {
      const totalUsage = this.examples.reduce((sum, ex) => sum + ex.usageCount, 0);
      const avgScore = this.examples.length > 0
        ? this.examples.reduce((sum, ex) => sum + ex.score, 0) / this.examples.length
        : 0;

      return {
        totalExamples: this.examples.length,
        maxExamples: MAX_EXAMPLES,
        totalUsage,
        avgScore: avgScore.toFixed(2)
      };
    }
  }

  /**
   * Função standalone para selecionar exemplos por keyword overlap
   * @param {Array} examples - Array de exemplos { input, output, tags? }
   * @param {string} transcript - Texto para análise
   * @param {number} max - Máximo de exemplos (padrão: 3)
   * @returns {Array} - Exemplos selecionados com score > 0
   */
  function pickExamples(examples, transcript, max = 3) {
    if (!Array.isArray(examples) || examples.length === 0) {
      return [];
    }

    if (!transcript || typeof transcript !== 'string') {
      // Sem contexto, retorna os primeiros
      return examples.slice(0, max);
    }

    // Extrai palavras relevantes do transcript (4+ chars)
    const transcriptWords = transcript
      .toLowerCase()
      .replace(/[^\wáàâãéèêíïóôõöúçñ\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 4);

    if (transcriptWords.length === 0) {
      return examples.slice(0, max);
    }

    // Calcula score de cada exemplo baseado em keyword overlap
    const scored = examples.map(example => {
      let score = 0;
      
      // Combina input + output para análise
      const exampleText = ((example.input || '') + ' ' + (example.output || '')).toLowerCase();
      
      // Extrai tags se não existir
      let tags = example.tags || [];
      if (tags.length === 0) {
        tags = exampleText
          .replace(/[^\wáàâãéèêíïóôõöúçñ\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length >= 4);
      }
      
      // Conta quantas palavras do transcript aparecem no exemplo
      transcriptWords.forEach(word => {
        if (tags.includes(word) || exampleText.includes(word)) {
          score++;
        }
      });

      return { ...example, score };
    });

    // Filtra exemplos com score > 0 e ordena por score
    const relevant = scored
      .filter(ex => ex.score > 0)
      .sort((a, b) => b.score - a.score);

    // Retorna top max exemplos
    return relevant.slice(0, max);
  }

  // Exporta globalmente
  window.FewShotLearning = FewShotLearning;
  window.pickExamples = pickExamples;

  // Cria instância global
  if (!window.fewShotLearning) {
    window.fewShotLearning = new FewShotLearning();
    window.fewShotLearning.init().then(() => {
      console.log('[FewShotLearning] ✅ Módulo carregado e inicializado');
    });
  }

})();
