/**
 * 🎯 HybridIntentClassifier - Sistema Híbrido de Classificação de Intenções
 * WhatsHybrid Pro v7.9.13 - Extension Version
 * 
 * Estratégia de classificação em camadas:
 * 1. Regex rápido (gratuito) - retorna se confiança > 0.8
 * 2. Cache LRU (2000 entradas) - verificar classificações anteriores
 * 3. LLM focado (pago) - apenas se ambíguo, com prompt específico
 * 4. Fallback para regex - se LLM falhar
 * 
 * Diferenças da versão Extension:
 * - Usa chrome.storage.local para persistir cache
 * - Usa AIGateway para chamadas LLM (ao invés de OpenAI direto)
 * - IIFE pattern com export para window.HybridIntentClassifier
 * - Cache sincronizado entre sessões
 * 
 * @module HybridIntentClassifier
 * @version 1.0.0
 */

(function() {
  'use strict';

  /**
   * Intenções suportadas com descrições
   */
  const INTENTS = {
    greeting: 'Saudação inicial ou cumprimento (oi, olá, bom dia)',
    question: 'Pergunta ou dúvida (como, quando, onde, qual, por que)',
    purchase: 'Interesse em compra ou produto (quero comprar, preço, valor)',
    support: 'Pedido de ajuda ou suporte técnico (ajuda, problema, não funciona)',
    complaint: 'Reclamação ou insatisfação (péssimo, horrível, problema sério)',
    schedule: 'Agendamento ou marcação (agendar, marcar, horário disponível)',
    pricing: 'Informação sobre preços (quanto custa, tabela de preços)',
    feedback: 'Avaliação ou feedback (obrigado, excelente, gostei)',
    goodbye: 'Despedida ou encerramento (tchau, até logo, adeus)',
    negotiation: 'Negociação ou desconto (desconto, promoção, negociar)',
    urgency: 'Urgência ou prioridade (urgente, emergência, imediato)',
    thanks: 'Agradecimento (obrigado, valeu, muito obrigado)',
    confirmation: 'Confirmação positiva (sim, ok, certo, pode ser)',
    negation: 'Negação ou recusa (não, nunca, de jeito nenhum)',
    cancellation: 'Cancelamento (cancelar, desistir, desfazer)',
    information: 'Solicitação de informações gerais (informação, horário, endereço)'
  };

  /**
   * Padrões regex para classificação rápida
   */
  const REGEX_PATTERNS = {
    greeting: [
      /^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite|e ai|eai|fala|opa)/i,
      /^(tudo bem|como vai|beleza)/i
    ],
    goodbye: [
      /^(tchau|até|ate|bye|adeus|falou|flw|vlw)/i,
      /(até mais|ate mais|até logo|até breve)/i
    ],
    question: [
      /\?$/,
      /^(como|qual|quando|onde|por ?que|quem|o que|cade|cadê)/i,
      /(pode|poderia|consegue|sabe|tem como)/i
    ],
    complaint: [
      /(problema|erro|bug|não funciona|nao funciona|travou|parou)/i,
      /(péssimo|pessimo|horrível|horrivel|absurdo|inadmissível|inadmissivel)/i,
      /(reclamação|reclamacao|insatisfeito|decepcionado)/i
    ],
    urgency: [
      /(urgente|urgência|urgencia|emergência|emergencia|imediato)/i,
      /(preciso agora|não pode esperar|crítico|critico)/i,
      /(socorro|help|asap)/i
    ],
    purchase: [
      /(quero|queria|gostaria|interesse|comprar)/i,
      /(tem disponível|tem disponivel|tem estoque|disponibilidade)/i
      // Removed generic \bquero\b to avoid false positives
    ],
    pricing: [
      /(preço|preco|valor|quanto custa|tabela)/i,
      /(custo|investimento|quanto é|quanto fica)/i,
      /quanto.*produto/i,
      /quanto.*serviço/i,
      /\bquanto\b/i  // Generic quanto - lower priority but still matches
    ],
    support: [
      /(ajuda|suporte|assistência|assistencia)/i,
      /(como faço|como faz|não sei|nao sei|não consigo|nao consigo)/i,
      /(configurar|instalar|atualizar|resetar)/i
    ],
    schedule: [
      /(agendar|marcar|horário|horario|disponível|disponivel|agenda)/i,
      /(data|dia|semana|mês|mes|próximo|proximo)/i
    ],
    feedback: [
      /(obrigad[oa]|muito obrigad[oa]|agradeço|agradeco)/i,
      /(excelente|ótimo|otimo|maravilhoso|perfeito|top|legal)/i
    ],
    negotiation: [
      /(desconto|promoção|promocao|oferta|negociar)/i,
      /(mais barato|reduzir|abaixar|cupom)/i
    ],
    thanks: [
      /(obrigad[oa]|valeu|vlw|thanks|thank you)/i,
      /(agradeço|agradeco|grato|grata)/i,
      /obrigad.*(ajuda|atenção|atencao)/i
    ],
    confirmation: [
      /pode confirmar/i,  // Very specific - check first
      /^sim.*confirmar/i,
      /^(sim|ok|okay|certo|correto|isso|exato|confirmo|confirmado)$/i,
      /^(pode ser|tá|ta|beleza|blz|perfeito|combinado)$/i
    ],
    negation: [
      /(não|nao) quero mais/i,  // Very specific - check first
      /^(não|nao|nunca|negativo|nope|no)$/i,
      /^(de jeito nenhum|nem pensar|não quero|nao quero)$/i
    ],
    cancellation: [
      /(cancelar|cancelamento|desistir|desistência|desistencia)/i,
      /(não quero mais|nao quero mais|desfazer)/i,
      /(estornar|estorno|reembolso|devolver)/i
    ],
    information: [
      /(informação|informacao|saber|conhecer)/i,
      /(horário|horario|endereço|endereco|localização|localizacao)/i,
      /(funciona|abre|fecha|atende)/i
    ]
  };

  const STORAGE_KEY = 'whl_hybrid_intent_cache';

  /**
   * LRU Cache para armazenar classificações LLM
   * Sincroniza com chrome.storage.local para persistência
   */
  class LRUCache {
    constructor(maxSize = 2000) {
      this.maxSize = maxSize;
      this.cache = new Map();
      this.initialized = false;
    }

    /**
     * Carrega cache do storage
     */
    async init() {
      if (this.initialized) return;
      
      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          const entries = JSON.parse(data[STORAGE_KEY]);
          this.cache = new Map(entries);
          console.log(`[HybridIntentClassifier] Cache carregado: ${this.cache.size} entradas`);
        }
      } catch (error) {
        console.warn('[HybridIntentClassifier] Erro ao carregar cache:', error);
      }
      
      this.initialized = true;
    }

    /**
     * Persiste cache no storage
     */
    async persist() {
      try {
        const entries = Array.from(this.cache.entries());
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(entries)
        });
      } catch (error) {
        console.warn('[HybridIntentClassifier] Erro ao persistir cache:', error);
      }
    }

    get(key) {
      if (!this.cache.has(key)) return null;
      
      // Move para o final (mais recente)
      const value = this.cache.get(key);
      this.cache.delete(key);
      this.cache.set(key, value);
      
      return value;
    }

    async set(key, value) {
      // Remove se já existe
      if (this.cache.has(key)) {
        this.cache.delete(key);
      }
      
      // Adiciona ao final
      this.cache.set(key, value);
      
      // Remove o mais antigo se exceder tamanho
      if (this.cache.size > this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }

      // Persiste a cada 10 escritas (para performance)
      if (this.cache.size % 10 === 0) {
        await this.persist();
      }
    }

    has(key) {
      return this.cache.has(key);
    }

    async clear() {
      this.cache.clear();
      await this.persist();
    }

    get size() {
      return this.cache.size;
    }
  }

  /**
   * Classificador Híbrido de Intenções
   */
  class HybridIntentClassifier {
    constructor(config = {}) {
      this.cache = new LRUCache(config.cacheSize || 2000);
      this.stats = { regex: 0, llm: 0, cached: 0 };
      this.confidenceThreshold = config.confidenceThreshold || 0.8;
      this.initialized = false;
      
      this.llmConfig = {
        provider: 'openai',
        model: config.llmModel || 'gpt-4o-mini',
        temperature: 0.1, // Baixa para classificação consistente
        maxTokens: 150
      };
    }

    /**
     * Inicializa o classificador (carrega cache)
     */
    async init() {
      if (this.initialized) return;
      
      await this.cache.init();
      this.initialized = true;
      
      console.log('[HybridIntentClassifier] Inicializado');
    }

    /**
     * Classifica intenção usando regex (rápido, gratuito)
     * @param {string} message - Mensagem a classificar
     * @returns {{ intent: string, confidence: number, matchedPatterns: number }}
     */
    classifyWithRegex(message) {
      const lowerMessage = message.toLowerCase().trim();
      const results = [];

      for (const [intent, patterns] of Object.entries(REGEX_PATTERNS)) {
        let matches = 0;
        let totalScore = 0;

        for (const pattern of patterns) {
          if (pattern.test(message)) {
            matches++;
            // Padrões mais específicos têm maior peso
            totalScore += pattern.source.length;
          }
        }

        if (matches > 0) {
          results.push({
            intent,
            matches,
            score: totalScore
          });
        }
      }

      if (results.length === 0) {
        return { intent: 'information', confidence: 0.3, matchedPatterns: 0 };
      }

      // Ordena por score primeiro (especificidade), depois por matches
      results.sort((a, b) => {
        // Priorizar score total (especificidade dos patterns)
        if (b.score !== a.score) return b.score - a.score;
        // Em caso de empate, número de matches
        return b.matches - a.matches;
      });

      const best = results[0];
      
      // Calcular confiança baseada em:
      // - Número de matches
      // - Especificidade dos patterns
      // - Diferença entre melhor e segundo melhor
      let confidence = 0.5 + (best.matches * 0.15);
      
      if (results.length > 1) {
        const secondBest = results[1];
        const gap = best.score - secondBest.score;
        confidence += Math.min(gap / 100, 0.3);
      } else {
        confidence += 0.3; // Único match tem alta confiança
      }

      confidence = Math.min(confidence, 0.95);

      return {
        intent: best.intent,
        confidence: Math.round(confidence * 100) / 100,
        matchedPatterns: best.matches
      };
    }

    /**
     * Classifica intenção usando LLM (lento, pago, preciso)
     * Usa AIGateway para fazer a chamada
     * @param {string} message - Mensagem a classificar
     * @param {object} context - Contexto da conversa
     * @param {object} regexHint - Dica do classificador regex
     * @returns {Promise<{ intent: string, confidence: number }>}
     */
    async classifyWithLLM(message, context = {}, regexHint = null) {
      if (!window.AIGateway) {
        throw new Error('AIGateway não disponível');
      }

      const intentsList = Object.entries(INTENTS)
        .map(([id, desc]) => `- ${id}: ${desc}`)
        .join('\n');

      const prompt = `Classifique a intenção da seguinte mensagem em uma das categorias abaixo.

MENSAGEM: "${message}"

CONTEXTO DA CONVERSA:
${context.previousIntent ? `- Intenção anterior: ${context.previousIntent}` : '- Primeira mensagem'}
${context.conversationSummary ? `- Resumo: ${context.conversationSummary}` : ''}

${regexHint ? `DICA (análise regex): A mensagem pode ser "${regexHint.intent}" (confiança: ${regexHint.confidence})` : ''}

INTENÇÕES POSSÍVEIS:
${intentsList}

RESPONDA NO FORMATO JSON:
{
  "intent": "nome_da_intencao",
  "confidence": 0.95,
  "reasoning": "breve explicação"
}`;

      try {
        const response = await window.AIGateway.complete({
          messages: [
            { role: 'system', content: 'Você é um classificador de intenções especializado. Responda apenas com JSON válido.' },
            { role: 'user', content: prompt }
          ],
          ...this.llmConfig
        });

        const content = response.content.trim();
        
        // Extrair JSON da resposta
        let jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('LLM não retornou JSON válido');
        }

        const result = JSON.parse(jsonMatch[0]);
        
        // Validar intent
        if (!INTENTS[result.intent]) {
          console.warn(`[HybridIntentClassifier] LLM retornou intent inválido: ${result.intent}, usando fallback`);
          return regexHint || { intent: 'information', confidence: 0.5 };
        }

        return {
          intent: result.intent,
          confidence: Math.min(result.confidence || 0.9, 0.99),
          reasoning: result.reasoning
        };

      } catch (error) {
        console.error('[HybridIntentClassifier] Erro no LLM:', error.message);
        throw error;
      }
    }

    /**
     * Classifica intenção com estratégia híbrida
     * @param {string} message - Mensagem a classificar
     * @param {object} context - Contexto da conversa
     * @returns {Promise<{ intent: string, confidence: number, source: string }>}
     */
    async classify(message, context = {}) {
      // Garantir inicialização
      if (!this.initialized) {
        await this.init();
      }

      if (!message || typeof message !== 'string') {
        throw new Error('Mensagem inválida');
      }

      const normalizedMessage = message.trim();
      if (!normalizedMessage) {
        throw new Error('Mensagem vazia');
      }

      // 1. Tentar regex primeiro (FAST PATH)
      const regexResult = this.classifyWithRegex(normalizedMessage);
      
      if (regexResult.confidence > this.confidenceThreshold) {
        this.stats.regex++;
        return {
          intent: regexResult.intent,
          confidence: regexResult.confidence,
          source: 'regex'
        };
      }

      // 2. Verificar cache (MEDIUM PATH)
      const cacheKey = `${normalizedMessage}|${context.previousIntent || ''}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached) {
        this.stats.cached++;
        return {
          ...cached,
          source: 'cached'
        };
      }

      // 3. Usar LLM para casos ambíguos (SLOW PATH)
      try {
        const llmResult = await this.classifyWithLLM(
          normalizedMessage,
          context,
          regexResult
        );
        
        this.stats.llm++;
        
        // Cachear resultado
        await this.cache.set(cacheKey, {
          intent: llmResult.intent,
          confidence: llmResult.confidence
        });
        
        return {
          intent: llmResult.intent,
          confidence: llmResult.confidence,
          source: 'llm',
          reasoning: llmResult.reasoning
        };
        
      } catch (error) {
        // 4. FALLBACK: usar resultado do regex mesmo com baixa confiança
        console.warn('[HybridIntentClassifier] LLM falhou, usando fallback regex:', error.message);
        this.stats.regex++;
        
        return {
          intent: regexResult.intent,
          confidence: regexResult.confidence * 0.8, // Penalizar confiança
          source: 'regex_fallback'
        };
      }
    }

    /**
     * Retorna estatísticas de uso
     * @returns {{ regex: number, llm: number, cached: number, total: number, cacheSize: number }}
     */
    getStats() {
      const total = this.stats.regex + this.stats.llm + this.stats.cached;
      
      return {
        ...this.stats,
        total,
        cacheSize: this.cache.size,
        regexPercentage: total > 0 ? Math.round((this.stats.regex / total) * 100) : 0,
        cachedPercentage: total > 0 ? Math.round((this.stats.cached / total) * 100) : 0,
        llmPercentage: total > 0 ? Math.round((this.stats.llm / total) * 100) : 0
      };
    }

    /**
     * Reseta estatísticas
     */
    resetStats() {
      this.stats = { regex: 0, llm: 0, cached: 0 };
    }

    /**
     * Limpa cache
     */
    async clearCache() {
      await this.cache.clear();
    }

    /**
     * Lista todas as intenções suportadas
     * @returns {object}
     */
    static getIntents() {
      return { ...INTENTS };
    }
  }

  // Export to window
  window.HybridIntentClassifier = HybridIntentClassifier;
  
  console.log('[HybridIntentClassifier] Module loaded');

})();
