/**
 * 🤖 CopilotEngine v1.0 - Motor de Copilot Enterprise
 * Sistema inteligente de assistência conversacional
 * 
 * TODO: AUDIT-NEW-018 (P3) - i18n AI Prompts
 * This module has hardcoded Portuguese AI prompts that should be internationalized.
 * See: docs/internal/PEND-MED-003-I18N-AI-PROMPTS-FIX.md for full implementation guide.
 * Lines affected: 139-213 (PERSONAS definitions)
 * 
 * Features:
 * - Context-aware responses
 * - Multi-turn conversations
 * - Intent detection & routing
 * - Sentiment analysis
 * - Entity extraction
 * - Conversation summarization
 * - Auto-suggestions
 * - Learning from feedback
 * - Templates & macros
 * - Response scoring
 * - A/B testing support
 * - Personality profiles
 * - Knowledge base integration
 * - RAG (Retrieval Augmented Generation)
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  // Cleanup de MutationObserver (evita leaks em reloads/tabs longas)
  let chatChangeObserver = null;
  let chatObserverTimeout = null;
  let chatObserverCleanupRegistered = false;

  // ============================================
  // v7.5.0 - INTEGRAÇÃO COM HUMAN TYPING
  // ============================================
  async function insertTextWithHumanTyping(element, text) {
    if (window.HumanTyping && typeof window.HumanTyping.type === 'function') {
      try {
        console.log('[CopilotEngine] Usando HumanTyping para digitação natural');
        await window.HumanTyping.type(element, text, { minDelay: 25, maxDelay: 60 });
        return true;
      } catch (e) {
        console.warn('[CopilotEngine] HumanTyping falhou, usando fallback:', e.message);
      }
    }
    
    // Fallback: execCommand
    element.focus();
    document.execCommand('insertText', false, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  const CONFIG = {
    STORAGE_KEY: 'whl_copilot_engine',
    MAX_CONTEXT_MESSAGES: 20,
    MAX_CONTEXT_TOKENS: 8000,
    SUGGESTION_COUNT: 3,
    MIN_CONFIDENCE_SCORE: 0.6,
    AUTO_RESPONSE_DELAY: 2000,
    TYPING_SIMULATION_SPEED: 30, // ms per character
    FEEDBACK_LEARNING_THRESHOLD: 10,
    KNOWLEDGE_BASE_MAX_RESULTS: 5,
    MIN_MESSAGES_FOR_COMPLETION: 4, // AI-006: Minimum messages to consider conversation complete
    
    // ============================================
    // 🚨 v7.9.13 - BACKEND CONFIGURATION
    // ============================================
    FORCE_BACKEND: true,           // Backend é OBRIGATÓRIO, não opcional
    DISABLE_LOCAL_FALLBACK: false, // AI-009 FIX: Enable local fallback for resilience (graceful degradation)
    SHOW_BACKEND_ERRORS: true,     // Mostra erros claros quando backend falha
    BACKEND_TIMEOUT_MS: 15000      // Timeout antes de declarar backend indisponível
  };

  // ============================================
  // MODOS DE OPERAÇÃO
  // v7.5.0: Removed PASSIVE and AUTO_DRAFT modes
  // ============================================
  const MODES = {
    OFF: { id: 'off', name: '🔴 Desativado', description: 'Copilot desativado' },
    SUGGEST: { id: 'suggest', name: '💡 Sugestões', description: 'Mostra sugestões de resposta' },
    // Mantemos apenas modos que NÃO enviam mensagens automaticamente.
    // O Copiloto com execução real (score gate) continua existindo na aba dedicada.
  };

  /**
   * Normaliza modos antigos/indesejados.
   * 
   * ✅ v7.9.12: Removido o modo FULL_AUTO ("Automático - Responde sozinho") do Sidepanel.
   * Para manter compatibilidade com estados antigos, convertemos para SEMI_AUTO.
   */
  function normalizeMode(mode) {
    if (!mode) return MODES.SUGGEST.id;
    // Qualquer modo legado vira Sugestão (não existe mais auto/semi-auto/assist)
    if (mode === 'full_auto' || mode === 'semi_auto' || mode === 'assist') {
      return MODES.SUGGEST.id;
    }
    if (mode !== MODES.OFF.id && mode !== MODES.SUGGEST.id) {
      return MODES.SUGGEST.id;
    }
    return mode;
  }

  // ============================================
  // INTENTS (Intenções detectadas)
  // ============================================
  const INTENTS = {
    GREETING: { id: 'greeting', name: 'Saudação', priority: 1, patterns: ['olá', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'eae'] },
    FAREWELL: { id: 'farewell', name: 'Despedida', priority: 1, patterns: ['tchau', 'até mais', 'até logo', 'adeus', 'flw', 'falou'] },
    QUESTION: { id: 'question', name: 'Pergunta', priority: 2, patterns: ['?', 'como', 'quando', 'onde', 'qual', 'quanto', 'quem', 'por que'] },
    COMPLAINT: { id: 'complaint', name: 'Reclamação', priority: 3, patterns: ['problema', 'reclamar', 'insatisfeito', 'péssimo', 'horrível', 'não funciona'] },
    HOSTILE: { id: 'hostile', name: 'Hostilidade', priority: 4, patterns: [
      'tomar no cu', 'vai se foder', 'foda-se', 'vai tomar', 'vai pro inferno', 
      'idiota', 'imbecil', 'burro', 'otário', 'babaca', 'cretino',
      'merda', 'bosta', 'porra', 'caralho', 'fdp', 'pqp', 'vsf', 'vtnc',
      'filho da puta', 'desgraça', 'maldito', 'some daqui', 'cala boca'
    ]},
    PURCHASE: { id: 'purchase', name: 'Compra', priority: 2, patterns: ['comprar', 'preço', 'valor', 'quanto custa', 'pagar', 'pix', 'cartão'] },
    SUPPORT: { id: 'support', name: 'Suporte', priority: 2, patterns: ['ajuda', 'suporte', 'problema', 'erro', 'não consigo', 'bug'] },
    INFO: { id: 'info', name: 'Informação', priority: 2, patterns: ['informação', 'saber', 'detalhes', 'sobre', 'mais'] },
    CONFIRMATION: { id: 'confirmation', name: 'Confirmação', priority: 1, patterns: ['ok', 'certo', 'entendi', 'sim', 'pode ser', 'fechado'] },
    NEGATION: { id: 'negation', name: 'Negação', priority: 1, patterns: ['não', 'nao', 'nunca', 'nem', 'negativo'] },
    URGENCY: { id: 'urgency', name: 'Urgência', priority: 3, patterns: ['urgente', 'urgência', 'agora', 'imediato', 'rápido', 'emergência'] },
    SCHEDULE: { id: 'schedule', name: 'Agendamento', priority: 2, patterns: ['agendar', 'marcar', 'horário', 'disponível', 'agenda'] },
    FEEDBACK: { id: 'feedback', name: 'Feedback', priority: 2, patterns: ['obrigado', 'gostei', 'excelente', 'ótimo', 'parabéns', 'top'] }
  };

  // ============================================
  // PERSONAS (Perfis de personalidade)
  // ============================================
  const DEFAULT_PERSONAS = {
    professional: {
      id: 'professional',
      name: '👔 Profissional',
      description: 'Formal, objetivo e educado',
      temperature: 0.5,
      maxTokens: 300,
      systemPrompt: `Você é um assistente profissional de atendimento ao cliente.
Diretrizes:
- Mantenha um tom formal e educado
- Seja objetivo e direto nas respostas
- Use linguagem clara e acessível
- Sempre ofereça ajuda adicional
- Evite gírias e expressões informais
- Responda em português brasileiro`
    },
    friendly: {
      id: 'friendly',
      name: '😊 Amigável',
      description: 'Descontraído e acolhedor',
      temperature: 0.7,
      maxTokens: 350,
      systemPrompt: `Você é um assistente amigável e acolhedor.
Diretrizes:
- Use um tom descontraído mas respeitoso
- Pode usar emojis ocasionalmente (com moderação)
- Seja empático e demonstre compreensão
- Crie conexão com o cliente
- Mantenha a conversa leve mas profissional`
    },
    sales: {
      id: 'sales',
      name: '💼 Vendas',
      description: 'Persuasivo e focado em conversão',
      temperature: 0.7,
      maxTokens: 400,
      systemPrompt: `Você é um vendedor experiente e consultivo.
Diretrizes:
- Destaque benefícios e valor do produto/serviço
- Use técnicas de persuasão éticas
- Identifique necessidades do cliente
- Crie senso de oportunidade (sem pressão excessiva)
- Responda objeções de forma positiva
- Sempre busque fechar a venda ou próximo passo`
    },
    support: {
      id: 'support',
      name: '🛠️ Suporte Técnico',
      description: 'Técnico e solucionador',
      temperature: 0.4,
      maxTokens: 500,
      systemPrompt: `Você é um especialista em suporte técnico.
Diretrizes:
- Forneça soluções claras e passo a passo
- Use linguagem técnica quando necessário, mas explique termos
- Seja paciente e detalhado
- Confirme o entendimento do problema antes de responder
- Sempre verifique se o problema foi resolvido
- Documente casos recorrentes`
    },
    concierge: {
      id: 'concierge',
      name: '🎩 Concierge',
      description: 'Luxo e exclusividade',
      temperature: 0.6,
      maxTokens: 350,
      systemPrompt: `Você é um concierge de alto padrão.
Diretrizes:
- Trate cada cliente como VIP
- Use linguagem sofisticada e elegante
- Antecipe necessidades
- Ofereça soluções personalizadas
- Demonstre conhecimento exclusivo
- Mantenha discrição e profissionalismo`
    },
    coach: {
      id: 'coach',
      name: '🏆 Coach',
      description: 'Motivador e orientador',
      temperature: 0.7,
      maxTokens: 400,
      systemPrompt: `Você é um coach motivacional e orientador.
Diretrizes:
- Inspire e motive o cliente
- Faça perguntas poderosas
- Ajude a identificar objetivos
- Celebre conquistas
- Ofereça perspectivas diferentes
- Encoraje ação e comprometimento`
    }
  };

  // ============================================
  // KNOWLEDGE BASE (Base de conhecimento)
  // ============================================
  const DEFAULT_KNOWLEDGE_BASE = {
    faqs: [
      { q: 'Qual o horário de atendimento?', a: 'Nosso atendimento funciona de segunda a sexta, das 9h às 18h.', tags: ['horário', 'atendimento'] },
      { q: 'Como faço para cancelar?', a: 'Para cancelar, acesse sua conta ou entre em contato conosco.', tags: ['cancelar', 'cancelamento'] },
      { q: 'Quais formas de pagamento?', a: 'Aceitamos PIX, cartão de crédito (até 12x) e boleto.', tags: ['pagamento', 'pix', 'cartão'] },
      { q: 'Qual o prazo de entrega?', a: 'O prazo de entrega varia de 3 a 10 dias úteis dependendo da região.', tags: ['prazo', 'entrega'] }
    ],
    products: [],
    policies: [],
    custom: []
  };

  // ============================================
  // TEMPLATES DE RESPOSTA
  // ============================================
  const RESPONSE_TEMPLATES = {
    greeting: [
      'Olá! Como posso ajudar você hoje?',
      'Oi! Tudo bem? Em que posso ajudar?',
      'Olá! Seja bem-vindo(a)! Como posso ajudar?'
    ],
    farewell: [
      'Foi um prazer atendê-lo(a)! Tenha um ótimo dia! 😊',
      'Obrigado pelo contato! Estamos à disposição.',
      'Até mais! Se precisar, é só chamar!'
    ],
    wait: [
      'Um momento, por favor. Estou verificando...',
      'Deixa eu conferir isso para você...',
      'Aguarde um instante enquanto busco essa informação...'
    ],
    notUnderstood: [
      'Desculpe, não entendi bem. Pode reformular?',
      'Pode me dar mais detalhes sobre isso?',
      'Não tenho certeza se entendi. Poderia explicar melhor?'
    ],
    transfer: [
      'Vou transferir você para um especialista que pode ajudar melhor.',
      'Um momento, vou conectar você com nosso time especializado.',
      'Entendo. Deixa eu direcionar para quem pode resolver isso.'
    ],
    hostile: [
      'Entendo que você está frustrado(a). Vamos resolver isso juntos. Como posso ajudar?',
      'Percebo sua insatisfação e peço desculpas por qualquer inconveniente. O que aconteceu?',
      'Lamento que você esteja passando por isso. Estou aqui para ajudar a resolver.',
      'Compreendo sua frustração. Vamos focar em encontrar uma solução. O que precisa?',
      'Sinto muito por essa situação. Me conte o que aconteceu para eu poder ajudar.'
    ],
    complaint: [
      'Lamento muito pelo ocorrido. Vamos resolver isso para você.',
      'Peço desculpas pelo transtorno. Me conte mais para eu poder ajudar.',
      'Sinto muito por essa experiência negativa. O que aconteceu exatamente?'
    ]
  };

  // ============================================
  // ESTADO
  // ============================================
  let state = {
    mode: MODES.SUGGEST.id,
    activePersona: 'professional',
    customPersonas: {},
    conversations: {}, // { chatId: { messages: [], context: {}, lastActivity: timestamp } }
    knowledgeBase: { ...DEFAULT_KNOWLEDGE_BASE },
    templates: { ...RESPONSE_TEMPLATES },
    feedback: [], // { responseId, rating, correctedResponse, timestamp }
    suggestions: [], // Current suggestions
    metrics: {
      totalResponses: 0,
      autoResponses: 0,
      manualResponses: 0,
      avgResponseTime: 0,
      avgConfidence: 0,
      feedbackScore: 0,
      byIntent: {},
      byPersona: {}
    },
    settings: {
      autoGreeting: true,
      autoSuggestions: true,
      showConfidence: true,
      learnFromFeedback: true,
      useKnowledgeBase: true,
      contextWindow: CONFIG.MAX_CONTEXT_MESSAGES,
      minConfidence: CONFIG.MIN_CONFIDENCE_SCORE
    }
  };

  let initialized = false;
  let suggestionPanel = null;

  // ============================================
  // INICIALIZAÇÃO
  // ============================================
  async function init() {
    if (initialized) return;

    try {
      await loadState();
      await syncWithKnowledgeBase(); // Sincronizar com Knowledge Base global
      setupEventListeners();
      initialized = true;
      console.log('[CopilotEngine] ✅ Inicializado');

      if (window.EventBus) {
        window.EventBus.emit('copilot:ready', { mode: state.mode, persona: state.activePersona });
      }
    } catch (error) {
      console.error('[CopilotEngine] ❌ Erro na inicialização:', error);
    }
  }

  // Sincronizar com o Knowledge Base global
  async function syncWithKnowledgeBase() {
    if (window.knowledgeBase) {
      try {
        // Aguardar inicialização se necessário
        if (!window.knowledgeBase.knowledge) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        if (window.knowledgeBase.knowledge) {
          const kb = window.knowledgeBase.knowledge;
          
          // Sincronizar FAQs (compatibilidade: kb.faq OU kb.faqs)
          const faqList = Array.isArray(kb.faqs) ? kb.faqs : (Array.isArray(kb.faq) ? kb.faq : []);
          if (faqList.length > 0) {
            state.knowledgeBase.faqs = faqList.map(f => ({
              q: f.question,
              a: f.answer,
              category: f.category || 'Geral'
            }));
          }
          
          // Sincronizar Produtos
          if (kb.products && kb.products.length > 0) {
            state.knowledgeBase.products = kb.products;
          }
          
          // Sincronizar Respostas Rápidas como custom
          if (kb.cannedReplies && kb.cannedReplies.length > 0) {
            state.knowledgeBase.custom = kb.cannedReplies.map(cr => ({
              content: `Triggers: ${cr.triggers.join(', ')} | Resposta: ${cr.reply}`,
              triggers: cr.triggers,
              reply: cr.reply
            }));
          }
          
          console.log('[CopilotEngine] 📚 Knowledge Base sincronizada:', {
            faqs: state.knowledgeBase.faqs.length,
            products: state.knowledgeBase.products.length,
            custom: state.knowledgeBase.custom.length
          });
        }
      } catch (e) {
        console.warn('[CopilotEngine] Erro ao sincronizar Knowledge Base:', e);
      }
    }
    
    // Configurar listener para atualizações futuras
    if (window.EventBus) {
      window.EventBus.on('knowledge-base:updated', () => {
        syncWithKnowledgeBase();
      });
    }
  }

  async function loadState() {
    try {
      const stored = await chrome.storage.local.get(CONFIG.STORAGE_KEY);
      if (stored[CONFIG.STORAGE_KEY]) {
        const loaded = JSON.parse(stored[CONFIG.STORAGE_KEY]);
        state = { ...state, ...loaded };

        // v7.9.12: migrar/remover modos inválidos/indesejados
        state.mode = normalizeMode(state.mode);
      }
    } catch (e) {
      console.warn('[CopilotEngine] Falha ao carregar estado:', e);
    }
  }

  async function saveState() {
    try {
      // Não salvar conversas completas (muito grande)
      const toSave = { ...state };
      toSave.conversations = {}; // Limpar conversas do storage
      
      await chrome.storage.local.set({
        [CONFIG.STORAGE_KEY]: JSON.stringify(toSave)
      });
    } catch (e) {
      console.error('[CopilotEngine] Falha ao salvar estado:', e);
    }
  }

  function setupEventListeners() {
    if (!window.EventBus) return;

    // Escutar mensagens recebidas
    window.EventBus.on('message:received', async (data) => {
      if (state.mode === MODES.OFF.id) return;
      await handleIncomingMessage(data);
    });

    // Escutar mudanças de chat
    window.EventBus.on('chat:changed', (data) => {
      // Forçar recarga imediata do contexto ao trocar de chat (evita contexto obsoleto)
      loadConversationContext(data.chatId, true);
    });

    // AI-006 FIX: Track conversations and emit conversation:completed event
    let previousChatId = null;
    let previousChatTranscript = [];
    let previousChatMessageCount = 0;

    window.EventBus.on('chat:changed', (data) => {
      console.log('[AI-006] Chat changed, checking for conversation completion...');
      
      // Check if previous chat should trigger conversation:completed
      if (previousChatId && previousChatTranscript.length >= CONFIG.MIN_MESSAGES_FOR_COMPLETION) {
        console.log('[AI-006] ✅ Emitting conversation:completed for previous chat');
        window.EventBus.emit('conversation:completed', {
          chatId: previousChatId,
          transcript: previousChatTranscript,
          messageCount: previousChatMessageCount,
          hadAIInteraction: true, // Could be improved to check if AI actually participated
          completedAt: Date.now()
        });
      }

      // Update tracking for new chat
      previousChatId = data.chatId;
      previousChatTranscript = [];
      previousChatMessageCount = 0;

      // Load current chat context for tracking
      try {
        const context = conversationContexts.get(data.chatId);
        if (context && context.messages) {
          previousChatTranscript = [...context.messages];
          previousChatMessageCount = context.messages.length;
        }
      } catch (e) {
        console.warn('[AI-006] Error loading chat context for tracking:', e.message);
      }
    });

    // Escutar feedback
    window.EventBus.on('copilot:feedback', (data) => {
      recordFeedback(data);
    });
    
    // Configurar observer para detectar mudança de chat
    setupChatChangeObserver();
  }

  /**
   * Configura MutationObserver para detectar quando o usuário troca de chat
   */
  function setupChatChangeObserver() {
    let lastChatId = null;
    let observerStarted = false;
    
    function extractChatIdFromDOM() {
      try {
        const container = document.querySelector('#main') || document;
        const rows = Array.from(container.querySelectorAll('[data-id^="true_"], [data-id^="false_"]'));
        for (let i = rows.length - 1; i >= 0; i--) {
          const dataId = rows[i].getAttribute('data-id') || '';
          const m = dataId.match(/_(\d+@(?:c\.us|g\.us|lid|s\.whatsapp\.net))/);
          if (m && m[1]) return m[1];
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      return null;
    }

    function extractChatNameFromHeader() {
      try {
        const headerEl =
          document.querySelector('#main header span[title]') ||
          document.querySelector('header span[title]') ||
          document.querySelector('[data-testid="conversation-info-header-chat-title"] span') ||
          document.querySelector('[data-testid="conversation-info-header-chat-title"]');

        let name = headerEl?.getAttribute?.('title') || headerEl?.textContent || '';
        name = safeText(name);
        if (!name) return null;

        // Evitar falsos positivos do WhatsApp ("online", "digitando", etc.)
        const lowered = name.toLowerCase();
        const blocked = [
          'online',
          'digitando',
          'clique para mostrar os dados do contato',
          'clique para ver os dados do contato'
        ];
        if (blocked.some(b => lowered.includes(b))) return null;

        return name;
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      return null;
    }

    function detectCurrentChat() {
      try {
        // 1) Preferir o ID real do WhatsApp (Store) - mais estável
        try {
          const activeChat = window.Store?.Chat?.getActive?.();
          const serializedId = activeChat?.id?._serialized || activeChat?.id?.toString?.();
          if (safeText(serializedId)) {
            const title =
              activeChat?.formattedTitle ||
              activeChat?.name ||
              activeChat?.contact?.name ||
              activeChat?.contact?.pushname;
            return {
              chatId: serializedId,
              chatName: safeText(title) || serializedId
            };
          }
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

        // 2) Fallback: extrair do DOM via data-id das mensagens (mais estável do que usar texto do header)
        const domChatId = extractChatIdFromDOM();
        if (safeText(domChatId)) {
          const headerName = extractChatNameFromHeader();
          return { chatId: domChatId, chatName: headerName || domChatId };
        }

        // IMPORTANTE: não usar o texto do header como chatId (gera falsos "chat alterado": online, clique..., etc.)
        return { chatId: null, chatName: null };
      } catch (e) {
        console.warn('[CopilotEngine] Erro ao detectar chat:', e);
        return { chatId: null, chatName: null };
      }
    }
    
    function checkForChatChange() {
      const { chatId, chatName } = detectCurrentChat();
      
      if (chatId && chatId !== lastChatId) {
        console.log(`[CopilotEngine] 📱 Chat alterado: ${chatName}`);
        lastChatId = chatId;
        
        // Carregar histórico do DOM
        loadConversationContext(chatId);
        
        // Emitir evento para outros módulos
        if (window.EventBus) {
          window.EventBus.emit('chat:changed', { chatId, chatName });
        }
      }
    }
    
    function startObserver() {
      if (observerStarted) return;

    const scheduleCheck = (delay = 100) => {
      if (chatObserverTimeout) clearTimeout(chatObserverTimeout);
      chatObserverTimeout = setTimeout(checkForChatChange, delay);
    };

    // Usar MutationObserver no main panel (com debounce)
      const mainPanel = document.querySelector('#main');
      if (mainPanel) {
        if (chatChangeObserver) {
          try { chatChangeObserver.disconnect(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
          chatChangeObserver = null;
        }

        chatChangeObserver = new MutationObserver(() => {
        scheduleCheck(500);
        });
        
        chatChangeObserver.observe(mainPanel, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['title', 'data-testid']
        });
      }
      
      observerStarted = true;
      console.log('[CopilotEngine] 👁️ Observer de chat iniciado');
      
      // Verificar imediatamente
    checkForChatChange();
    }
    
    // Aguardar DOM estar pronto
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => setTimeout(startObserver, 2000));
    } else {
      setTimeout(startObserver, 2000);
    }

    if (!chatObserverCleanupRegistered) {
      window.addEventListener('beforeunload', () => {
        if (chatObserverTimeout) {
          clearTimeout(chatObserverTimeout);
          chatObserverTimeout = null;
        }
        if (chatChangeObserver) {
          try { chatChangeObserver.disconnect(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
          chatChangeObserver = null;
        }
      });
      chatObserverCleanupRegistered = true;
    }
  }

  // ============================================
  // PROCESSAMENTO DE MENSAGENS
  // ============================================
  async function handleIncomingMessage(data) {
    const { chatId, message, sender, timestamp } = data;

    // IMPORTANTE: Carregar histórico de mensagens do DOM primeiro
    await loadConversationContext(chatId);

    // Adicionar nova mensagem ao contexto
    addToContext(chatId, { role: 'user', content: message, timestamp, sender });

    // Atualizar memória local (heurística) com base no transcript mais recente
    try {
      const ctx = getConversationContext(chatId);
      const transcript = buildTranscriptFromMessages((ctx?.messages || []).slice(-30));
      const updater = window.autoUpdateMemory || window.MemorySystem?.autoUpdateMemory;
      if (typeof updater === 'function') {
        // não bloquear o fluxo principal
        Promise.resolve(updater(transcript, chatId, 5000)).catch(() => {});
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // Analisar mensagem
    const analysis = await analyzeMessage(message, chatId);

    // Emitir análise COM a mensagem original para aprendizado
    if (window.EventBus) {
      window.EventBus.emit('copilot:analysis', { chatId, analysis, message });
    }

    // Agir baseado no modo
    switch (state.mode) {
      case MODES.SUGGEST.id:
        await generateSuggestions(chatId, analysis);
        break;
      // Outros modos foram removidos (não responder automaticamente aqui)
      default:
        break;
    }
  }

  function sanitizeUserMessage(message) {
    if (!message || typeof message !== 'string') {
      return { sanitized: '', error: 'Mensagem inválida' };
    }
    const MAX_LENGTH = 4000;
    let sanitized = message.trim();
    if (sanitized.length > MAX_LENGTH) {
      sanitized = sanitized.substring(0, MAX_LENGTH);
    }
    // Remover caracteres de controle
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
    return { sanitized };
  }

  async function analyzeMessage(message, chatId) {
    const { sanitized, error } = sanitizeUserMessage(message);
    if (error) {
      return { error, intent: null, sentiment: null, entities: [], knowledgeMatches: [], context: [], urgency: 0, aiAnalysis: null, originalMessage: '' };
    }
    const safeMessage = sanitized;
    const startTime = Date.now();

    // Detectar intenção
    const intent = detectIntent(safeMessage);

    // Analisar sentimento
    const sentiment = analyzeSentiment(safeMessage);

    // Extrair entidades
    const entities = extractEntities(safeMessage);

    // Buscar na knowledge base
    const knowledgeMatches = searchKnowledgeBase(safeMessage);

    // Obter contexto da conversa
    const context = getConversationContext(chatId);

    // Calcular urgência
    const urgency = calculateUrgency(intent, sentiment, safeMessage);

    // Usar IA para análise profunda (se configurada)
    let aiAnalysis = null;
    const configuredProviders = window.AIService?.getConfiguredProviders() || [];
    if (window.AIService && configuredProviders.length > 0) {
      try {
        aiAnalysis = await deepAnalysis(safeMessage, context);
      } catch (e) {
        console.warn('[CopilotEngine] AI analysis failed:', e);
      }
    }

    return {
      intent,
      sentiment,
      entities,
      knowledgeMatches,
      context,
      urgency,
      aiAnalysis,
      originalMessage: safeMessage, // Guardar mensagem sanitizada para uso no prompt
      confidence: calculateConfidence(intent, sentiment, knowledgeMatches, aiAnalysis),
      processingTime: Date.now() - startTime
    };
  }

  // ============================================
  // DETECÇÃO DE INTENÇÃO
  // ============================================
  function detectIntent(message) {
    const lowerMessage = message.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const [key, intent] of Object.entries(INTENTS)) {
      let score = 0;
      for (const pattern of intent.patterns) {
        if (lowerMessage.includes(pattern.toLowerCase())) {
          score += pattern.length; // Padrões mais longos = mais relevantes
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { ...intent, score };
      }
    }

    // Se não encontrou match claro, usar "INFO" como fallback
    if (!bestMatch || bestScore < 2) {
      bestMatch = { ...INTENTS.INFO, score: 0 };
    }

    return bestMatch;
  }

  // ============================================
  // ANÁLISE DE SENTIMENTO
  // ============================================
  function analyzeSentiment(message) {
    const lowerMessage = message.toLowerCase();

    const SENTIMENT_WORDS = {
      positive: {
        words: ['obrigado', 'ótimo', 'excelente', 'perfeito', 'adorei', 'maravilhoso', 'top', 'parabéns', 'amei', 'incrível', 'show', 'demais', 'legal', 'bom', 'muito bom', 'gostei', 'satisfeito', 'feliz', 'agradeço', 'nota 10'],
        weight: 1
      },
      negative: {
        words: [
          // Reclamações gerais
          'problema', 'ruim', 'péssimo', 'horrível', 'reclamar', 'insatisfeito', 'cancelar', 'devolver', 'raiva', 'absurdo', 'lixo', 'decepcionado', 'frustrado', 'irritado', 'bravo',
          // Palavrões e insultos (censurados parcialmente para evitar problemas)
          'merda', 'bosta', 'porra', 'caralho', 'cacete', 'desgraça', 'maldito', 'droga', 'inferno',
          'idiota', 'burro', 'imbecil', 'estúpido', 'otário', 'babaca', 'cretino', 'retardado', 'palhaço',
          'fdp', 'pqp', 'vsf', 'vtnc', 'tnc', 'puta', 'vagabundo', 'safado', 'pilantra',
          'filho da', 'vai tomar', 'vai se', 'vai pro', 'cala boca', 'some daqui',
          // Expressões negativas
          'não presta', 'uma porcaria', 'que lixo', 'que droga', 'não aguento', 'detesto', 'odeio'
        ],
        weight: -1
      },
      hostile: {
        words: [
          'tomar no cu', 'foder', 'foda-se', 'fudido', 'cu', 'pau no cu', 'enfia no cu',
          'viado', 'viadinho', 'bicha', 'gay', 'sapatão', // insultos homofóbicos
          'preto', 'negro', 'macaco', 'crioulo', // insultos racistas - detectar para responder adequadamente
          'gordo', 'baleia', 'feia', 'nojento',
          'matar', 'morrer', 'sumir', 'desaparecer'
        ],
        weight: -2
      },
      neutral: {
        words: ['ok', 'certo', 'entendi', 'tá', 'beleza', 'pode ser', 'tanto faz'],
        weight: 0
      }
    };

    let score = 0;
    let matches = [];
    let isHostile = false;

    for (const [sentiment, config] of Object.entries(SENTIMENT_WORDS)) {
      for (const word of config.words) {
        if (lowerMessage.includes(word)) {
          score += config.weight;
          matches.push({ word, sentiment });
          if (sentiment === 'hostile') {
            isHostile = true;
          }
        }
      }
    }

    // Normalizar score entre -1 e 1
    const normalizedScore = Math.max(-1, Math.min(1, score / 3));

    let label = 'neutral';
    if (isHostile || normalizedScore < -0.5) label = 'hostile';
    else if (normalizedScore > 0.3) label = 'positive';
    else if (normalizedScore < -0.3) label = 'negative';

    return {
      score: normalizedScore,
      label,
      matches,
      isHostile,
      emoji: label === 'positive' ? '😊' : label === 'negative' ? '😟' : label === 'hostile' ? '😡' : '😐',
      advice: isHostile ? 'Responda de forma profissional e calma, não reaja aos insultos' : null
    };
  }

  // ============================================
  // EXTRAÇÃO DE ENTIDADES
  // ============================================
  function extractEntities(message) {
    const entities = {
      phones: [],
      emails: [],
      urls: [],
      dates: [],
      times: [],
      money: [],
      numbers: [],
      names: []
    };

    // Telefones brasileiros
    const phoneRegex = /(?:\+?55\s?)?(?:\(?[1-9]{2}\)?\s?)?(?:9\s?)?[0-9]{4}[-\s]?[0-9]{4}/g;
    entities.phones = message.match(phoneRegex) || [];

    // Emails
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    entities.emails = message.match(emailRegex) || [];

    // URLs
    const urlRegex = /https?:\/\/[^\s]+/g;
    entities.urls = message.match(urlRegex) || [];

    // Datas (formatos brasileiros)
    const dateRegex = /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g;
    entities.dates = message.match(dateRegex) || [];

    // Horários
    const timeRegex = /\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?/gi;
    entities.times = message.match(timeRegex) || [];

    // Valores monetários
    const moneyRegex = /R\$\s?[\d.,]+|\d+(?:[.,]\d+)?\s?(?:reais|real)/gi;
    entities.money = message.match(moneyRegex) || [];

    // Números
    const numberRegex = /\b\d+(?:[.,]\d+)?\b/g;
    entities.numbers = message.match(numberRegex) || [];

    return entities;
  }

  // ============================================
  // KNOWLEDGE BASE
  // ============================================
  function searchKnowledgeBase(query) {
    if (!state.settings.useKnowledgeBase) return [];

    const lowerQuery = query.toLowerCase();
    const results = [];

    // Buscar em FAQs
    for (const faq of state.knowledgeBase.faqs) {
      const score = calculateTextSimilarity(lowerQuery, faq.q.toLowerCase());
      if (score > 0.3) {
        results.push({ type: 'faq', content: faq, score });
      }
    }

    // Buscar em produtos
    for (const product of state.knowledgeBase.products) {
      const score = calculateTextSimilarity(lowerQuery, `${product.name} ${product.description}`.toLowerCase());
      if (score > 0.3) {
        results.push({ type: 'product', content: product, score });
      }
    }

    // Buscar em custom
    for (const item of state.knowledgeBase.custom) {
      const score = calculateTextSimilarity(lowerQuery, item.content.toLowerCase());
      if (score > 0.3) {
        results.push({ type: 'custom', content: item, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, CONFIG.KNOWLEDGE_BASE_MAX_RESULTS);
  }

  function calculateTextSimilarity(text1, text2) {
    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);
    
    let matches = 0;
    for (const word of words1) {
      if (word.length > 2 && words2.some(w => w.includes(word) || word.includes(w))) {
        matches++;
      }
    }
    
    return matches / Math.max(words1.length, words2.length);
  }

  function addToKnowledgeBase(type, content) {
    if (!state.knowledgeBase[type]) {
      state.knowledgeBase[type] = [];
    }
    state.knowledgeBase[type].push({ ...content, id: Date.now().toString(), addedAt: new Date().toISOString() });
    saveState();
  }

  // ============================================
  // CONTEXTO DE CONVERSA
  // ============================================
  function addToContext(chatId, message) {
    if (!state.conversations[chatId]) {
      state.conversations[chatId] = {
        messages: [],
        context: {},
        lastActivity: Date.now()
      };
    }

    state.conversations[chatId].messages.push(message);
    state.conversations[chatId].lastActivity = Date.now();

    // Limitar tamanho do contexto
    if (state.conversations[chatId].messages.length > state.settings.contextWindow) {
      state.conversations[chatId].messages = state.conversations[chatId].messages.slice(-state.settings.contextWindow);
    }

    // v9.4.5 BUG #123: cap número de chats em memória + eviction LRU.
    // Antes: cliente que atende 5000 chats em 6 meses → 5000 entries em
    // memória, nunca purgadas → crescimento linear consumindo RAM.
    // Agora: max 200 chats. Quando excede, evita os 50 menos ativos.
    const MAX_CHATS_IN_MEMORY = 200;
    const chatIds = Object.keys(state.conversations);
    if (chatIds.length > MAX_CHATS_IN_MEMORY) {
      const sorted = chatIds
        .map(id => ({ id, t: state.conversations[id]?.lastActivity || 0 }))
        .sort((a, b) => a.t - b.t);
      const toEvict = sorted.slice(0, 50);
      for (const { id } of toEvict) {
        delete state.conversations[id];
      }
      console.log(`[CopilotEngine] LRU: removidos ${toEvict.length} chats antigos da memória`);
    }
  }

  function getConversationContext(chatId) {
    return state.conversations[chatId] || { messages: [], context: {}, lastActivity: null };
  }

  async function loadConversationContext(chatId, forceReload = false) {
    // IMPORTANTE: Carregar histórico do DOM do WhatsApp
    const existingContext = getConversationContext(chatId);
    
    // Se já tem mensagens carregadas recentemente E não é forceReload, não recarrega
    if (!forceReload && 
        existingContext.messages.length > 5 && 
        existingContext.lastActivity && 
        (Date.now() - existingContext.lastActivity) < 3000) { // mais responsivo (3s)
      if (window.EventBus) {
        window.EventBus.emit('copilot:context:loaded', { chatId, context: existingContext });
      }
      return existingContext;
    }

    // Extrair mensagens do DOM
    const domMessages = extractMessagesFromDOM();

    if (domMessages.length === 0 && window.EventBus) {
      window.EventBus.emit('copilot:context:failed', {
        chatId,
        reason: 'dom_empty'
      });
    }
    
    if (domMessages.length > 0) {
      // Inicializar contexto se não existir
      if (!state.conversations[chatId]) {
        state.conversations[chatId] = {
          messages: [],
          context: {},
          lastActivity: Date.now()
        };
      }
      
      // Se forceReload ou contexto vazio, substituir todas as mensagens
      if (forceReload || state.conversations[chatId].messages.length === 0) {
        state.conversations[chatId].messages = domMessages;
      } else {
        // Mesclar mensagens do DOM com as existentes (evitar duplicatas)
        const existingContents = new Set(state.conversations[chatId].messages.map(m => m.content));
        
        for (const msg of domMessages) {
          if (!existingContents.has(msg.content)) {
            state.conversations[chatId].messages.push(msg);
          }
        }
      }
      
      // Manter TODO o histórico disponível para contexto completo
      // O prompt final usará estratégia inteligente (recentes detalhados + resumo)
      // Limite aumentado para suportar histórico completo do WhatsApp
      if (state.conversations[chatId].messages.length > 500) {
        state.conversations[chatId].messages = state.conversations[chatId].messages.slice(-500);
      }
      
      state.conversations[chatId].lastActivity = Date.now();
      
      console.log(`[CopilotEngine] ✅ Contexto: ${state.conversations[chatId].messages.length} mensagens carregadas para chat ${chatId}`);
    }
    
    // ============================================
    // PILAR 5: Buscar contexto híbrido do backend (memória + exemplos + knowledge)
    // ============================================
    try {
      const hybridContext = await fetchHybridContextFromBackend(chatId);
      if (hybridContext) {
        // Mesclar memória do servidor com contexto local
        if (!state.conversations[chatId]) {
          state.conversations[chatId] = { messages: [], context: {}, lastActivity: Date.now() };
        }
        
        // Salvar memória, exemplos e knowledge no contexto
        state.conversations[chatId].context = {
          ...state.conversations[chatId].context,
          serverMemory: hybridContext.memory,
          fewShotExamples: hybridContext.examples,
          knowledgeBase: hybridContext.knowledge,
          hybridSource: 'server'
        };
        
        console.log('[CopilotEngine] 🧠 Contexto híbrido carregado do backend');
      }
    } catch (e) {
      // v7.9.13: Backend soberano - NÃO cair em fallback silencioso
      if (CONFIG.FORCE_BACKEND && CONFIG.SHOW_BACKEND_ERRORS) {
        console.error('[CopilotEngine] ❌ [MOTOR: BACKEND OBRIGATÓRIO] Falha ao conectar:', e.message);
        console.warn('[CopilotEngine] 🚨 Backend não respondeu. Configure o servidor ou verifique a conexão.');
        
        // Emitir evento de erro para UI mostrar ao usuário
        if (window.EventBus) {
          window.EventBus.emit('copilot:backend:error', {
            error: e.message,
            reason: 'Backend obrigatório não respondeu',
            suggestion: 'Verifique se o servidor está rodando em http://localhost:3000'
          });
        }
      } else {
        console.log('[CopilotEngine] ⚠️ [MOTOR: LOCAL] Usando apenas contexto local:', e.message);
      }
    }
    
    const context = getConversationContext(chatId);
    if (window.EventBus) {
      window.EventBus.emit('copilot:context:loaded', { chatId, context });
    }
    
    return context;
  }
  
  /**
   * PILAR 5: Busca contexto híbrido do backend
   * Inclui memória, exemplos few-shot e knowledge base
   */
  async function fetchHybridContextFromBackend(chatId) {
    try {
      // Verificar se backend está configurado (compat: múltiplos schemas)
      const settings = await chrome.storage.local.get([
        'backend_token',
        'backend_url',
        'whl_backend_config',
        'whl_backend_client'
      ]);

      // Preferência: whl_backend_config -> whl_backend_client -> backend_url/backend_token
      const cfg = settings?.whl_backend_config || null;
      let backendUrl = cfg?.url || null;
      let token = cfg?.token || null;

      if ((!backendUrl || !token) && settings?.whl_backend_client) {
        try {
          const parsed = JSON.parse(settings.whl_backend_client);
          backendUrl = backendUrl || parsed?.baseUrl || null;
          token = token || parsed?.accessToken || null;
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      }

      backendUrl = String(backendUrl || settings?.backend_url || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000')).replace(/\/$/, '');
      token = token || settings?.backend_token || null;

      if (!token) return null; // Sem token, usar apenas local
      
      const response = await fetch(`${backendUrl}/api/v1/ai/learn/context/${encodeURIComponent(chatId)}?includeExamples=true&maxMessages=30&maxExamples=3`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Backend retornou ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.context) {
        return {
          memory: data.context.memory || null,
          examples: data.context.examples || [],
          knowledge: data.context.knowledge || [],
          messages: data.context.messages || []
        };
      }
      
      return null;
    } catch (error) {
      console.warn('[CopilotEngine] Erro ao buscar contexto do backend:', error.message);
      // V3-003 FIX: Only propagate if both FORCE_BACKEND AND DISABLE_LOCAL_FALLBACK
      if (CONFIG.FORCE_BACKEND && CONFIG.DISABLE_LOCAL_FALLBACK) {
        throw error;
      }
      return null;
    }
  }

  /**
   * Extrai TODAS as mensagens disponíveis do WhatsApp via API interna
   * Usa Store.Msg para acessar o histórico completo do chat
   * @param {number} maxMessages - Limite máximo (0 = sem limite)
   * @returns {Array} Array de mensagens {role, content, timestamp}
   */
  function extractMessagesFromDOM(maxMessages = 0) {
    const messages = [];

    // PRIORIDADE 1: Store API (acessa TODO o histórico carregado do WhatsApp)
    try {
      const activeChat = window.Store?.Chat?.getActive?.();
      const msgsCollection = activeChat?.msgs;
      
      // Tentar carregar mais mensagens do servidor se disponível
      if (activeChat && typeof activeChat.loadEarlierMsgs === 'function') {
        try {
          // Tenta carregar mais mensagens (async, não bloqueante)
          activeChat.loadEarlierMsgs().catch(() => {});
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      }
      
      // Extrair todas as mensagens disponíveis
      const storeMsgsRaw =
        (typeof msgsCollection?.getModelsArray === 'function' ? msgsCollection.getModelsArray() : null) ||
        (Array.isArray(msgsCollection?._models) ? msgsCollection._models : null) ||
        (Array.isArray(msgsCollection?.models) ? msgsCollection.models : null) ||
        (typeof msgsCollection?.toArray === 'function' ? msgsCollection.toArray() : null) ||
        [];
      const storeMsgs = Array.isArray(storeMsgsRaw) ? storeMsgsRaw : [];

      if (storeMsgs.length > 0) {
        // USAR TODO O HISTÓRICO (sem slice se maxMessages = 0)
        const slice = maxMessages > 0 ? storeMsgs.slice(-maxMessages) : storeMsgs;

        const safe = (v) => (v === null || v === undefined) ? '' : String(v).replace(/\u0000/g, '').trim();

        const buildContentFromStoreMsg = (m) => {
          const body = safe(m?.body || m?.caption || m?.text || m?.__x_body || m?.__x_caption);
          if (body) return body;

          const type = safe(m?.type || m?.__x_type).toLowerCase();
          if (type.includes('audio') || type === 'ptt') return '[Áudio]';
          if (type.includes('video')) return '[Vídeo]';
          if (type.includes('image') || type.includes('img')) return '[Imagem]';
          if (type.includes('document') || type.includes('doc')) return '[Documento]';
          if (type.includes('sticker')) return '[Sticker]';

          // Protocol/system messages costumam não ajudar na sugestão
          if (type.includes('protocol') || type.includes('notification')) return '';

          return '';
        };

        // Extrair timestamp real da mensagem
        const getTimestamp = (m) => {
          if (m?.t) return m.t * 1000;
          if (m?.timestamp) return m.timestamp;
          if (m?.__x_t) return m.__x_t * 1000;
          return Date.now();
        };

        for (let i = 0; i < slice.length; i++) {
          const m = slice[i];
          const content = buildContentFromStoreMsg(m);
          if (!content) continue;

          const fromMe = !!(m?.id?.fromMe || m?.fromMe || m?.__x_fromMe);
          messages.push({
            role: fromMe ? 'assistant' : 'user',
            content,
            timestamp: getTimestamp(m),
            msgId: m?.id?.id || m?.id?._serialized || null
          });
        }

        if (messages.length >= 1) {
          console.log(`[CopilotEngine][CTX] ✅ Store: total=${storeMsgs.length} extraídas=${messages.length} (histórico completo)`);
          return messages;
        }

        // Se Store retornou muito pouco, segue para fallback DOM.
        messages.length = 0;
      }
    } catch (e) {
      // Sem Store (ou mudou internals) -> fallback DOM
      if (state?.settings?.debug) {
        console.warn('[CopilotEngine][CTX] Store não disponível, usando DOM:', e?.message);
      }
    }

    // Helpers locais (não depender do restante do módulo)
    const now = Date.now();
    const safe = (v) => (v === null || v === undefined) ? '' : String(v).replace(/\u0000/g, '').trim();

    const isSystemOrDeletedText = (text) => {
      const t = safe(text).toLowerCase();
      if (!t) return true;
      if (t.length < 2) return true;
      if (t.includes('mensagem apagada')) return true;
      if (t.includes('this message was deleted')) return true;
      if (t.includes('aguardando esta mensagem')) return true;
      if (t.includes('waiting for this message')) return true;
      return false;
    };

    const extractRowText = (row) => {
      try {
        // Texto/caption
        const textEl = row.querySelector('[data-testid="selectable-text"]') ||
                       row.querySelector('.selectable-text') ||
                       row.querySelector('[data-testid="msg-text"]') ||
                       row.querySelector('.copyable-text') ||
                       row.querySelector('span[dir="ltr"], span[dir="auto"]');
        const txt = safe(textEl?.textContent);
        if (txt && !isSystemOrDeletedText(txt)) return txt;

        // Placeholders de mídia (ajuda a manter contexto)
        const hasVideo = !!(row.querySelector('video') || row.querySelector('span[data-icon="media-play"], span[data-icon*="video"], span[data-icon*="media-play"]'));
        const hasImg = !!row.querySelector('img[src^="blob:"], img[src^="data:"]');
        const hasAudio = !!row.querySelector('span[data-icon*="audio"], span[data-testid*="audio"], audio');
        const hasDoc = !!row.querySelector('span[data-icon*="document"], span[data-icon*="doc"], a[download]');

        if (hasAudio) return '[Áudio]';
        if (hasVideo) return '[Vídeo]';
        if (hasImg) return '[Imagem]';
        if (hasDoc) return '[Documento]';
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      return '';
    };

    const isOutgoingRow = (row, dataId = '') => {
      try {
        if (!row) return false;

        // Sinais fortes de saída (mensagem enviada por você)
        if (row.classList?.contains('message-out') || row.querySelector?.('.message-out')) return true;
        if (row.querySelector?.('span[data-icon="tail-out"]')) return true;
        if (row.querySelector?.('[data-testid="msg-dblcheck"], [data-testid="msg-check"], [data-icon="msg-dblcheck"], [data-icon="msg-check"], [data-icon="msg-time"]')) return true;

        // Sinais fortes de entrada
        if (row.classList?.contains('message-in') || row.querySelector?.('.message-in')) return false;
        if (row.querySelector?.('span[data-icon="tail-in"]')) return false;

        // Heurística pelo data-id (pode variar por build, então fica por último)
        const did = safe(dataId || row.getAttribute?.('data-id'));
        if (did.startsWith('true_')) return true;
        if (did.startsWith('false_')) return false;
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      return false;
    };

    try {
      // ✅ Método mais robusto (WhatsApp atual): rows com data-id true_/false_
      const rows = Array.from(document.querySelectorAll('#main [data-id^="true_"], #main [data-id^="false_"]'));
      if (rows.length > 0) {
        rows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const windowRows = rows.slice(-Math.max(1, maxMessages));

        let idx = 0;
        for (const row of windowRows) {
          const dataId = safe(row.getAttribute('data-id'));
          const outgoing = isOutgoingRow(row, dataId);
          const content = extractRowText(row);
          if (!safe(content)) { idx++; continue; }

          messages.push({
            role: outgoing ? 'assistant' : 'user',
            content,
            timestamp: now - ((windowRows.length - idx) * 1000),
            fromDOM: true,
            dataId
          });
          idx++;
        }

        console.log(`[CopilotEngine][CTX] 📜 DOM rows=${rows.length} janela=${windowRows.length} extraidas=${messages.length}`);
        return messages;
      }

      // Fallback antigo: msg-container
      const msgContainers = document.querySelectorAll('[data-testid="msg-container"]');
      if (msgContainers.length > 0) {
        msgContainers.forEach((container, index) => {
          const isOutgoing = container.closest('[data-testid*="out"]') ||
            container.querySelector('[data-testid="msg-dblcheck"]') ||
            container.querySelector('[data-testid="msg-check"]');

          const textEl = container.querySelector('[data-testid="selectable-text"]') ||
            container.querySelector('.selectable-text') ||
            container.querySelector('span.selectable-text') ||
            container.querySelector('span[dir="ltr"], span[dir="auto"]') ||
            container.querySelector('.copyable-text span');

          const text = safe(textEl?.textContent);
          if (isSystemOrDeletedText(text)) return;

          messages.push({
            role: isOutgoing ? 'assistant' : 'user',
            content: text,
            timestamp: now - ((msgContainers.length - index) * 1000),
            fromDOM: true
          });
        });
        console.log(`[CopilotEngine][CTX] 📜 Fallback msg-container extraidas=${messages.length}`);
        return messages.slice(-Math.max(1, maxMessages));
      }

      // Fallback final: classes antigas
      const altContainers = document.querySelectorAll('.message-in, .message-out');
      altContainers.forEach(container => {
        const textEl = container.querySelector('.selectable-text, span[dir="ltr"], span[dir="auto"], .copyable-text');
        const text = safe(textEl?.textContent);
        if (isSystemOrDeletedText(text)) return;
        const isOutgoing = container.classList.contains('message-out');
        messages.push({
          role: isOutgoing ? 'assistant' : 'user',
          content: text,
          timestamp: now,
          fromDOM: true
        });
      });

      console.log(`[CopilotEngine][CTX] 📜 Fallback legacy classes extraidas=${messages.length}`);

    } catch (error) {
      console.error('[CopilotEngine] Erro ao extrair mensagens do DOM:', error);
    }

    return messages.slice(-Math.max(1, maxMessages));
  }

  function clearConversationContext(chatId) {
    if (state.conversations[chatId]) {
      state.conversations[chatId].messages = [];
      state.conversations[chatId].context = {};
    }
  }

  // ============================================
  // GERAÇÃO DE RESPOSTAS (com sistemas avançados integrados)
  // ============================================
  async function generateResponse(chatId, analysis, options = {}) {
    const startTime = Date.now();
    const persona = getActivePersona();
    const context = getConversationContext(chatId);
    
    // v7.7.0: Tentar cache primeiro (economia de tokens)
    if (window.aiResponseCache && !options.skipCache) {
      try {
        const cached = await window.aiResponseCache.get(analysis.originalMessage || '', {
          intent: analysis.intent?.id,
          entities: analysis.entities,
          sentiment: analysis.sentiment?.score,
          category: analysis.category
        });
        
        if (cached) {
          console.log('[CopilotEngine] ⚡ Resposta do cache!');
          
          // Emitir evento de sugestão mostrada
          if (window.EventBus) {
            window.EventBus.emit('suggestion:shown', {
              chatId,
              suggestion: cached.response,
              fromCache: true
            });
          }
          
          return {
            content: cached.response,
            confidence: cached.confidence,
            intent: analysis.intent,
            sentiment: analysis.sentiment,
            fromCache: true,
            latency: Date.now() - startTime
          };
        }
      } catch (e) {
        // Cache miss ou erro, continuar normalmente
      }
    }
    
    // v7.7.0: Obter perfil avançado do cliente para personalização
    let clientContext = '';
    if (window.aiMemoryAdvanced) {
      try {
        // Atualizar perfil com mensagem atual
        await window.aiMemoryAdvanced.analyzeAndUpdateFromMessage(
          chatId, 
          analysis.originalMessage || '', 
          true
        );
        
        // Obter contexto formatado para o prompt
        clientContext = window.aiMemoryAdvanced.getContextForPrompt(chatId);
      } catch (e) {
        console.warn('[CopilotEngine] Erro ao obter contexto avançado:', e);
      }
    }
    
    // v7.7.0: Adaptar persona ao cliente
    let adaptedPersona = persona;
    if (window.aiMemoryAdvanced && clientContext) {
      const profile = window.aiMemoryAdvanced.getProfile(chatId);
      if (profile) {
        adaptedPersona = adaptPersonaToClient(persona, profile);
      }
    }
    
    // Construir prompt com contexto enriquecido
    const messages = buildPromptMessages(chatId, context, analysis, adaptedPersona, clientContext);

    // v7.9.12: Verificar créditos ANTES de chamar IA
    if (window.SubscriptionManager && !window.SubscriptionManager.canUseAI()) {
      // Mostrar modal de créditos esgotados
      if (window.AIGateway) {
        window.AIGateway.showCreditsDepletedModal();
      }
      throw new Error('Créditos de IA esgotados. Faça upgrade ou compre mais créditos.');
    }

    // ============================================
    // v7.9.13: GERAÇÃO COM BACKEND SOBERANO
    // ============================================
    let result;
    const aiStartTime = Date.now();
    
    // PRIORIDADE 1: AIGateway (usa backend via FETCH_PROXY)
    if (window.AIGateway) {
      console.log('[CopilotEngine] 🚀 [MOTOR: BACKEND/AIGateway] Iniciando requisição...');
      try {
        result = await Promise.race([
          window.AIGateway.complete(messages, {
            temperature: options.temperature ?? adaptedPersona.temperature,
            max_tokens: options.maxTokens ?? adaptedPersona.maxTokens,
            userId: chatId
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('TIMEOUT: Backend não respondeu')), CONFIG.BACKEND_TIMEOUT_MS)
          )
        ]);
        result.content = result.text; // Normalizar resposta
        
        const latency = Date.now() - aiStartTime;
        console.log(`[CopilotEngine] ✅ [MOTOR: BACKEND] Resposta em ${latency}ms | Provider: ${result.provider || 'unknown'}`);
        
      } catch (gatewayError) {
        console.error('[CopilotEngine] ❌ [MOTOR: BACKEND] AIGateway falhou:', gatewayError.message);
        
        // v7.9.13: Se FORCE_BACKEND, não tentar fallback
        // R-002 FIX: Check both FORCE_BACKEND AND DISABLE_LOCAL_FALLBACK
        if (CONFIG.FORCE_BACKEND && CONFIG.DISABLE_LOCAL_FALLBACK) {
          if (window.EventBus) {
            window.EventBus.emit('copilot:backend:error', {
              error: gatewayError.message,
              reason: 'AIGateway falhou e FORCE_BACKEND está ativo',
              latency: Date.now() - aiStartTime
            });
          }
          throw new Error(`❌ Backend obrigatório falhou: ${gatewayError.message}`);
        }
        // Fallback apenas se FORCE_BACKEND = false
        console.warn('[CopilotEngine] ⚠️ Tentando AIService como fallback...');
        result = null;
      }
    }
    
    // PRIORIDADE 2: AIService (fallback, APENAS se FORCE_BACKEND = false)
    if (!result && window.AIService) {
      // R-002 FIX: Check both FORCE_BACKEND AND DISABLE_LOCAL_FALLBACK
      if (CONFIG.FORCE_BACKEND && CONFIG.DISABLE_LOCAL_FALLBACK) {
        console.error('[CopilotEngine] ❌ [MOTOR: BLOQUEADO] FORCE_BACKEND=true impede fallback para AIService local');
        throw new Error('❌ Backend obrigatório indisponível. Fallback local desabilitado.');
      }
      
      console.warn('[CopilotEngine] ⚠️ [MOTOR: LOCAL/AIService] Usando motor LOCAL (fallback)');
      result = await window.AIService.complete(messages, {
        temperature: options.temperature ?? adaptedPersona.temperature,
        maxTokens: options.maxTokens ?? adaptedPersona.maxTokens
      });
      console.log(`[CopilotEngine] ⚠️ [MOTOR: LOCAL] Resposta via AIService | Provider: ${result.provider || 'local'}`);
      
      // Consumir crédito manualmente se não usar AIGateway
      if (window.SubscriptionManager) {
        await window.SubscriptionManager.consumeCredits(1, 'copilot');
      }
    }
    
    // PRIORIDADE 3: Nenhum serviço disponível
    if (!result) {
      console.error('[CopilotEngine] ❌ [MOTOR: NENHUM] Nenhum serviço de IA disponível');
      if (window.EventBus) {
        window.EventBus.emit('copilot:backend:error', {
          error: 'Nenhum serviço de IA disponível',
          reason: 'AIGateway e AIService não estão carregados',
          suggestion: 'Verifique se os módulos estão corretamente instalados'
        });
      }
      throw new Error('❌ Nenhum serviço de IA disponível (AIGateway/AIService não carregados)');
    }

    // Validar resposta do provider
    if (!result || typeof result.content !== 'string' || !result.content.trim()) {
      throw new Error('Resposta inválida do provider de IA');
    }

    // Pós-processar resposta
    const response = postProcessResponse(result.content, analysis, adaptedPersona);

    // Calcular score de confiança
    const confidence = calculateResponseConfidence(response, analysis, result);

    // v7.7.0: Salvar no cache
    if (window.aiResponseCache && confidence > 0.7) {
      try {
        window.aiResponseCache.set(
          analysis.originalMessage || '',
          {
            intent: analysis.intent?.id,
            entities: analysis.entities,
            sentiment: analysis.sentiment?.score,
            category: analysis.category
          },
          response,
          confidence
        );
      } catch (e) {
        // Erro ao cachear, não crítico
      }
    }
    
    // v7.7.0: Registrar decisão da IA
    if (window.aiMemoryAdvanced) {
      window.aiMemoryAdvanced.recordAIDecision(chatId, 'generate_response', confidence, {
        intent: analysis.intent?.id,
        provider: result.provider
      });
    }
    
    // v7.7.0: Emitir evento de sugestão mostrada para tracking
    if (window.EventBus) {
      window.EventBus.emit('suggestion:shown', {
        chatId,
        suggestion: response,
        shownAt: Date.now(),
        context: {
          intent: analysis.intent?.id,
          sentiment: analysis.sentiment?.score
        }
      });
    }

    // Registrar métricas
    updateMetrics('generated', analysis.intent, confidence);

    return {
      content: response,
      confidence,
      intent: analysis.intent,
      sentiment: analysis.sentiment,
      provider: result.provider,
      tokens: result.usage?.totalTokens,
      latency: Date.now() - startTime,
      // v9.4.1: propaga interactionId pro caller (autopilot, smart-replies, UI)
      // poder enviar feedback corretamente via /learn/feedback. Sem isso, o
      // ValidatedLearningPipeline nunca recebe sinal de aprendizado.
      interactionId: result.interactionId || null,
    };
  }
  
  /**
   * v7.7.0: Adapta persona baseado no perfil do cliente
   */
  function adaptPersonaToClient(persona, profile) {
    const adapted = { ...persona };
    
    // Adaptar tom baseado no estilo de comunicação do cliente
    if (profile.communicationStyle === 'formal') {
      adapted.tone = 'profissional e respeitoso';
      adapted.instructions = (adapted.instructions || '') + '\nUse linguagem formal. Evite gírias e emojis.';
    } else if (profile.communicationStyle === 'informal') {
      adapted.tone = 'amigável e descontraído';
      adapted.instructions = (adapted.instructions || '') + '\nPode usar linguagem informal e emojis quando apropriado.';
    } else if (profile.communicationStyle === 'tecnico') {
      adapted.tone = 'técnico e preciso';
      adapted.instructions = (adapted.instructions || '') + '\nUse termos técnicos quando necessário. Seja preciso.';
    }
    
    // Adaptar tamanho de resposta
    if (profile.responseLength === 'curta') {
      adapted.maxTokens = Math.min(adapted.maxTokens || 200, 100);
      adapted.instructions = (adapted.instructions || '') + '\nSeja breve e direto ao ponto.';
    } else if (profile.responseLength === 'longa') {
      adapted.maxTokens = Math.max(adapted.maxTokens || 200, 400);
      adapted.instructions = (adapted.instructions || '') + '\nPode elaborar mais nas explicações.';
    }
    
    // Adaptar baseado na satisfação do cliente
    if (profile.satisfactionTrend && profile.satisfactionTrend.length >= 3) {
      const avgSatisfaction = profile.satisfactionTrend.reduce((a, b) => a + b, 0) / profile.satisfactionTrend.length;
      
      if (avgSatisfaction < 0.4) {
        adapted.instructions = (adapted.instructions || '') + 
          '\n⚠️ ATENÇÃO: Este cliente está com tendência de insatisfação. Seja extra cuidadoso, empático e proativo em resolver problemas.';
        adapted.temperature = Math.max(0.3, (adapted.temperature || 0.7) - 0.2);
      }
    }
    
    // Considerar segmento do cliente
    if (profile.segment === 'vip') {
      adapted.instructions = (adapted.instructions || '') + '\nEste é um cliente VIP. Priorize atendimento premium.';
    }
    
    return adapted;
  }

  // SECURITY FIX P0-033: Enhanced sanitization to prevent prompt injection
  function safeText(v, maxLen = 4000) {
    if (v === null || v === undefined) return '';
    let clean = String(v);

    // Remove control characters including null bytes
    clean = clean.replace(/[\x00-\x1F\x7F]/g, '');

    // SECURITY: Detect and neutralize prompt injection patterns
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
        console.warn('[CopilotEngine Security] Prompt injection attempt detected and neutralized');
        clean = clean.replace(pattern, '[FILTERED]');
      }
    });

    // Limit length
    if (clean.length > maxLen) {
      clean = clean.substring(0, maxLen) + '...';
    }

    return clean.trim();
  }

  function buildTranscriptFromMessages(msgs) {
    if (!Array.isArray(msgs) || msgs.length === 0) return '';
    return msgs
      .filter(m => safeText(m?.content))
      .map(m => `${m.role === 'assistant' ? 'Atendente' : 'Cliente'}: ${safeText(m.content)}`)
      .join('\n');
  }

  /**
   * Gera resumo inteligente do histórico de mensagens antigas
   * Extrai: tópicos discutidos, acordos, pendências, preferências detectadas
   * @param {Array} messages - Mensagens para resumir
   * @returns {string} Resumo estruturado
   */
  function generateConversationSummary(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return '';
    
    const topics = new Set();
    const agreements = [];
    const pendencies = [];
    const clientInfo = [];
    const pricesMentioned = [];
    const datesMentioned = [];
    
    // Keywords para detectar tópicos
    const topicKeywords = {
      'preço': 'Discussão sobre preços/valores',
      'valor': 'Discussão sobre preços/valores',
      'orçamento': 'Solicitação de orçamento',
      'entrega': 'Prazo/entrega',
      'prazo': 'Prazo/entrega',
      'produto': 'Informações de produto',
      'serviço': 'Informações de serviço',
      'problema': 'Suporte/problema',
      'dúvida': 'Dúvidas gerais',
      'pagamento': 'Formas de pagamento',
      'pix': 'Pagamento via PIX',
      'cartão': 'Pagamento via cartão',
      'boleto': 'Pagamento via boleto',
      'agendamento': 'Agendamento',
      'agendar': 'Agendamento',
      'reunião': 'Reunião/call',
      'proposta': 'Proposta comercial',
      'contrato': 'Contrato',
      'garantia': 'Garantia',
      'devolução': 'Devolução/troca',
      'reclamação': 'Reclamação'
    };
    
    // Patterns para extrair informações
    const pricePattern = /R\$\s*[\d.,]+/gi;
    const datePattern = /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g;
    const agreementPatterns = [
      /(?:então|ok|certo|fechado|combinado|pode ser|vamos fazer)/i,
      /(?:confirmo|confirmado|está confirmado)/i
    ];
    const pendencyPatterns = [
      /(?:vou enviar|vou mandar|te passo|te mando)/i,
      /(?:aguardando|esperando|fico no aguardo)/i,
      /(?:depois|amanhã|segunda|próxima)/i
    ];
    
    for (const msg of messages) {
      const content = safeText(msg.content).toLowerCase();
      if (!content) continue;
      
      // Detectar tópicos
      for (const [keyword, topic] of Object.entries(topicKeywords)) {
        if (content.includes(keyword)) {
          topics.add(topic);
        }
      }
      
      // Extrair preços mencionados
      const prices = content.match(pricePattern);
      if (prices) pricesMentioned.push(...prices);
      
      // Extrair datas mencionadas
      const dates = content.match(datePattern);
      if (dates) datesMentioned.push(...dates);
      
      // Detectar acordos/confirmações
      for (const pattern of agreementPatterns) {
        if (pattern.test(content) && msg.role === 'user') {
          const snippet = safeText(msg.content).substring(0, 80);
          if (!agreements.includes(snippet)) {
            agreements.push(snippet);
          }
        }
      }
      
      // Detectar pendências
      for (const pattern of pendencyPatterns) {
        if (pattern.test(content)) {
          const snippet = safeText(msg.content).substring(0, 80);
          if (!pendencies.includes(snippet)) {
            pendencies.push(snippet);
          }
        }
      }
      
      // Extrair informações do cliente (email, telefone, nome)
      if (msg.role === 'user') {
        const emailMatch = content.match(/[\w.-]+@[\w.-]+\.\w+/i);
        if (emailMatch) clientInfo.push(`Email: ${emailMatch[0]}`);
        
        const phoneMatch = content.match(/\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}/);
        if (phoneMatch) clientInfo.push(`Telefone: ${phoneMatch[0]}`);
      }
    }
    
    // Montar resumo estruturado
    const parts = [];
    
    if (topics.size > 0) {
      parts.push(`📌 Tópicos discutidos: ${[...topics].slice(0, 6).join(', ')}`);
    }
    
    if (pricesMentioned.length > 0) {
      const uniquePrices = [...new Set(pricesMentioned)].slice(0, 3);
      parts.push(`💰 Valores mencionados: ${uniquePrices.join(', ')}`);
    }
    
    if (datesMentioned.length > 0) {
      const uniqueDates = [...new Set(datesMentioned)].slice(0, 3);
      parts.push(`📅 Datas mencionadas: ${uniqueDates.join(', ')}`);
    }
    
    if (agreements.length > 0) {
      parts.push(`✅ Acordos/confirmações: ${agreements.slice(0, 2).join(' | ')}`);
    }
    
    if (pendencies.length > 0) {
      parts.push(`⏳ Pendências detectadas: ${pendencies.slice(0, 2).join(' | ')}`);
    }
    
    if (clientInfo.length > 0) {
      parts.push(`👤 Dados do cliente: ${[...new Set(clientInfo)].slice(0, 3).join(', ')}`);
    }
    
    // Adicionar estatísticas
    const userMsgs = messages.filter(m => m.role === 'user').length;
    const assistantMsgs = messages.filter(m => m.role === 'assistant').length;
    parts.push(`📊 Interações anteriores: ${userMsgs} do cliente, ${assistantMsgs} do atendente`);
    
    return parts.join('\n') || 'Histórico anterior sem tópicos relevantes detectados.';
  }

  function getChatTitleFromDOM() {
    try {
      const headerSpan = document.querySelector('header span[title]');
      const headerDiv = document.querySelector('[data-testid="conversation-info-header"] span');
      const mainPanel = document.querySelector('#main header');
      if (headerSpan) return headerSpan.getAttribute('title') || headerSpan.textContent || '';
      if (headerDiv) return headerDiv.textContent || '';
      if (mainPanel) {
        const nameEl = mainPanel.querySelector('span[dir="auto"]');
        return nameEl?.textContent || '';
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  function formatMemoryForPrompt(memory) {
    if (!memory || typeof memory !== 'object') return '';
    const parts = [];
    if (safeText(memory.profile)) parts.push(`Perfil: ${safeText(memory.profile)}`);
    if (Array.isArray(memory.preferences) && memory.preferences.length) {
      parts.push(`Preferências: ${memory.preferences.map(safeText).filter(Boolean).slice(0, 8).join('; ')}`);
    }
    if (Array.isArray(memory.context) && memory.context.length) {
      parts.push(`Contexto confirmado: ${memory.context.map(safeText).filter(Boolean).slice(0, 8).join('; ')}`);
    }
    if (Array.isArray(memory.open_loops) && memory.open_loops.length) {
      parts.push(`Pendências: ${memory.open_loops.map(safeText).filter(Boolean).slice(0, 8).join('; ')}`);
    }
    if (Array.isArray(memory.next_actions) && memory.next_actions.length) {
      parts.push(`Próximas ações: ${memory.next_actions.map(safeText).filter(Boolean).slice(0, 6).join('; ')}`);
    }
    if (safeText(memory.tone)) parts.push(`Tom recomendado: ${safeText(memory.tone)}`);
    const txt = parts.join('\n');
    return txt.length > 900 ? (txt.slice(0, 900) + '...') : txt;
  }

  function getMemoryForChat(chatId) {
    try {
      const ms = window.memorySystem;
      if (!ms || typeof ms.getChatKey !== 'function' || typeof ms.getMemory !== 'function') return null;

      // 1) Tenta pelo chatId real
      if (safeText(chatId)) {
        const k1 = ms.getChatKey(chatId);
        const m1 = ms.getMemory(k1);
        if (m1) return m1;
      }

      // 2) Fallback pelo título atual do chat
      const title = getChatTitleFromDOM();
      if (safeText(title)) {
        const k2 = ms.getChatKey(title);
        const m2 = ms.getMemory(k2);
        if (m2) return m2;
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    return null;
  }

  function tryParseJson(text) {
    const t = safeText(text);
    if (!t) return null;
    try { return JSON.parse(t); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // fenced code
    const m = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (m && m[1]) {
      try { return JSON.parse(m[1]); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }

    // best-effort: first object
    const m2 = t.match(/\{[\s\S]*\}/);
    if (m2) {
      try { return JSON.parse(m2[0]); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }

    return null;
  }

  function buildPromptMessages(chatId, context, analysis, persona, clientContext = '') {
    const messages = [];

    const baseRules = `Você é um assistente de atendimento no WhatsApp.
Objetivo: responder rápido, claro, profissional e humano, sem inventar informações.

Regras:
- Nunca invente dados (preços, prazos, políticas). Se não souber, pergunte objetivamente ou diga que precisa confirmar.
- Não peça dados sensíveis desnecessários.
- Leia o histórico e responda à ÚLTIMA mensagem do cliente.
- Seja direto e útil. Se necessário, use lista curta (máximo 4 itens).
- Use linguagem natural em pt-BR.
- Responda SOMENTE com o texto final pronto para enviar (sem markdown, sem explicações).`;

    const systemParts = [baseRules];

    if (safeText(persona?.systemPrompt)) {
      systemParts.push(`PERSONA (regras extras):\n${safeText(persona.systemPrompt)}`);
    }

    // v7.7.0: Contexto avançado do cliente (perfil, histórico, preferências)
    if (clientContext) {
      systemParts.push(`CONTEXTO DO CLIENTE (importante para personalização):\n${clientContext}`);
    }

    // Contexto robusto do negócio (treinamento/KB)
    try {
      if (window.knowledgeBase && typeof window.knowledgeBase.buildSystemPrompt === 'function') {
        const kbPrompt = safeText(window.knowledgeBase.buildSystemPrompt({ persona: persona?.id || 'professional', businessContext: true }));
        if (kbPrompt) systemParts.push(`CONTEXTO DO NEGÓCIO (use como verdade):\n${kbPrompt}`);
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // Memória do contato (local)
    const memory = getMemoryForChat(chatId);
    const memText = formatMemoryForPrompt(memory);
    if (memText) systemParts.push(`MEMÓRIA deste contato:\n${memText}`);
    
    // PILAR 5: Memória do servidor (se disponível - contexto híbrido)
    if (context?.context?.serverMemory) {
      const serverMem = context.context.serverMemory;
      const serverMemText = formatMemoryForPrompt(serverMem);
      if (serverMemText && serverMemText !== memText) {
        systemParts.push(`MEMÓRIA (servidor):\n${serverMemText}`);
      }
    }
    
    // PILAR 5: Knowledge base do servidor (se disponível)
    if (context?.context?.knowledgeBase && Array.isArray(context.context.knowledgeBase) && context.context.knowledgeBase.length > 0) {
      let serverKB = 'CONHECIMENTO (servidor):\n';
      context.context.knowledgeBase.forEach(k => {
        if (k.question && k.answer) {
          serverKB += `- P: ${safeText(k.question)} | R: ${safeText(k.answer)}\n`;
        }
      });
      systemParts.push(serverKB.trim());
    }

    // Sinais do próprio CopilotEngine (sentimento/intenção/urgência)
    if (analysis?.sentiment) {
      systemParts.push(`SENTIMENTO detectado na última mensagem: ${safeText(analysis.sentiment.label)} ${safeText(analysis.sentiment.emoji)}`);
    }
    if (analysis?.intent) {
      systemParts.push(`INTENÇÃO provável: ${safeText(analysis.intent.name || analysis.intent.id)}`);
    }
    if (analysis?.aiAnalysis) {
      // Campos opcionais vindos da deepAnalysis
      const ia = analysis.aiAnalysis;
      const parts = [];
      if (safeText(ia.intent)) parts.push(`intent=${safeText(ia.intent)}`);
      if (safeText(ia.sentiment)) parts.push(`sentiment=${safeText(ia.sentiment)}`);
      if (safeText(ia.suggestedAction)) parts.push(`ação=${safeText(ia.suggestedAction)}`);
      if (Array.isArray(ia.topics) && ia.topics.length) parts.push(`tópicos=${ia.topics.map(safeText).filter(Boolean).slice(0, 6).join(', ')}`);
      if (parts.length) systemParts.push(`ANÁLISE IA (apoio): ${parts.join(' | ')}`);
    }

    // Base de conhecimento (match pontual)
    if (analysis?.knowledgeMatches && analysis.knowledgeMatches.length > 0) {
      let kbText = 'Informações relevantes encontradas (use como referência):\n';
      analysis.knowledgeMatches.forEach(match => {
        if (match.type === 'faq') {
          kbText += `- P: ${safeText(match.content.q)} | R: ${safeText(match.content.a)}\n`;
        } else if (match.type === 'product') {
          kbText += `- Produto: ${safeText(match.content.name)} | ${safeText(match.content.description)} | Preço: ${match.content.price ? 'R$' + match.content.price : 'consultar'}\n`;
        } else if (match.type === 'custom') {
          kbText += `- ${safeText(match.content.content || match.content)}\n`;
        }
      });
      systemParts.push(kbText.trim());
    }

    // Hostilidade: manter as boas diretrizes
    if (analysis?.sentiment?.isHostile || analysis?.sentiment?.label === 'hostile') {
      systemParts.push(`ATENÇÃO: o cliente está hostil.
Diretrizes obrigatórias:
- Não reaja a insultos.
- Mantenha calma e profissionalismo.
- Mostre empatia (ex.: "Entendo sua frustração...").
- Foque em resolver o problema.`);
    }

    if (analysis?.urgency && analysis.urgency > 0.7) {
      systemParts.push('URGÊNCIA: trate como prioridade e vá direto ao ponto.');
    }

    const systemPrompt = systemParts.filter(Boolean).join('\n\n');
    messages.push({ role: 'system', content: systemPrompt });

    // Few-shot (exemplos) para coerência de estilo/conteúdo
    const transcriptForExamples = buildTranscriptFromMessages((context?.messages || []).slice(-40));
    let addedExamples = 0;
    const maxExamples = 3;
    
    // PILAR 5: Priorizar exemplos do servidor (já ranqueados por relevância)
    if (context?.context?.fewShotExamples && Array.isArray(context.context.fewShotExamples)) {
      context.context.fewShotExamples.forEach(ex => {
        if (addedExamples >= maxExamples) return;
        const u = safeText(ex?.input);
        const a = safeText(ex?.output);
        if (u && a) {
          messages.push({ role: 'user', content: u });
          messages.push({ role: 'assistant', content: a });
          addedExamples++;
        }
      });
    }
    
    // Complementar com exemplos locais se necessário
    if (addedExamples < maxExamples) {
      try {
        const fsl = window.fewShotLearning;
        const picked = fsl?.pickRelevantExamples?.(transcriptForExamples, maxExamples - addedExamples) || fsl?.pickExamples?.(null, transcriptForExamples, maxExamples - addedExamples) || [];
        if (Array.isArray(picked) && picked.length) {
          picked.forEach(ex => {
            if (addedExamples >= maxExamples) return;
            const u = safeText(ex?.user || ex?.input);
            const a = safeText(ex?.assistant || ex?.output);
            if (u && a) {
              messages.push({ role: 'user', content: u });
              messages.push({ role: 'assistant', content: a });
              addedExamples++;
            }
          });
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    }

    // Adicionar HISTÓRICO COMPLETO da conversa com estratégia inteligente
    // Usa todo o contexto disponível do WhatsApp via Store API
    if (context?.messages && context.messages.length > 0) {
      const allMessages = context.messages.filter(m => safeText(m?.content));
      const totalMessages = allMessages.length;
      
      // Configuração: quantas mensagens recentes enviar detalhadamente
      const RECENT_DETAILED = 40;  // Mensagens recentes com texto completo
      const SUMMARY_WINDOW = 100;  // Mensagens anteriores para resumo
      
      if (totalMessages <= RECENT_DETAILED) {
        // Chat pequeno: enviar tudo detalhadamente
        console.log(`[CopilotEngine] 📜 Contexto completo: ${totalMessages} mensagens`);
        for (const msg of allMessages) {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: safeText(msg.content)
          });
        }
      } else {
        // Chat grande: resumo das antigas + recentes detalhadas
        const olderMessages = allMessages.slice(0, -RECENT_DETAILED);
        const recentMessages = allMessages.slice(-RECENT_DETAILED);
        
        // Gerar resumo das mensagens antigas (extrair tópicos principais)
        const summaryWindow = olderMessages.slice(-SUMMARY_WINDOW);
        const conversationSummary = generateConversationSummary(summaryWindow);
        
        if (conversationSummary) {
          messages.push({
            role: 'system',
            content: `RESUMO DO HISTÓRICO ANTERIOR (${olderMessages.length} mensagens):\n${conversationSummary}`
          });
        }
        
        console.log(`[CopilotEngine] 📜 Contexto: ${olderMessages.length} resumidas + ${recentMessages.length} detalhadas = ${totalMessages} total`);
        
        // Adicionar mensagens recentes detalhadamente
        for (const msg of recentMessages) {
          messages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: safeText(msg.content)
          });
        }
      }
    }

    // Garantir que a ÚLTIMA mensagem do cliente está no final
    if (safeText(analysis?.originalMessage)) {
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg || lastMsg.role !== 'user' || safeText(lastMsg.content) !== safeText(analysis.originalMessage)) {
        messages.push({ role: 'user', content: safeText(analysis.originalMessage) });
      }
    }

    return messages;
  }

  function postProcessResponse(response, analysis, persona) {
    let processed = response.trim();

    // Remover prefixos indesejados
    processed = processed.replace(/^(Resposta:|Assistente:|Bot:)/i, '').trim();

    // Limitar tamanho
    if (processed.length > 500) {
      processed = processed.substring(0, 497) + '...';
    }

    return processed;
  }

  // ============================================
  // SUGESTÕES
  // ============================================
  async function generateSuggestions(chatId, analysis) {
    try {
      const suggestions = [];
      
      // FIX: Verificar primeiro se temos providers de IA configurados
      // Se tiver, PRIORIZAR a IA ao invés de templates genéricos
      const hasConfiguredProviders = window.AIService && 
        typeof window.AIService.getConfiguredProviders === 'function' &&
        window.AIService.getConfiguredProviders().length > 0;
      
      // PRIORIDADE 1: Sugestão gerada por IA (se disponível e configurada)
      if (hasConfiguredProviders) {
        try {
          console.log('[CopilotEngine] 🤖 Gerando sugestão com IA...');
          const aiResponse = await generateResponse(chatId, analysis, { maxTokens: 200 });
          
          // Verificar se resposta é válida (não é template fallback)
          if (aiResponse.content && aiResponse.content.length > 10) {
            suggestions.push({
              type: 'ai',
              content: aiResponse.content,
              confidence: aiResponse.confidence || 0.9,
              source: 'ai',
              metadata: { provider: aiResponse.provider, tokens: aiResponse.tokens }
            });
            console.log('[CopilotEngine] ✅ Sugestão IA gerada com sucesso');
          }
        } catch (e) {
          console.warn('[CopilotEngine] ⚠️ AI suggestion failed:', e.message);
          // Continuar para fallbacks
        }
      }
      
      // PRIORIDADE 2: Sugestão da knowledge base (se não tiver IA ou IA falhou)
      if (suggestions.length === 0 && analysis.knowledgeMatches && analysis.knowledgeMatches.length > 0) {
        const kbSuggestion = analysis.knowledgeMatches[0];
        if (kbSuggestion.type === 'faq' && kbSuggestion.content?.a) {
          suggestions.push({
            type: 'knowledge',
            content: kbSuggestion.content.a,
            confidence: kbSuggestion.score || 0.7,
            source: 'knowledge_base'
          });
        }
      }

      // PRIORIDADE 3: Templates APENAS como último recurso (quando não tem IA nem KB)
      if (suggestions.length === 0) {
        // v7.9.13: Se FORCE_BACKEND está ativo, NÃO usar templates locais
        if (CONFIG.FORCE_BACKEND && CONFIG.DISABLE_LOCAL_FALLBACK) {
          console.error('[CopilotEngine] ❌ [MOTOR: BACKEND OBRIGATÓRIO] IA não gerou resposta e fallback local está DESABILITADO');
          console.warn('[CopilotEngine] 🚨 Nenhuma sugestão disponível. O backend/IA precisa responder.');
          
          // Emitir erro claro para a UI
          if (window.EventBus) {
            window.EventBus.emit('copilot:backend:error', {
              error: 'AI não gerou resposta',
              reason: 'Backend obrigatório - fallback local desabilitado',
              suggestion: 'Verifique se as chaves de API estão configuradas corretamente'
            });
          }
          
          // Retornar sugestão de erro em vez de template genérico
          suggestions.push({
            type: 'error',
            content: '⚠️ IA indisponível. Verifique a conexão com o backend.',
            confidence: 0,
            source: 'backend_error'
          });
        } else {
          console.log('[CopilotEngine] ⚠️ [MOTOR: LOCAL] Usando templates como fallback');
          const templateSuggestions = getTemplateSuggestions(analysis.intent);
          suggestions.push(...templateSuggestions.slice(0, 1).map(t => ({
            type: 'template',
            content: t,
            confidence: 0.5,
            source: 'template_fallback'
          })));
        }
      }

      // Ordenar por confiança
      suggestions.sort((a, b) => b.confidence - a.confidence);

      // Limitar e salvar
      state.suggestions = suggestions.slice(0, CONFIG.SUGGESTION_COUNT);

      // Emitir evento
      if (window.EventBus) {
        window.EventBus.emit('copilot:suggestions', { chatId, suggestions: state.suggestions });
      }

      return state.suggestions;
    } catch (error) {
      console.error('[CopilotEngine] Erro ao gerar sugestões:', error);
      return [];
    }
  }

  function getTemplateSuggestions(intent) {
    const templates = state.templates[intent.id] || state.templates.notUnderstood;
    return templates.slice(0, 2);
  }

  function getSuggestions() {
    return [...state.suggestions];
  }

  // ============================================
  // AUTO-RESPOSTA
  // ============================================
  async function generateAndSend(chatId, analysis) {
    // Verificar confiança mínima
    if (analysis.confidence < state.settings.minConfidence) {
      console.log('[CopilotEngine] Confiança baixa, não enviando automaticamente');
      await generateSuggestions(chatId, analysis);
      return;
    }

    try {
      const response = await generateResponse(chatId, analysis);

      // Emitir evento para enviar
      if (window.EventBus) {
        window.EventBus.emit('copilot:auto_send', {
          chatId,
          content: response.content,
          confidence: response.confidence
        });
      }

      // Adicionar ao contexto
      addToContext(chatId, { role: 'assistant', content: response.content, timestamp: Date.now(), auto: true });

      // Atualizar métricas
      updateMetrics('auto_sent', analysis.intent, response.confidence);

    } catch (error) {
      console.error('[CopilotEngine] Erro no auto-send:', error);
    }
  }

  // v7.5.0: generateDraft() removed - AUTO_DRAFT mode no longer exists

  async function generateAndQueue(chatId, analysis) {
    try {
      const response = await generateResponse(chatId, analysis);

      if (window.EventBus) {
        window.EventBus.emit('copilot:queued', {
          chatId,
          content: response.content,
          confidence: response.confidence,
          requiresApproval: true
        });
      }

      return response;
    } catch (error) {
      console.error('[CopilotEngine] Erro ao gerar/enfileirar:', error);
    }
  }

  // ============================================
  // ANÁLISE PROFUNDA COM IA
  // ============================================
  async function deepAnalysis(message, context) {
    const history = (context?.messages || [])
      .slice(-6)
      .filter(m => m && safeText(m.content))
      .map(m => `${m.role}: ${safeText(m.content)}`)
      .join('\n');

    const prompt = `Você é um analisador de mensagens do WhatsApp.

Retorne APENAS um JSON válido (sem markdown) com o schema:
{
  "intent": "greeting|question|complaint|purchase|support|info|other",
  "sentiment": "positive|negative|neutral",
  "urgency": 0,
  "topics": ["..."],
  "suggestedAction": "..."
}

Regras:
- Não invente fatos. Baseie-se apenas no texto.
- Se algo não estiver claro, use intent "other" e topics vazios.
- urgency: 0 (nada urgente) até 1 (muito urgente).

Histórico recente:
${history || '(sem histórico)'}

Mensagem atual: "${safeText(message)}"`;

    try {
      const result = await window.AIService.generateText(prompt, { temperature: 0.2, maxTokens: 350 });
      return tryParseJson(result?.content);
    } catch (_) {
      return null;
    }
  }

  // ============================================
  // CÁLCULOS DE CONFIANÇA
  // ============================================
  function calculateConfidence(intent, sentiment, knowledgeMatches, aiAnalysis) {
    let score = 0.5; // Base

    // Intent score
    if (intent.score > 5) score += 0.2;
    else if (intent.score > 2) score += 0.1;

    // Knowledge base match
    if (knowledgeMatches.length > 0) {
      score += Math.min(0.2, knowledgeMatches[0].score);
    }

    // AI analysis match
    if (aiAnalysis && aiAnalysis.intent === intent.id) {
      score += 0.1;
    }

    return Math.min(1, score);
  }

  function calculateResponseConfidence(response, analysis, aiResult) {
    let score = analysis.confidence;

    // Ajustar baseado no tamanho da resposta
    if (response.length < 20) score -= 0.1;
    if (response.length > 300) score -= 0.05;

    // Ajustar baseado nos tokens usados
    if (aiResult.usage?.totalTokens > 500) score -= 0.1;

    return Math.max(0, Math.min(1, score));
  }

  function calculateUrgency(intent, sentiment, message) {
    let urgency = 0;

    // Intent de urgência
    if (intent.id === 'urgency') urgency += 0.5;
    if (intent.id === 'complaint') urgency += 0.3;
    if (intent.id === 'support') urgency += 0.2;

    // Sentimento negativo
    if (sentiment.label === 'negative') urgency += 0.3;

    // Palavras específicas
    const urgentWords = ['urgente', 'emergência', 'agora', 'imediato', 'rápido'];
    if (urgentWords.some(w => message.toLowerCase().includes(w))) {
      urgency += 0.3;
    }

    return Math.min(1, urgency);
  }

  // ============================================
  // FEEDBACK E APRENDIZADO
  // ============================================
  function recordFeedback(data) {
    state.feedback.push({
      ...data,
      timestamp: Date.now()
    });

    // Limitar tamanho
    if (state.feedback.length > 1000) {
      state.feedback = state.feedback.slice(-1000);
    }

    // Atualizar score médio
    updateFeedbackMetrics();

    // Salvar
    saveState();
    
    // IMPORTANTE: Encaminhar para SmartBot para aprendizado contínuo
    if (window.smartBot && window.smartBot.learningSystem) {
      window.smartBot.learningSystem.recordFeedback({
        input: data.input,
        response: data.response,
        rating: data.rating,
        context: data.context
      });
      console.log('[CopilotEngine] 🧠 Feedback encaminhado para SmartBot');
    }

    // Também armazenar como few-shot (exemplos bons) para aumentar coerência das próximas sugestões
    try {
      if (window.fewShotLearning && typeof window.fewShotLearning.addExample === 'function') {
        const rating = Number(data.rating || 0);
        const input = safeText(data.input);
        const output = safeText(data.response);

        if (rating >= 4 && input && output) {
          const ctxMsgs = data.context?.messages || data.context?.conversation?.messages;
          const transcript = buildTranscriptFromMessages(Array.isArray(ctxMsgs) ? ctxMsgs.slice(-30) : []);

          window.fewShotLearning.addExample({
            input,
            output,
            context: transcript,
            category: data.intent?.id || data.intent?.name || 'Geral'
          }).catch?.(() => {});
        }
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // ============================================
    // ATUALIZAR ESTATÍSTICAS DE TREINAMENTO (UI)
    // ============================================
    try {
      if (window.trainingStats) {
        const rating = Number(data.rating || 0);
        if (rating >= 4) {
          window.trainingStats.incrementGood();
        } else if (rating <= 2) {
          window.trainingStats.incrementBad();
        }
        if (data.correctedResponse) {
          window.trainingStats.incrementCorrected();
        }
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // ============================================
    // ENVIAR FEEDBACK PARA BACKEND (persistência)
    // Isso alimenta o sistema de aprendizado contínuo no servidor
    // ============================================
    sendFeedbackToBackend(data).catch(err => {
      console.warn('[CopilotEngine] ⚠️ Falha ao enviar feedback para backend:', err.message);
    });

    if (window.EventBus) {
      window.EventBus.emit('copilot:feedback:recorded', data);
    }
  }
  
  /**
   * Envia feedback para o backend para persistência e aprendizado
   * @param {Object} data - Dados do feedback
   */
  async function sendFeedbackToBackend(data) {
    try {
      const settings = await chrome.storage.local.get([
        'backend_token',
        'backend_url',
        'whl_backend_config',
        'whl_backend_client'
      ]);

      const cfg = settings?.whl_backend_config || null;
      let backendUrl = cfg?.url || null;
      let token = cfg?.token || null;

      if ((!backendUrl || !token) && settings?.whl_backend_client) {
        try {
          const parsed = JSON.parse(settings.whl_backend_client);
          backendUrl = backendUrl || parsed?.baseUrl || null;
          token = token || parsed?.accessToken || null;
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      }

      backendUrl = String(backendUrl || settings?.backend_url || (globalThis.WHL_ENDPOINTS?.BACKEND_DEFAULT || 'http://localhost:3000')).replace(/\/$/, '');
      token = token || settings?.backend_token || null;
      
      if (!token) {
        console.log('[CopilotEngine] Backend não configurado, feedback salvo apenas localmente');
        return;
      }
      
      const response = await fetch(`${backendUrl}/api/v1/ai/learn/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          chatId: data.chatId || data.context?.chatId || '',
          messageId: data.messageId || null,
          // v9.4.1: interactionId essencial pro ValidatedLearningPipeline aprender.
          // Caller deve passar data.interactionId vindo do generateResponse() result.
          interactionId: data.interactionId || null,
          userMessage: data.input,
          assistantResponse: data.response,
          rating: data.rating,
          correctedResponse: data.correctedResponse || null,
          feedbackType: data.feedbackType || 'rating'
        })
      });
      
      if (response.ok) {
        console.log('[CopilotEngine] ✅ Feedback enviado para backend');
      } else {
        console.warn('[CopilotEngine] ⚠️ Backend retornou', response.status);
      }
    } catch (error) {
      throw error;
    }
  }

  function updateFeedbackMetrics() {
    const recent = state.feedback.slice(-100);
    if (recent.length === 0) return;

    const avgRating = recent.reduce((sum, f) => sum + (f.rating || 0), 0) / recent.length;
    state.metrics.feedbackScore = avgRating;
  }

  // ============================================
  // MÉTRICAS
  // ============================================
  function updateMetrics(action, intent, confidence) {
    state.metrics.totalResponses++;

    if (action === 'auto_sent') {
      state.metrics.autoResponses++;
    } else {
      state.metrics.manualResponses++;
    }

    // Média de confiança
    state.metrics.avgConfidence = (state.metrics.avgConfidence * (state.metrics.totalResponses - 1) + confidence) / state.metrics.totalResponses;

    // Por intenção
    if (!state.metrics.byIntent[intent.id]) {
      state.metrics.byIntent[intent.id] = 0;
    }
    state.metrics.byIntent[intent.id]++;

    // Por persona
    if (!state.metrics.byPersona[state.activePersona]) {
      state.metrics.byPersona[state.activePersona] = 0;
    }
    state.metrics.byPersona[state.activePersona]++;
  }

  function getMetrics() {
    return { ...state.metrics };
  }

  function resetMetrics() {
    state.metrics = {
      totalResponses: 0,
      autoResponses: 0,
      manualResponses: 0,
      avgResponseTime: 0,
      avgConfidence: 0,
      feedbackScore: 0,
      byIntent: {},
      byPersona: {}
    };
    saveState();
  }

  // ============================================
  // CONFIGURAÇÃO
  // ============================================
  function setMode(mode) {
    mode = normalizeMode(mode);
    if (!MODES[mode.toUpperCase?.()] && !Object.values(MODES).find(m => m.id === mode)) {
      throw new Error(`Modo inválido: ${mode}`);
    }
    state.mode = mode;
    saveState();

    if (window.EventBus) {
      window.EventBus.emit('copilot:mode:changed', { mode });
    }
  }

  function getMode() {
    return state.mode;
  }

  function setActivePersona(personaId) {
    const allPersonas = { ...DEFAULT_PERSONAS, ...state.customPersonas };
    if (!allPersonas[personaId]) {
      throw new Error(`Persona não encontrada: ${personaId}`);
    }
    state.activePersona = personaId;
    saveState();

    if (window.EventBus) {
      window.EventBus.emit('copilot:persona:changed', { personaId });
    }
  }

  function getActivePersona() {
    const allPersonas = { ...DEFAULT_PERSONAS, ...state.customPersonas };
    
    // v7.9.13: Integração com TeamSystem
    // Se o TeamSystem estiver ativo e tiver um usuário logado,
    // usamos a persona correspondente à role do usuário
    if (window.TeamSystem?.getCurrentUser) {
      const currentUser = window.TeamSystem.getCurrentUser();
      if (currentUser?.role) {
        // TeamSystem expõe ROLE_PERSONA_MAP com mapeamento role -> persona
        const rolePersonaMap = window.TeamSystem.ROLE_PERSONA_MAP;
        if (rolePersonaMap) {
          const rolePersona = rolePersonaMap[currentUser.role];
          if (rolePersona && allPersonas[rolePersona]) {
            console.log(`[CopilotEngine] 👥 Usando persona '${rolePersona}' baseado na role '${currentUser.role}' do usuário ${currentUser.name}`);
            return allPersonas[rolePersona];
          }
        }
        // Fallback: usar getPersonaForRole do TeamSystem
        if (typeof window.TeamSystem.getPersonaForRole === 'function') {
          const rolePersona = window.TeamSystem.getPersonaForRole();
          if (rolePersona && allPersonas[rolePersona]) {
            return allPersonas[rolePersona];
          }
        }
      }
    }
    
    return allPersonas[state.activePersona] || DEFAULT_PERSONAS.professional;
  }

  function getAllPersonas() {
    return { ...DEFAULT_PERSONAS, ...state.customPersonas };
  }

  function createCustomPersona(persona) {
    const id = persona.id || `custom_${Date.now()}`;
    state.customPersonas[id] = {
      ...persona,
      id,
      isCustom: true,
      createdAt: new Date().toISOString()
    };
    saveState();
    return id;
  }

  function deleteCustomPersona(personaId) {
    if (state.customPersonas[personaId]) {
      delete state.customPersonas[personaId];
      if (state.activePersona === personaId) {
        state.activePersona = 'professional';
      }
      saveState();
      return true;
    }
    return false;
  }

  function updateSettings(settings) {
    state.settings = { ...state.settings, ...settings };
    saveState();
  }

  function getSettings() {
    return { ...state.settings };
  }

  // ============================================
  // DEBUG
  // ============================================
  function debug() {
    return {
      initialized,
      mode: state.mode,
      activePersona: state.activePersona,
      conversationsCount: Object.keys(state.conversations).length,
      suggestionsCount: state.suggestions.length,
      feedbackCount: state.feedback.length,
      metrics: state.metrics,
      settings: state.settings
    };
  }

  // ============================================
  // EXPORT
  // ============================================
  window.CopilotEngine = {
    // Lifecycle
    init,

    // Configuration
    setMode,
    getMode,
    setActivePersona,
    getActivePersona,
    getAllPersonas,
    createCustomPersona,
    deleteCustomPersona,
    updateSettings,
    getSettings,

    // Core
    handleIncomingMessage,
    analyzeMessage,
    generateResponse,
    generateSuggestions,
    getSuggestions,

    // Intent & Analysis
    detectIntent,
    analyzeSentiment,
    extractEntities,

    // Context
    addToContext,
    getConversationContext,
    clearConversationContext,

    // Knowledge Base
    searchKnowledgeBase,
    addToKnowledgeBase,

    // Feedback
    recordFeedback,

    // Metrics
    getMetrics,
    resetMetrics,

    // Debug
    debug,
    
    // Context Management (novas funções)
    loadConversationContext,
    extractMessagesFromDOM,

    // Constants
    MODES,
    INTENTS,
    DEFAULT_PERSONAS
  };

  console.log('[CopilotEngine] 🤖 Motor de Copilot v1.0 carregado');
  console.log('[CopilotEngine] 📋 Modos:', Object.values(MODES).map(m => m.name).join(', '));
})();
