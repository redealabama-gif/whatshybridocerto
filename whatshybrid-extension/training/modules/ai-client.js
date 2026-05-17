/**
 * 🤖 WhatsHybrid - AI Client para Training
 * Cliente de IA leve para uso na página de treinamento
 * Faz chamadas diretas para APIs de IA
 * 
 * @version 7.9.13
 */
(function() {
  'use strict';

  class TrainingAIClient {
    constructor() {
      this.config = null;
      this.backendUrl = null;
      this.initialized = false;
    }

    // SECURITY FIX P0-034: Sanitize text to prevent prompt injection
    _sanitizeForPrompt(text, maxLen = 4000) {
      if (!text) return '';
      let clean = String(text);

      // Remove control characters
      clean = clean.replace(/[\x00-\x1F\x7F]/g, '');

      // Dangerous prompt injection patterns
      const dangerousPatterns = [
        /\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|above|prior|earlier)\s*(instructions?|prompts?|rules?|guidelines?)/gi,
        /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as)\b/gi,
        /\b(system\s*:?\s*prompt|new\s+instructions?|jailbreak|bypass)\b/gi,
        /```(system|instruction|prompt)/gi,
        /<\|.*?\|>/g,  // Special tokens
        /\[INST\]|\[\/INST\]/gi  // Instruction tokens
      ];

      dangerousPatterns.forEach(pattern => {
        if (pattern.test(clean)) {
          console.warn('[TrainingAIClient Security] Prompt injection attempt detected and neutralized');
          clean = clean.replace(pattern, '[FILTERED]');
        }
      });

      if (clean.length > maxLen) {
        clean = clean.substring(0, maxLen) + '...';
      }

      return clean.trim();
    }

    async init() {
      if (this.initialized) return;
      
      try {
        // v9.4.6: removido whl_openai_api_key + this.apiKey. Backend-Only AI.
        const data = await this._getStorage([
          'whl_ai_config_v2',
          'whl_backend_url',
          'whl_auth_token',
          'whl_knowledge_base'
        ]);
        
        this.config = data.whl_ai_config_v2 || {};
        if (typeof this.config === 'string') {
          this.config = JSON.parse(this.config);
        }
        
        this.backendUrl = data.whl_backend_url || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000');
        this.authToken = data.whl_auth_token;
        this.knowledgeBase = data.whl_knowledge_base || {};
        
        this.initialized = true;
        console.log('[TrainingAIClient] Inicializado');
      } catch (e) {
        console.error('[TrainingAIClient] Erro ao inicializar:', e);
      }
    }

    async generateResponse(options = {}) {
      await this.init();

      const { messages = [], lastMessage = '', temperature = 0.7 } = options;

      // Recarrega a base de conhecimento a cada chamada — o usuário pode ter
      // editado FAQs/produtos depois do init() e queremos refletir isso.
      try {
        const fresh = await this._getStorage(['whl_knowledge_base']);
        if (fresh.whl_knowledge_base) this.knowledgeBase = fresh.whl_knowledge_base;
      } catch (_) { /* mantém o cache */ }

      // Tentar backend primeiro
      try {
        const backendResponse = await this._callBackend(messages, lastMessage);
        if (backendResponse) return backendResponse;
      } catch (e) {
        console.warn('[TrainingAIClient] Backend indisponível:', e.message);
      }

      // v9.4.4 BUG #118: caminho fallback "OpenAI direto" REMOVIDO.
      // Backend-Only AI (v9.4.0) exige que toda IA passe pelo backend pra
      // debitar tokens. Antes: cliente derrubava backend (firewall local)
      // → fallback usava key dele → bypassava billing.
      // Agora: se backend off-line, retorna fallback contextual local
      // (não consome IA, apenas resposta canned).
      console.warn('[TrainingAIClient] Backend off-line, usando fallback local sem IA');

      // Fallback final - resposta contextual básica
      return this._generateFallback(lastMessage);
    }

    async _callBackend(messages, lastMessage) {
      if (!this.backendUrl) return null;

      // SECURITY FIX P0-034: Sanitize lastMessage to prevent prompt injection
      const safeLastMessage = this._sanitizeForPrompt(lastMessage, 2000);

      // Sem o system prompt construído da base de conhecimento, a IA
      // responde genericamente — perdendo FAQs/produtos/business carregados.
      const systemPrompt = this._buildSystemPrompt();
      const incoming = Array.isArray(messages) ? messages : [];
      const hasSystem = incoming.some(m => m && m.role === 'system');
      const finalMessages = [
        ...(hasSystem || !systemPrompt ? [] : [{ role: 'system', content: systemPrompt }]),
        ...incoming,
        { role: 'user', content: safeLastMessage }
      ];

      // Recarrega o auth token a cada chamada — o SubscriptionManager grava
      // o JWT do master-token de forma assíncrona, então o valor que pegamos
      // no init() pode estar desatualizado.
      const freshAuth = await this._getStorage(['whl_auth_token', 'whl_backend_url']);
      const authToken = freshAuth.whl_auth_token || this.authToken;
      if (freshAuth.whl_backend_url) this.backendUrl = freshAuth.whl_backend_url;

      const response = await fetch(`${this.backendUrl}/api/v1/ai/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({
          messages: finalMessages,
          temperature: 0.7,
          maxTokens: 500,
          context: 'training'
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      return data.content || data.text || data.message;
    }

    // v9.4.6: _callOpenAI_LEGACY_DISABLED REMOVIDO. Backend-Only AI.

    _buildSystemPrompt() {
      // v9.5.2: Prefer the full production prompt builder so simulation matches production behaviour.
      try {
        if (typeof window !== 'undefined'
            && window.knowledgeBase
            && typeof window.knowledgeBase.buildSystemPrompt === 'function') {
          const fullPrompt = window.knowledgeBase.buildSystemPrompt({ persona: 'professional', businessContext: true });
          if (fullPrompt && typeof fullPrompt === 'string' && fullPrompt.length > 0) {
            return fullPrompt;
          }
        }
      } catch (e) {
        console.warn('[TrainingAIClient] knowledgeBase.buildSystemPrompt indisponível, usando fallback:', e?.message);
      }

      const business = this.knowledgeBase.businessInfo || this.knowledgeBase.business || {};
      const faqs = this.knowledgeBase.faqs || this.knowledgeBase.faq || [];
      const products = this.knowledgeBase.products || [];
      const policies = this.knowledgeBase.policies || {};

      let prompt = 'Você é um assistente de atendimento ao cliente treinado para responder de forma profissional e útil.';

      if (business.name) prompt += `\n\nVocê trabalha para: ${business.name}`;
      if (business.description) prompt += `\nSobre o negócio: ${business.description}`;
      if (business.segment) prompt += `\nSegmento: ${business.segment}`;
      if (business.hours) prompt += `\nHorário de atendimento: ${business.hours}`;
      if (business.tone) prompt += `\nTom de comunicação: ${business.tone}`;

      if (policies.payment) prompt += `\nPolítica de Pagamento: ${policies.payment}`;
      if (policies.delivery) prompt += `\nPolítica de Entrega: ${policies.delivery}`;
      if (policies.returns) prompt += `\nPolítica de Trocas/Devoluções: ${policies.returns}`;

      if (faqs.length > 0) {
        prompt += '\n\nFAQs importantes:';
        faqs.slice(0, 10).forEach(faq => {
          prompt += `\n- P: ${faq.question}\n  R: ${faq.answer}`;
        });
      }

      if (products.length > 0) {
        prompt += '\n\nProdutos disponíveis:';
        products.slice(0, 20).forEach(p => {
          prompt += `\n- ${p.name}`;
          if (p.price > 0) prompt += ` — R$ ${Number(p.price).toFixed(2)}`;
          if (p.description) prompt += ` (${p.description})`;
        });
      }

      prompt += '\n\nResponda de forma concisa, profissional e útil. Se não souber algo, seja honesto.';
      return prompt;
    }

    _generateFallback(message) {
      const lower = message.toLowerCase();
      
      // Respostas contextuais básicas
      if (lower.includes('preço') || lower.includes('valor') || lower.includes('quanto')) {
        return 'Posso ajudar com informações sobre preços! Qual produto ou serviço você gostaria de saber mais?';
      }
      if (lower.includes('horário') || lower.includes('funciona') || lower.includes('abre')) {
        return 'Sobre nosso horário de funcionamento, estamos disponíveis para atendimento. Posso ajudar com algo específico?';
      }
      if (lower.includes('obrigad')) {
        return 'Por nada! Fico feliz em ajudar. Precisa de mais alguma coisa?';
      }
      if (lower.includes('oi') || lower.includes('olá') || lower.includes('bom dia') || lower.includes('boa tarde') || lower.includes('boa noite')) {
        return 'Olá! Seja bem-vindo! Como posso ajudá-lo hoje?';
      }
      if (lower.includes('?')) {
        return 'Boa pergunta! Deixe-me verificar isso para você. Pode me dar mais detalhes?';
      }
      
      // Respostas genéricas variadas
      const generic = [
        'Entendi! Pode me contar mais sobre o que você precisa?',
        'Interessante! Como posso ajudá-lo com isso?',
        'Certo, estou aqui para ajudar. O que mais você gostaria de saber?',
        'Compreendo. Posso te ajudar com mais informações sobre isso.',
        'Obrigado por compartilhar! Em que mais posso ser útil?'
      ];
      
      return generic[Math.floor(Math.random() * generic.length)];
    }

    _getStorage(keys) {
      return new Promise(resolve => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get(keys, resolve);
        } else {
          resolve({});
        }
      });
    }
  }

  // Criar instância global e expor como CopilotEngine para compatibilidade
  const client = new TrainingAIClient();
  
  // Expor interface compatível com CopilotEngine
  window.CopilotEngine = {
    generateResponse: async (options) => {
      const text = await client.generateResponse(options);
      return { text, content: text };
    }
  };
  
  // Expor também como AIService
  window.AIService = {
    complete: async (options) => {
      const text = await client.generateResponse(options);
      return { text, content: text };
    }
  };

  window.TrainingAIClient = client;
  
  console.log('[TrainingAIClient] ✅ Carregado e exposto como CopilotEngine/AIService');
})();
