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
      // Também propaga pro window.knowledgeBase quando carregado, senão o
      // buildSystemPromptRAG/checkCannedReply ficam com snapshot estale do
      // init() inicial enquanto o training.js já gravou versão nova.
      try {
        const fresh = await this._getStorage(['whl_knowledge_base']);
        if (fresh.whl_knowledge_base) {
          this.knowledgeBase = fresh.whl_knowledge_base;
          if (typeof window !== 'undefined' && window.knowledgeBase) {
            window.knowledgeBase.knowledge = fresh.whl_knowledge_base;
          }
        }
      } catch (_) { /* mantém o cache */ }

      // STEP 0: Canned reply (match exato por trigger). Cobre saudações
      // pré-cadastradas + atalhos fixos do usuário sem consumir IA/tokens.
      try {
        if (typeof window !== 'undefined' && window.knowledgeBase?.checkCannedReply) {
          const canned = window.knowledgeBase.checkCannedReply(lastMessage);
          if (canned && typeof canned === 'string' && canned.trim()) {
            return canned;
          }
        } else {
          // Fallback inline quando knowledge-base.js não está carregado nesta página.
          const cannedReplies = (this.knowledgeBase && this.knowledgeBase.cannedReplies) || [];
          const msgLower = (lastMessage || '').toLowerCase().trim();
          for (const c of cannedReplies) {
            const triggers = Array.isArray(c.triggers) ? c.triggers : (c.trigger ? [c.trigger] : []);
            if (triggers.some(t => t && msgLower.includes(String(t).toLowerCase()))) {
              const reply = c.reply || c.response;
              if (reply) return reply;
            }
          }
        }
      } catch (e) {
        console.warn('[TrainingAIClient] checkCannedReply falhou:', e?.message);
      }

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
      // RAG-aware: quando knowledgeBase + WHLLocalRAG estão prontos, monta
      // o prompt usando busca semântica (só os trechos relevantes à pergunta),
      // o que melhora qualidade e economiza tokens. Fallback automático para
      // o builder estático quando RAG não tá indexado.
      const systemPrompt = await this._buildSystemPromptAsync(safeLastMessage);

      // Few-shot: pegamos exemplos aprovados/editados do
      // whl_few_shot_examples — esses VÊM do feedback de produção
      // (recordSupervisedSample emite pra fewShotLearning.addExample), então
      // injetar aqui é o que faz o aprendizado "fechar o ciclo" para a
      // simulação. Se window.fewShotLearning existir, usa o picker
      // sinônimo-aware/quality-weighted; caso contrário lê o storage cru.
      const fewShotPairs = await this._collectFewShotExamples(safeLastMessage, 4);

      const incoming = Array.isArray(messages) ? messages : [];
      const hasSystem = incoming.some(m => m && m.role === 'system');
      const finalMessages = [
        ...(hasSystem || !systemPrompt ? [] : [{ role: 'system', content: systemPrompt }]),
        ...fewShotPairs,
        ...incoming,
        { role: 'user', content: safeLastMessage }
      ];

      // Recarrega o auth token a cada chamada — o SubscriptionManager grava
      // o JWT do master-token de forma assíncrona, então o valor que pegamos
      // no init() pode estar desatualizado.
      const freshAuth = await this._getStorage(['whl_auth_token', 'whl_backend_url']);
      const authToken = freshAuth.whl_auth_token || this.authToken;
      if (freshAuth.whl_backend_url) this.backendUrl = freshAuth.whl_backend_url;

      const requestBody = JSON.stringify({
        messages: finalMessages,
        temperature: 0.7,
        maxTokens: 500,
        context: 'training'
      });

      const doFetch = (token) => fetch(`${this.backendUrl}/api/v1/ai/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: requestBody
      });

      let response = await doFetch(authToken);

      // 401 = JWT expirado ou ausente. Tenta refresh via SubscriptionManager
      // (que reativa master key OU usa refresh token) e refaz a chamada uma vez.
      if (response.status === 401) {
        let refreshedToken = null;
        try {
          if (typeof window !== 'undefined' && window.SubscriptionManager?.refreshBackendJWT) {
            refreshedToken = await window.SubscriptionManager.refreshBackendJWT();
          } else if (typeof window !== 'undefined' && window.BackendClient?.refreshToken) {
            const r = await window.BackendClient.refreshToken();
            refreshedToken = r?.accessToken || r?.token || null;
          }
          if (!refreshedToken) {
            const data = await this._getStorage(['whl_auth_token']);
            refreshedToken = data.whl_auth_token || null;
          }
        } catch (e) {
          console.warn('[TrainingAIClient] refresh do JWT falhou:', e?.message || e);
        }
        if (refreshedToken && refreshedToken !== authToken) {
          this.authToken = refreshedToken;
          response = await doFetch(refreshedToken);
        }
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      return data.content || data.text || data.message;
    }

    // v9.4.6: _callOpenAI_LEGACY_DISABLED REMOVIDO. Backend-Only AI.

    /**
     * RAG-first prompt builder. Quando WHLLocalRAG está pronto, recupera
     * top-K trechos semanticamente relevantes à query; fallback para o
     * builder estático/sync.
     */
    async _buildSystemPromptAsync(query) {
      try {
        if (typeof window !== 'undefined'
            && window.knowledgeBase
            && typeof window.knowledgeBase.buildSystemPromptRAG === 'function'
            && query) {
          const ragPrompt = await window.knowledgeBase.buildSystemPromptRAG(query, {
            topK: 5,
            persona: 'professional',
            businessContext: true
          });
          if (ragPrompt && typeof ragPrompt === 'string' && ragPrompt.length > 0) {
            return ragPrompt;
          }
        }
      } catch (e) {
        console.warn('[TrainingAIClient] buildSystemPromptRAG falhou, usando builder síncrono:', e?.message);
      }
      return this._buildSystemPrompt();
    }

    /**
     * Coleta few-shot examples aprovados/editados do whl_few_shot_examples.
     * Esses exemplos vêm do feedback supervisionado (training UI + autopilot),
     * então injetá-los aqui é o que faz o aprendizado retroalimentar a
     * simulação. Retorna no formato OpenAI messages alternados user/assistant.
     */
    async _collectFewShotExamples(query, max = 4) {
      try {
        let examples = [];

        // Preferência 1: módulo carregado com picker keyword/quality/recency.
        if (typeof window !== 'undefined' && window.fewShotLearning) {
          // O training UI grava direto em whl_few_shot_examples (storage),
          // mas o módulo fica com snapshot do init(). Força reload pra pegar
          // os exemplos novos antes de pickRelevantExamples rodar.
          try {
            if (typeof window.fewShotLearning.init === 'function') {
              window.fewShotLearning.initialized = false;
              await window.fewShotLearning.init();
            }
          } catch (_) { /* segue com snapshot */ }

          if (typeof window.fewShotLearning.pickRelevantExamples === 'function') {
            const scored = window.fewShotLearning.pickRelevantExamples(query || '', max);
            examples = scored.map(s => (s && s.example) ? s.example : s).filter(Boolean);
          } else if (typeof window.fewShotLearning.getAll === 'function') {
            examples = window.fewShotLearning.getAll().slice(0, max);
          }
        }

        // Preferência 2: ler direto do storage (módulo não carregado nesta página).
        if (!examples.length) {
          const data = await this._getStorage(['whl_few_shot_examples']);
          let raw = data.whl_few_shot_examples;
          if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (_) { raw = []; }
          }
          if (Array.isArray(raw) && raw.length) {
            // Scoring inline: keyword overlap (simples) × recency boost. Sem
            // depender do módulo full carregado. Pega os mais relevantes —
            // e na falta de match, os mais recentes.
            const qLower = (query || '').toLowerCase();
            const qWords = new Set(qLower.split(/\W+/).filter(w => w.length >= 4));
            const now = Date.now();
            const scored = raw.map(ex => {
              const userText = String(ex.user || ex.input || ex.question || ex.pergunta || '').toLowerCase();
              const userWords = userText.split(/\W+/).filter(w => w.length >= 4);
              let overlap = 0;
              for (const w of userWords) if (qWords.has(w)) overlap++;
              const ageDays = ex.createdAt ? Math.max(0, (now - ex.createdAt) / 86400000) : 30;
              const recency = Math.max(0.4, 1 - ageDays / 180);
              const quality = Number(ex.quality) || 9;
              return { ex, score: overlap * (quality >= 10 ? 1.5 : 1) * recency };
            });
            scored.sort((a, b) => b.score - a.score);
            const top = scored.slice(0, max).map(s => s.ex);
            // Se nenhum bateu, ainda assim devolve os mais recentes pra dar
            // contexto de estilo/persona ao LLM.
            examples = top.some(t => t) ? top : raw.slice(-max);
          }
        }

        if (!examples.length) return [];

        // Converte cada exemplo em par (user, assistant). Suporta os dois
        // schemas que aparecem no código: { user, assistant } (few-shot-learning)
        // e { input, output } (training UI).
        const pairs = [];
        for (const ex of examples) {
          if (!ex) continue;
          const userText = ex.user || ex.input || ex.question || ex.pergunta;
          const assistantText = ex.assistant || ex.output || ex.answer || ex.resposta;
          if (!userText || !assistantText) continue;
          pairs.push({ role: 'user', content: this._sanitizeForPrompt(String(userText), 800) });
          pairs.push({ role: 'assistant', content: this._sanitizeForPrompt(String(assistantText), 800) });
        }
        return pairs;
      } catch (e) {
        console.warn('[TrainingAIClient] _collectFewShotExamples falhou:', e?.message);
        return [];
      }
    }

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
