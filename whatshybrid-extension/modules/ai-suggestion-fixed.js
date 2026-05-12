/**
 * 🤖 AI Suggestion Button - Botão de Sugestões de IA (CORRIGIDO)
 *
 * TODO: AUDIT-NEW-018 (P3) - i18n AI Prompts
 * This module forces Portuguese responses that should be internationalized.
 * See: docs/internal/PEND-MED-003-I18N-AI-PROMPTS-FIX.md for full implementation guide.
 * Lines affected: 828-835 (forced Portuguese instruction)
 *
 * Botão azul posicionado acima do botão enviar do WhatsApp.
 * Ao clicar: gera sugestão baseada na conversa atual.
 *
 * @version 2.0.0 - CORRIGIDO
 */

(function() {
  'use strict';

  if (window.__AI_SUGGESTION_FIXED__) return;
  window.__AI_SUGGESTION_FIXED__ = true;

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[AI-Btn]', ...args); }

  const CONFIG = {
    BUTTON_ID: 'whl-ai-btn-fixed',
    PANEL_ID: 'whl-ai-panel-fixed',
    BUTTON_SIZE: 42,
    CHECK_INTERVAL: 2000
  };

  let state = {
    injected: false,
    panelVisible: false,
    generating: false,
    suggestion: null,
    suggestionShownAt: null,  // V3-004 FIX: Track when suggestion was shown
    // v9.3.0: campos pra fechar feedback loop com o backend orchestrator
    lastInteractionId: null,
    lastMetadata: null,
    lastIntelligence: null,
  };

  // ============================================
  // HELPERS (Robust package: memória + exemplos + prompt completo)
  // ============================================

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
        console.warn('[AISuggestion Security] Prompt injection attempt detected and neutralized');
        clean = clean.replace(pattern, '[FILTERED]');
      }
    });

    // Limit length
    if (clean.length > maxLen) {
      clean = clean.substring(0, maxLen) + '...';
    }

    return clean.trim();
  }

  function getActiveChatId() {
    try {
      if (window.Store?.Chat?.getActive) {
        const id = window.Store.Chat.getActive()?.id?._serialized;
        if (safeText(id)) return id;
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    return null;
  }

  function buildTranscriptFromMessages(msgs) {
    if (!Array.isArray(msgs) || msgs.length === 0) return '';
    return msgs
      .filter(m => safeText(m?.content))
      .map(m => `${m.role === 'assistant' ? 'Atendente' : (m.role === 'system' ? 'Sistema' : 'Cliente')}: ${safeText(m.content)}`)
      .join('\n');
  }

  /**
   * Remove a última mensagem do transcript para evitar duplicação
   * @param {string} transcript - Transcript completo
   * @param {string} lastMsg - Última mensagem a remover
   * @returns {string} - Transcript sem a última mensagem
   */
  function removeLastMessageFromTranscript(transcript, lastMsg) {
    if (!transcript || !lastMsg) return transcript;
    
    const normalizedLast = lastMsg.trim().toLowerCase();
    if (normalizedLast.length < 5) return transcript; // Muito curta para comparar
    
    const lines = transcript.split('\n');
    
    // Procurar de trás para frente
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim().toLowerCase();
      // Remover prefixo "Cliente: " ou "Atendente: " antes de comparar
      const cleanLine = line.replace(/^(cliente|atendente):\s*/i, '');
      
      if (cleanLine.includes(normalizedLast) || normalizedLast.includes(cleanLine)) {
        return lines.slice(0, i).join('\n').trim();
      }
    }
    
    return transcript;
  }

  /**
   * Classifica o tipo de erro para decisão inteligente de fallback
   * @param {Error} error - Erro a classificar
   * @returns {string} - Tipo do erro
   */
  function classifyError(error) {
    if (!error) return 'unknown';
    
    const msg = (error.message || '').toLowerCase();
    const code = error.code || error.status || '';
    
    // Erros de rede
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch') ||
        msg.includes('net::') || msg.includes('connection') || msg.includes('offline')) {
      return 'network';
    }
    
    // Timeout
    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
      return 'timeout';
    }
    
    // Erros de API (quota, auth, rate limit)
    if (code === 401 || code === 403 || code === 429 || 
        msg.includes('quota') || msg.includes('rate limit') || 
        msg.includes('unauthorized') || msg.includes('api key')) {
      return 'api_error';
    }
    
    // Sem provider configurado
    if (msg.includes('no provider') || msg.includes('provider not configured')) {
      return 'no_provider';
    }
    
    return 'unknown';
  }

  /**
   * Estado de componentes ativos (para UI)
   */
  const activeComponents = {
    kb: false,
    fewShot: false,
    memory: false,
    persona: false
  };

  function getActiveComponents() {
    return { ...activeComponents };
  }

  // Expor para UI
  window.WHLAIComponents = { getActiveComponents };

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

  function getMemoryForChat(chatId) {
    try {
      const ms = window.memorySystem;
      if (!ms || typeof ms.getChatKey !== 'function' || typeof ms.getMemory !== 'function') return null;

      if (safeText(chatId)) {
        const k1 = ms.getChatKey(chatId);
        const m1 = ms.getMemory(k1);
        if (m1) return m1;
      }

      const title = getChatTitleFromDOM();
      if (safeText(title)) {
        const k2 = ms.getChatKey(title);
        const m2 = ms.getMemory(k2);
        if (m2) return m2;
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    return null;
  }

  /**
   * Obtém memória do chat aguardando inicialização (com timeout).
   * Não quebra o fluxo: se expirar, retorna null.
   */
  async function getMemoryForChatSafe(chatId, timeoutMs = 2000) {
    try {
      // Se já está pronto, usar imediatamente
      if (window.memorySystem?.initialized) {
        return getMemoryForChat(chatId);
      }

      // Tentar iniciar se existir init()
      if (window.memorySystem && typeof window.memorySystem.init === 'function' && !window.memorySystem.initialized) {
        try { await window.memorySystem.init(); } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
      }

      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (window.memorySystem?.initialized) {
          return getMemoryForChat(chatId);
        }
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    return null;
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

  // FIX: era `function` síncrona mas usa `await` internamente (linha ~304 com KB.init).
  // Sem async, todo o módulo falha em SyntaxError ao carregar.
  async function buildRobustPromptMessages({ chatId, transcript, lastUserMsg }) {
    const messages = [];

    // Detecção de idioma via i18n
    let languageInstruction = 'Use linguagem natural em pt-BR.';
    let currentLang = 'pt-BR';
    try {
      if (window.i18nManager?.getCurrentLanguage) {
        currentLang = window.i18nManager.getCurrentLanguage();
        const langInstructions = {
          'pt-BR': 'Use linguagem natural em pt-BR.',
          'en-US': 'Use natural language in American English.',
          'es-ES': 'Usa lenguaje natural en español.',
          'fr-FR': 'Utilisez un langage naturel en français.',
          'de-DE': 'Verwende natürliche Sprache auf Deutsch.'
        };
        languageInstruction = langInstructions[currentLang] || languageInstruction;
        log(`🌍 Idioma detectado: ${currentLang}`);
      }
    } catch (e) {
      log('⚠️ Detecção de idioma falhou, usando pt-BR');
    }

    const baseRules = `Você é um assistente de atendimento no WhatsApp.\nObjetivo: responder rápido, claro, profissional e humano, sem inventar informações.\n\nRegras:\n- Nunca invente dados (preços, prazos, políticas). Se não souber, pergunte objetivamente ou diga que precisa confirmar.\n- Não peça dados sensíveis desnecessários.\n- Leia o histórico e responda à ÚLTIMA mensagem do cliente.\n- Seja direto e útil. Se necessário, use lista curta (máximo 4 itens).\n- ${languageInstruction}\n- Responda SOMENTE com o texto final pronto para enviar (sem markdown, sem explicações).`;

    const systemParts = [baseRules];

    // v9.5.4: Conversation-phase signal helps the model adjust tone (rapport vs closing).
    if (state.conversationPhase) {
      const cp = state.conversationPhase;
      systemParts.push(`FASE DA CONVERSA: ${cp.phase} (${cp.count} mensagens trocadas).\nDicas: ${cp.hint}`);
    }

    // v9.5.5: Specialized assistant routing — if customer message matches a known
    // sales situation (offer/discount, objection/hesitation, recovery), inject the
    // domain-specific playbook + 1-2 examples. Falls through silently when nothing matches.
    let specialistPicked = null;
    try {
      if (window.WHLAssistants && typeof window.WHLAssistants.pickAssistant === 'function') {
        const profile = window.aiMemoryAdvanced?.getProfile?.(chatId);
        const picked = window.WHLAssistants.pickAssistant(transcript, lastUserMsg, profile);
        if (picked) {
          specialistPicked = picked;
          systemParts.push(`ASSISTENTE ESPECIALIZADO ATIVADO: ${picked.name} (confiança ${Math.round(picked.confidence * 100)}%)\n${picked.promptAddition}`);
          state.lastAssistantUsed = picked.id;
          if (window.EventBus) {
            window.EventBus.emit('ai:assistant:picked', { assistantId: picked.id, confidence: picked.confidence, chatId });
          }
        }
      }
    } catch (e) {
      log('[Assistants] Erro ao escolher especialista:', e?.message);
    }

    // Persona (se CopilotEngine estiver disponível)
    try {
      const persona = window.CopilotEngine?.getActivePersona?.();
      if (safeText(persona?.systemPrompt)) {
        systemParts.push(`PERSONA (regras extras):\n${safeText(persona.systemPrompt)}`);
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

    // Contexto robusto do negócio (KB)
    let kbLoaded = false;
    try {
      // AI-001 FIX: Ensure KB is initialized before reading
      if (window.knowledgeBase && !window.knowledgeBase.initialized) {
        try {
          console.log('[AI-001] KB not initialized, awaiting init()...');
          await window.knowledgeBase.init();
          console.log('[AI-001] ✅ KB initialized successfully');
        } catch (e) {
          console.warn('[AI-001] KB init failed:', e.message);
        }
      }

      if (window.knowledgeBase && typeof window.knowledgeBase.buildSystemPrompt === 'function') {
        const personaId = window.CopilotEngine?.getActivePersona?.()?.id || 'professional';
        // v9.5.4: Use semantic retrieval (RAG) when available — pulls top-K relevant FAQs/products
        // by embedding similarity instead of stuffing top-N verbatim. Falls back gracefully.
        let kbPrompt;
        if (typeof window.knowledgeBase.buildSystemPromptRAG === 'function') {
          kbPrompt = safeText(await window.knowledgeBase.buildSystemPromptRAG(transcript || '', { persona: personaId, topK: 5 }));
        } else {
          kbPrompt = safeText(window.knowledgeBase.buildSystemPrompt({ persona: personaId, businessContext: true }));
        }
        if (kbPrompt) {
          systemParts.push(`CONTEXTO DO NEGÓCIO (use como verdade):\n${kbPrompt}`);
          kbLoaded = true;
        }
      } else {
        log('⚠️ KnowledgeBase não disponível - FAQs e produtos não serão usados');
        if (window.EventBus) {
          window.EventBus.emit('ai:kb:unavailable', { reason: 'module_not_loaded' });
        }
      }
    } catch (kbError) {
      log('⚠️ Erro ao carregar KnowledgeBase:', kbError.message);
      if (window.EventBus) {
        window.EventBus.emit('ai:kb:error', { error: kbError.message });
      }
    }

    // Memória do contato - preferir memória já carregada; o wait com timeout é feito em generateSuggestion()
    let memory = null;
    try {
      if (window.memorySystem?.initialized) {
        memory = getMemoryForChat(chatId);
      }
    } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
    const memText = formatMemoryForPrompt(memory);
    if (memText) systemParts.push(`MEMÓRIA deste contato:\n${memText}`);

    messages.push({ role: 'system', content: systemParts.filter(Boolean).join('\n\n') });

    // v9.5.5: If a specialist matched, inject its 1-2 canned examples BEFORE the few-shot
    // examples so the model strongly anchors on the playbook style for this turn.
    if (specialistPicked && Array.isArray(specialistPicked.examples)) {
      for (const ex of specialistPicked.examples.slice(0, 2)) {
        if (ex?.user && ex?.assistant) {
          messages.push({ role: 'user', content: safeText(ex.user) });
          messages.push({ role: 'assistant', content: safeText(ex.assistant) });
        }
      }
    }

    // Few-shot (exemplos) para coerência - COM VALIDAÇÃO E WARNING
    let fewShotLoaded = false;
    try {
      const fsl = window.fewShotLearning;
      // AI-002 FIX: Ensure FSL is initialized before reading
      if (fsl && !fsl.initialized) {
        try {
          console.log('[AI-002] FSL not initialized, awaiting init()...');
          await fsl.init();
          console.log('[AI-002] ✅ FSL initialized successfully');
        } catch (e) {
          console.warn('[AI-002] FSL init failed:', e.message);
        }
      }

      if (fsl) {
        const picked = fsl?.pickRelevantExamples?.(transcript, 3) || fsl?.pickExamples?.(null, transcript, 3) || [];
        if (Array.isArray(picked) && picked.length) {
          picked.forEach(ex => {
            const u = safeText(ex?.user || ex?.input);
            const a = safeText(ex?.assistant || ex?.output);
            if (u && a) {
              messages.push({ role: 'user', content: u });
              messages.push({ role: 'assistant', content: a });
            }
          });
          fewShotLoaded = true;
          // v9.5.2: Reinforce usage counter for selected examples so the system learns which examples actually help.
          if (typeof fsl.incrementUsage === 'function') {
            picked.forEach(ex => { if (ex?.id != null) fsl.incrementUsage(ex.id).catch(() => {}); });
          }
        }
      } else {
        log('⚠️ FewShotLearning não disponível - exemplos de treinamento não serão usados');
        if (window.EventBus) {
          window.EventBus.emit('ai:fewshot:unavailable', { reason: 'module_not_loaded' });
        }
      }
    } catch (e) {
      log('⚠️ Erro ao carregar Few-Shot:', e.message);
      if (window.EventBus) {
        window.EventBus.emit('ai:fewshot:error', { error: e.message });
      }
    }
    
    // v7.9.13: Log consolidado de status do treinamento
    if (!kbLoaded && !fewShotLoaded) {
      log('⚠️ ATENÇÃO: Sugestão será gerada SEM treinamento (KB e Few-Shot indisponíveis)');
    }

    // CORREÇÃO v7.9.13: Evitar duplicação usando removeLastMessageFromTranscript
    const cleanTranscript = safeText(transcript);
    const cleanLastMsg = safeText(lastUserMsg);
    
    // Histórico da conversa - removendo a última mensagem para evitar duplicação
    if (cleanTranscript && cleanLastMsg) {
      // Usar a nova função de remoção segura
      const transcriptWithoutLast = removeLastMessageFromTranscript(cleanTranscript, cleanLastMsg);
      
      if (transcriptWithoutLast && transcriptWithoutLast.length > 50) {
        messages.push({ 
          role: 'user', 
          content: `HISTÓRICO (resumo linear):\n${transcriptWithoutLast.slice(-4000)}` 
        });
      }
    } else if (cleanTranscript) {
      // Sem lastUserMsg, usar transcript completo
      messages.push({ 
        role: 'user', 
        content: `HISTÓRICO (resumo linear):\n${cleanTranscript.slice(-4000)}` 
      });
    }

    // Última mensagem do cliente por último (destaque para contexto imediato)
    // Agora SEM duplicação pois foi removida do transcript
    if (cleanLastMsg) {
      messages.push({ role: 'user', content: `ÚLTIMA MENSAGEM DO CLIENTE:\n${cleanLastMsg}` });
    }

    // Atualizar estado de componentes
    activeComponents.kb = kbLoaded;
    activeComponents.fewShot = fewShotLoaded;
    activeComponents.memory = !!memText;
    activeComponents.persona = !!(window.CopilotEngine?.getActivePersona?.());

    return messages;
  }

  // ============================================
  // ESTILOS
  // ============================================

  function injectStyles() {
    if (document.getElementById('whl-ai-btn-styles')) return;

    const style = document.createElement('style');
    style.id = 'whl-ai-btn-styles';
    style.textContent = `
      #${CONFIG.BUTTON_ID} {
        position: absolute;
        bottom: 54px;
        right: 12px;
        width: ${CONFIG.BUTTON_SIZE}px;
        height: ${CONFIG.BUTTON_SIZE}px;
        border-radius: 50%;
        background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
        border: 2px solid rgba(255,255,255,0.2);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 16px rgba(59, 130, 246, 0.5);
        transition: all 0.3s ease;
        z-index: 1000;
        font-size: 20px;
      }

      #${CONFIG.BUTTON_ID}:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 20px rgba(59, 130, 246, 0.6);
      }

      #${CONFIG.BUTTON_ID}:active {
        transform: scale(0.95);
      }

      #${CONFIG.BUTTON_ID}.generating {
        animation: ai-pulse 1.2s ease-in-out infinite;
      }

      @keyframes ai-pulse {
        0%, 100% { box-shadow: 0 4px 16px rgba(59, 130, 246, 0.5); }
        50% { box-shadow: 0 4px 24px rgba(59, 130, 246, 0.8); }
      }

      #${CONFIG.PANEL_ID} {
        position: absolute;
        bottom: 100px;
        right: 12px;
        width: 340px;
        max-height: 250px;
        background: rgba(20, 20, 40, 0.98);
        border: 1px solid rgba(139, 92, 246, 0.4);
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(20px);
        opacity: 0;
        transform: translateY(10px) scale(0.95);
        pointer-events: none;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 999;
        overflow: hidden;
      }

      #${CONFIG.PANEL_ID}.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }

      .whl-ai-header {
        background: linear-gradient(135deg, #3B82F6 0%, #2563EB 100%);
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .whl-ai-title {
        color: white;
        font-size: 13px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .whl-ai-close {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }

      .whl-ai-close:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .whl-ai-body {
        padding: 14px;
        color: #e5e7eb;
        font-size: 13px;
        line-height: 1.6;
        max-height: 180px;
        overflow-y: auto;
      }

      .whl-ai-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        gap: 12px;
        color: #9ca3af;
      }

      .whl-ai-spinner {
        width: 22px;
        height: 22px;
        border: 3px solid rgba(59, 130, 246, 0.3);
        border-top-color: #3B82F6;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .whl-ai-suggestion {
        cursor: pointer;
        padding: 12px;
        background: rgba(59, 130, 246, 0.1);
        border-radius: 10px;
        border: 1px solid rgba(59, 130, 246, 0.3);
        transition: all 0.2s;
      }

      .whl-ai-suggestion:hover {
        background: rgba(59, 130, 246, 0.2);
        border-color: rgba(59, 130, 246, 0.5);
      }

      .whl-ai-error {
        color: #f87171;
        text-align: center;
        padding: 24px;
      }

      .whl-ai-hint {
        font-size: 11px;
        color: rgba(255,255,255,0.5);
        text-align: center;
        padding: 8px;
        background: rgba(0,0,0,0.2);
      }
    `;

    document.head.appendChild(style);
  }

  // ============================================
  // CRIAR ELEMENTOS
  // ============================================

  function createButton() {
    const btn = document.createElement('button');
    btn.id = CONFIG.BUTTON_ID;
    btn.innerHTML = '🤖';
    btn.title = 'Gerar Sugestão de IA';
    btn.addEventListener('click', handleClick);
    return btn;
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = CONFIG.PANEL_ID;
    panel.innerHTML = `
      <div class="whl-ai-header">
        <div class="whl-ai-title">
          <span>🤖</span>
          <span>Sugestão de IA</span>
        </div>
        <button class="whl-ai-close" id="whl-ai-close">✕</button>
      </div>
      <div class="whl-ai-body" id="whl-ai-body">
        <div class="whl-ai-loading">
          <div class="whl-ai-spinner"></div>
          <span>Pronto para gerar</span>
        </div>
      </div>
    `;

    panel.querySelector('#whl-ai-close').addEventListener('click', hidePanel);
    return panel;
  }

  // ============================================
  // INJEÇÃO NO DOM
  // ============================================

  function inject() {
    // Remover existentes
    document.getElementById(CONFIG.BUTTON_ID)?.remove();
    document.getElementById(CONFIG.PANEL_ID)?.remove();

    // Encontrar footer do WhatsApp
    const footerSelectors = [
      '#main footer',
      'footer[data-testid]',
      '#main > div:last-child',
      'footer'
    ];

    let footer = null;
    for (const sel of footerSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetWidth) {
        footer = el;
        log('Footer encontrado:', sel);
        break;
      }
    }

    // Fallback: encontrar via input
    if (!footer) {
      const input = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                    document.querySelector('footer div[contenteditable="true"]');
      if (input) {
        footer = input.closest('footer') || input.closest('#main')?.querySelector('div:last-child');
      }
    }

    if (!footer) {
      log('Footer não encontrado');
      return false;
    }

    // Garantir position relative
    if (window.getComputedStyle(footer).position === 'static') {
      footer.style.position = 'relative';
    }

    // Injetar
    injectStyles();
    footer.appendChild(createButton());
    footer.appendChild(createPanel());

    state.injected = true;
    log('✅ Botão de IA injetado');
    return true;
  }

  // ============================================
  // HANDLERS
  // ============================================

  async function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (state.panelVisible) {
      hidePanel();
    } else {
      await generateSuggestion();
    }
  }

  async function generateSuggestion() {
    if (state.generating) return;

    state.generating = true;
    showPanel();
    showLoading('Analisando conversa...');

    const btn = document.getElementById(CONFIG.BUTTON_ID);
    if (btn) btn.classList.add('generating');

    try {
      // Extrair mensagens do DOM
      const messages = extractMessages();

      if (messages.length === 0) {
        showError('Nenhuma mensagem encontrada');
        return;
      }

      const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
      let suggestion = null;
      // v9.5.4: Track which tier produced the suggestion for observability/telemetry.
      let tierUsed = null;
      const tierStart = Date.now();

      // ChatKey consistente (id do WhatsApp quando disponível, senão título)
      const chatId = getActiveChatId();
      const chatKey = safeText(chatId) || safeText(getChatTitleFromDOM()) || 'active_chat';
      const transcript = buildTranscriptFromMessages(messages);

      // v9.5.4: Conversation-phase signal. The model uses message count + last-customer-msg signals
      // to decide between rapport, qualification, closing, post-sale tone.
      const conversationPhase = (() => {
        const count = messages.length;
        if (count <= 2) return { phase: 'inicial', count, hint: 'cliente novo, foque em entender necessidade' };
        if (count <= 8) return { phase: 'qualificacao', count, hint: 'descobrir intenção e contexto' };
        if (count <= 20) return { phase: 'desenvolvimento', count, hint: 'apresentar valor, responder objeções' };
        if (count <= 40) return { phase: 'fechamento', count, hint: 'cliente engajado, mover para decisão' };
        return { phase: 'pos_engajamento', count, hint: 'manter relacionamento, evitar repetições' };
      })();
      state.conversationPhase = conversationPhase;

      // Atualizar memória rapidamente (não bloqueante)
      try {
        const autoMem = window.MemorySystem?.autoUpdateMemory || window.autoUpdateMemory;
        if (typeof autoMem === 'function' && safeText(transcript).length >= 60) {
          autoMem(transcript, chatKey, 150);
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

      // v9.5.3: Update ai-memory-advanced profile (style, topics, buying intent) on every suggestion.
      // Previously only happened in CopilotEngine fallback path — primary backend path missed it,
      // so customer profile data was effectively frozen for users on the active backend tier.
      try {
        if (window.aiMemoryAdvanced && typeof window.aiMemoryAdvanced.analyzeAndUpdateFromMessage === 'function' && lastUserMsg) {
          // Fire-and-forget — must not block suggestion latency.
          window.aiMemoryAdvanced.analyzeAndUpdateFromMessage(chatKey, lastUserMsg, true)
            .catch(e => log('aiMemoryAdvanced update falhou:', e?.message));
        }
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

      const hasProviders = window.AIService?.getConfiguredProviders?.()?.length > 0;

      // v7.9.13: Garantir que a memória tenha chance de carregar antes de montar prompt robusto
      // (não trava: timeout curto)
      try {
        await getMemoryForChatSafe(chatKey, 2000);
      } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }

      // MÉTODO 0 (v9.3.0 — PRIORIDADE MÁXIMA): Backend AIOrchestrator real
      //
      // Por que este método vem PRIMEIRO:
      //   O AIOrchestrator do backend executa o pipeline completo:
      //     1. ConversationMemory.getContext (memória persistida no DB, multi-tenant)
      //     2. HybridIntentClassifier.classify (intent + confidence)
      //     3. HybridSearch (RAG na knowledge base do workspace)
      //     4. CommercialIntelligenceEngine (objetivo comercial: qualificar/fechar/etc)
      //     5. StrategySelector (escolhe estratégia baseado em outcomes anteriores)
      //     6. ClientBehaviorAdapter (estilo, energia, momento de fechamento)
      //     7. ValidatedLearningPipeline.getTopGraduated (few-shot ≥80% positivo)
      //     8. DynamicPromptBuilder (monta system prompt com TUDO acima)
      //     9. AIRouterService.complete (provider com fallback automático + circuit breaker)
      //    10. ResponseQualityChecker (cycle com até 2 retries se quality < threshold)
      //    11. ResponseSafetyFilter (bloqueia conteúdo problemático)
      //    12. AutoLearningLoop.trackSent (registra envio para tracking de outcome)
      //
      // Antes (v9.2.0): este pipeline ficava DORMENTE — extensão chamava direto OpenAI
      // crua via AIGateway, perdendo todas as 12 camadas de inteligência.
      //
      // Fallback automático: se backend offline ou timeout > 28s, cai pros métodos abaixo.
      if (!suggestion && window.BackendClient?.isConnected?.() && typeof window.BackendClient.ai?.process === 'function') {
        try {
          log('🧠 Tentando MÉTODO 0: Backend AIOrchestrator');
          // Atualiza loading pra dar feedback visual (orchestrator pode levar 5-15s)
          showLoading('Consultando inteligência avançada...');

          // Timeout 18s: backend tem quality cycle (até 2 retries de LLM ~6s cada).
          // Se passar disso, provavelmente está sob carga ou caiu — vai pro fallback local.
          const orchestrated = await Promise.race([
            window.BackendClient.ai.process(chatKey, lastUserMsg, {
              language: 'pt-BR',
            }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('orchestrator_timeout')), 18000)),
          ]);

          if (orchestrated?.success && orchestrated?.response) {
            suggestion = String(orchestrated.response).trim();
            tierUsed = 'tier_0_backend_orchestrator';

            // Persistir interactionId para feedback loop funcionar
            // (recordFeedback usa este ID pra fechar o loop de aprendizado)
            if (orchestrated.metadata?.interactionId) {
              state.lastInteractionId = orchestrated.metadata.interactionId;
            }
            // Expor metadata pra UI (qualityScore, clientStage, intent, etc.)
            state.lastMetadata = orchestrated.metadata || null;
            state.lastIntelligence = orchestrated.intelligence || null;

            log(`✅ Sugestão via BACKEND ORCHESTRATOR (intent=${orchestrated.metadata?.intent}, quality=${orchestrated.metadata?.qualityScore?.toFixed?.(2) || '?'})`);

            // Emite evento — UI pode mostrar metadados de inteligência
            if (window.EventBus) {
              window.EventBus.emit('ai:orchestrator:success', {
                interactionId: orchestrated.metadata?.interactionId,
                intelligence: orchestrated.intelligence,
              });
            }
          } else if (orchestrated?.error) {
            log('Backend orchestrator retornou erro:', orchestrated.error);
          }
        } catch (e) {
          // Backend offline / timeout / 401 / 402 → cai pros métodos seguintes
          log('Backend orchestrator falhou (cairá pra fallback):', e?.message || e);
          // Se foi 402 (sem créditos), interrompe — não chame OpenAI direto sem cobrar
          if (e?.status === 402 || /payment.required|insufficient.*token/i.test(String(e?.message))) {
            showError('Sem créditos suficientes. Recarregue tokens no portal.');
            return;
          }
        }
      }

      // MÉTODO 1: CopilotEngine (extensão local — fallback se backend offline)
      if (!suggestion && hasProviders && window.CopilotEngine?.analyzeMessage && window.CopilotEngine?.generateResponse) {
        try {
          // Garantir contexto atualizado no CopilotEngine
          if (window.CopilotEngine.loadConversationContext) {
            await window.CopilotEngine.loadConversationContext(chatKey, true);
          }

          const analysis = await window.CopilotEngine.analyzeMessage(lastUserMsg, chatKey);
          const resp = await window.CopilotEngine.generateResponse(chatKey, analysis, { maxTokens: 260 });
          if (resp?.content) {
            suggestion = resp.content.trim();
            tierUsed = 'tier_1_copilot_engine';
            log('✅ Sugestão via CopilotEngine (robusto)');
          }
        } catch (e) {
          log('CopilotEngine falhou:', e);
        }
      }

      // MÉTODO 2: AIService direto com prompt robusto (fallback)
      if (!suggestion && hasProviders && window.AIService?.complete) {
        try {
          // FIX: buildRobustPromptMessages agora é async (precisa do await)
          const promptMessages = await buildRobustPromptMessages({ chatId: chatKey, transcript, lastUserMsg });
          const result = await window.AIService.complete(promptMessages, {
            temperature: 0.7,
            maxTokens: 260
          });
          if (result?.content) {
            suggestion = result.content.trim();
            tierUsed = 'tier_2_ai_service';
            log('✅ Sugestão via AIService (prompt robusto)');
          }
        } catch (e) {
          log('AIService (robusto) falhou:', e);
        }
      }

      // MÉTODO 3: SmartSuggestions (local, sem API) — somente se não houver IA
      if (!suggestion && window.SmartSuggestions?.getSuggestion) {
        try {
          const result = window.SmartSuggestions.getSuggestion(lastUserMsg, messages);
          if (result?.text) {
            suggestion = result.text;
            tierUsed = 'tier_3_smart_suggestions';
            log('✅ Sugestão via SmartSuggestions:', result.category);
          }
        } catch (e) {
          log('SmartSuggestions falhou:', e);
        }
      }

      // MÉTODO 4: BackendClient (usa .complete, não .chat)
      if (!suggestion && window.BackendClient?.isConnected?.()) {
        try {
          const result = await window.BackendClient.ai.complete({
            messages: [
              { role: 'system', content: 'Você é um assistente de atendimento profissional. Gere respostas úteis e concisas em português.' },
              { role: 'user', content: `Última mensagem do cliente: ${lastUserMsg}\n\nGere uma resposta profissional.` }
            ]
          });
          if (result?.text) {
            suggestion = result.text.trim();
            tierUsed = 'tier_4_backend_complete';
            log('✅ Sugestão via BackendClient');
          }
        } catch (e) {
          log('BackendClient falhou:', e);
        }
      }

      // MÉTODO 5: Decisão inteligente sobre fallback vs erro
      // v7.9.13: Usar classifyError para decisão mais precisa
      if (!suggestion) {
        if (hasProviders) {
          // Providers configurados mas todos falharam - mostrar erro com retry
          log('❌ Todos os providers de IA falharam');
          
          // Mostrar UI de erro com opção de retry
          showErrorWithRetry('IA temporariamente indisponível', lastUserMsg);
          
          // Emitir evento para UI
          if (window.EventBus) {
            window.EventBus.emit('ai:all-providers-failed', { chatKey, lastUserMsg });
          }
          return;
        } else {
          // Nenhum provider configurado - usar fallback local (esperado)
          suggestion = generateFallbackSuggestion(lastUserMsg);
          tierUsed = 'tier_5_local_fallback';
          log('✅ Sugestão via fallback local (sem providers configurados)');
        }
      }

      // v9.5.4: Emit tier observability event so operators can see Tier 0=85% / Tier 1=12% etc.
      if (suggestion && tierUsed && window.EventBus) {
        const latency = Date.now() - tierStart;
        window.EventBus.emit('ai:tier:hit', {
          tier: tierUsed,
          latency,
          chatKey,
          phase: state.conversationPhase?.phase
        });
        state.lastTierUsed = tierUsed;
        state.lastTierLatency = latency;
      }

      // v9.5.3: Apply safety filter (PII leak / blocked patterns / hallucination disclaimers)
      // Defense-in-depth — Tier 0 backend has its own filter, this catches local-fallback paths.
      if (suggestion && window.aiSafetyFilter && typeof window.aiSafetyFilter.validate === 'function') {
        try {
          const safetyResult = window.aiSafetyFilter.validate(suggestion, { intent: state.lastMetadata?.intent });
          if (!safetyResult.safe) {
            const highSev = safetyResult.issues.filter(i => i.severity === 'high');
            log('⚠️ Sugestão bloqueada pelo safety filter:', highSev.map(i => i.type).join(', '));
            if (window.EventBus) {
              window.EventBus.emit('ai:safety:blocked', { issues: highSev });
            }
            // Hard block: don't show unsafe content. Use neutral fallback instead.
            suggestion = generateFallbackSuggestion(lastUserMsg);
          } else if (safetyResult.modifiedResponse && safetyResult.modifiedResponse !== suggestion) {
            // Soft modification (disclaimer added) — use it.
            suggestion = safetyResult.modifiedResponse;
            log('ℹ️ Safety filter aplicou disclaimer (não bloqueou):', safetyResult.issues.map(i => i.type).join(', '));
            // v9.5.4: Surface to user — they should know the system added a disclaimer.
            try {
              const types = safetyResult.issues.map(i => i.type);
              const friendly = types.includes('sensitive_topic') ? 'Aviso adicionado (tópico sensível)'
                : types.includes('potential_hallucination') ? 'Aviso adicionado (verificar informação)'
                : types.includes('inappropriate_tone') ? 'Tom ajustado para mais empatia'
                : 'Aviso adicionado automaticamente';
              if (window.NotificationsModule?.toast) {
                window.NotificationsModule.toast(`ℹ️ ${friendly}`, 'info', 2500);
              }
            } catch (_) {}
          }
        } catch (sfErr) {
          log('Safety filter erro (ignorando, prosseguindo):', sfErr?.message);
        }
      }

      if (suggestion) {
        showSuggestion(suggestion);
      } else {
        showError('Não foi possível gerar sugestão');
      }

    } catch (error) {
      console.error('[AI-Btn] Erro:', error);
      // Usar fallback em caso de erro
      const lastMsg = extractMessages().filter(m => m.role === 'user').pop()?.content || '';
      const fallback = generateFallbackSuggestion(lastMsg);
      showSuggestion(fallback);
    } finally {
      state.generating = false;
      const btn = document.getElementById(CONFIG.BUTTON_ID);
      if (btn) btn.classList.remove('generating');
    }
  }

  function buildPrompt(context, lastMsg) {
    return `Você é um assistente de atendimento profissional e amigável. Baseado na conversa abaixo, gere UMA resposta apropriada para a última mensagem do cliente.

CONVERSA:
${context}

ÚLTIMA MENSAGEM DO CLIENTE: ${lastMsg}

INSTRUÇÕES:
- Seja profissional mas cordial
- Responda em português brasileiro
- Máximo 2-3 frases
- Não use saudações se a conversa já começou
- Seja útil e objetivo

Responda APENAS com o texto da sugestão:`;
  }

  function generateFallbackSuggestion(msg) {
    const lower = (msg || '').toLowerCase();

    // Saudações
    if (lower.match(/\b(oi|olá|ola|bom dia|boa tarde|boa noite|eai|e ai|hey|opa)\b/)) {
      return 'Olá! Como posso ajudar você hoje? 😊';
    }
    
    // Agradecimentos
    if (lower.match(/\b(obrigad|valeu|thanks|brigad|grato|agradec)\b/)) {
      return 'Por nada! Se precisar de mais alguma coisa, estou à disposição 😊';
    }
    
    // Preço/valor
    if (lower.match(/\b(preço|preco|valor|quanto custa|quanto é|quanto e|custo|orçamento|orcamento)\b/)) {
      return 'O valor varia de acordo com o produto/serviço escolhido. Posso detalhar as opções disponíveis para você. Qual item específico gostaria de saber?';
    }
    
    // Entrega/prazo
    if (lower.match(/\b(entrega|prazo|envio|chega|demora|tempo|frete)\b/)) {
      return 'O prazo de entrega é de 5 a 7 dias úteis após confirmação do pagamento. Para sua região, posso verificar opções mais rápidas se preferir.';
    }
    
    // Pagamento
    if (lower.match(/\b(pix|pagamento|pagar|cartão|cartao|boleto|parcel)\b/)) {
      return 'Aceitamos PIX (com desconto), cartão de crédito em até 12x e boleto bancário. Qual forma de pagamento prefere?';
    }
    
    // Disponibilidade
    if (lower.match(/\b(disponível|disponivel|tem|estoque|ainda tem|acabou)\b/)) {
      return 'Vou verificar a disponibilidade para você. Um momento, por favor!';
    }
    
    // Dúvidas/ajuda
    if (lower.match(/\b(dúvida|duvida|ajuda|help|não sei|nao sei|como funciona)\b/)) {
      return 'Claro, estou aqui para ajudar! Pode me explicar melhor sua dúvida que respondo com prazer.';
    }
    
    // Problema/reclamação
    if (lower.match(/\b(problema|erro|não funciona|nao funciona|defeito|quebr|estrago)\b/)) {
      return 'Lamento pelo inconveniente! Vou verificar isso imediatamente. Pode me dar mais detalhes sobre o problema?';
    }
    
    // Espera/aguardar
    if (lower.match(/\b(espera|aguard|demora|responde|online)\b/)) {
      return 'Desculpe pela espera! Estou verificando sua solicitação e já retorno com uma resposta.';
    }
    
    // Tchau/encerramento
    if (lower.match(/\b(tchau|adeus|até mais|ate mais|obg|flw|falou|bye)\b/)) {
      return 'Foi um prazer atendê-lo! Qualquer coisa, estamos à disposição. Tenha um ótimo dia! 😊';
    }
    
    // Horário
    if (lower.match(/\b(horário|horario|funciona|atend|abre|fecha)\b/)) {
      return 'Nosso horário de atendimento é de segunda a sexta, das 9h às 18h. Aos sábados das 9h às 13h.';
    }
    
    // Localização
    if (lower.match(/\b(endereço|endereco|onde fica|localiza|mapa)\b/)) {
      return 'Posso enviar nossa localização. Você prefere retirar pessoalmente ou prefere que façamos a entrega?';
    }

    // Fallback genérico baseado no tipo de pergunta
    if (lower.includes('?')) {
      return 'Entendi sua dúvida. Deixa eu verificar isso e já te respondo com mais detalhes.';
    }

    // Fallback final
    return 'Entendi! Posso ajudar com mais alguma informação?';
  }

  // ============================================
  // EXTRAÇÃO DE MENSAGENS
  // ============================================

  function extractMessages() {
    const messages = [];

    try {
      // Encontrar container de mensagens
      const containerSelectors = [
        '[data-testid="conversation-panel-messages"]',
        'div[data-testid="msg-container"]',
        '#main div[role="application"]',
        '#main .copyable-area'
      ];

      let container = null;
      for (const sel of containerSelectors) {
        container = document.querySelector(sel);
        if (container) break;
      }

      if (!container) {
        container = document.querySelector('#main');
      }

      if (!container) return messages;

      // Buscar mensagens (inclui mensagens de sistema)
      const msgElements = container.querySelectorAll(
        '[data-testid="msg-container"], .message-in, .message-out, .message-system, [data-testid*="system-message"]'
      );

      const isSystemMessage = (el) => {
        try {
          if (el.classList?.contains('message-system')) return true;
          const testId = (el.getAttribute && el.getAttribute('data-testid')) ? el.getAttribute('data-testid') : '';
          if (testId && testId.toLowerCase().includes('system')) return true;
          if (el.querySelector?.('[data-testid*="system-message"]')) return true;
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
        return false;
      };

      const extractSystemMessageText = (el) => {
        try {
          const selectors = [
            '[data-testid="system-message-text"]',
            '[data-testid*="system-message"]',
            '.copyable-text span',
            'span.selectable-text',
            'span[dir="ltr"]'
          ];
          for (const sel of selectors) {
            const t = el.querySelector?.(sel)?.textContent?.trim();
            if (t) return t;
          }
          const raw = el.textContent?.trim();
          return raw || '';
        } catch (_) {
          return '';
        }
      };

      const detectNonTextType = (el) => {
        try {
          if (el.querySelector('video')) return 'video';
          if (el.querySelector('audio') || el.querySelector('[data-testid*="audio"]')) return 'audio';
          if (el.querySelector('[data-testid*="ptt"]') || el.querySelector('[data-icon*="ptt"]')) return 'ptt';
          if (el.querySelector('[data-testid*="sticker"]') || el.querySelector('img[alt*="sticker" i]')) return 'sticker';
          if (el.querySelector('[data-testid*="document"]') || el.querySelector('[data-icon*="document"]')) return 'document';
          // Imagem genérica (muito comum em mídia/sticker)
          if (el.querySelector('img')) return 'image';
        } catch (error) { try { globalThis.WHLLogger?.debug?.('[Suppressed]', error); } catch (_) {} }
        return null;
      };

      const placeholderForType = (type) => {
        switch (type) {
          case 'image': return '[MÍDIA: imagem]';
          case 'video': return '[MÍDIA: vídeo]';
          case 'audio': return '[MÍDIA: áudio]';
          case 'ptt': return '[MÍDIA: áudio (PTT)]';
          case 'sticker': return '[MÍDIA: figurinha]';
          case 'document': return '[MÍDIA: documento]';
          default: return '[MÍDIA]';
        }
      };

      for (const el of msgElements) {
        // Mensagens de sistema
        if (isSystemMessage(el)) {
          const sysText = extractSystemMessageText(el);
          if (sysText) {
            messages.push({ role: 'system', content: `[SISTEMA: ${sysText}]` });
          }
          continue;
        }

        // Detectar se é mensagem enviada ou recebida
        const isOutgoing = el.classList.contains('message-out') ||
                          el.querySelector('[data-testid="msg-dblcheck"]') ||
                          el.querySelector('[data-icon="msg-dblcheck"]') ||
                          el.querySelector('[data-icon="msg-check"]') ||
                          el.querySelector('[data-icon="tail-out"]');

        // Extrair texto
        const textEl = el.querySelector('[data-testid="msg-text"], .copyable-text span, .selectable-text span, span.selectable-text');
        const text = textEl?.textContent?.trim();

        if (text && text.length > 0) {
          messages.push({
            role: isOutgoing ? 'assistant' : 'user',
            content: text
          });
        } else {
          // Se a última mensagem for mídia/áudio/figurinha sem texto, incluir placeholder
          const mediaType = detectNonTextType(el);
          if (mediaType) {
            messages.push({
              role: isOutgoing ? 'assistant' : 'user',
              content: placeholderForType(mediaType)
            });
          }
        }
      }

      // Limitar a últimas 20 mensagens
      if (messages.length > 20) {
        return messages.slice(-20);
      }

      log(`Extraídas ${messages.length} mensagens`);
    } catch (e) {
      console.error('[AI-Btn] Erro ao extrair:', e);
    }

    return messages;
  }

  // ============================================
  // UI DO PAINEL
  // ============================================

  function showPanel() {
    const panel = document.getElementById(CONFIG.PANEL_ID);
    if (panel) {
      panel.classList.add('visible');
      state.panelVisible = true;
    }
  }

  function hidePanel() {
    const panel = document.getElementById(CONFIG.PANEL_ID);
    if (panel) {
      panel.classList.remove('visible');
      state.panelVisible = false;
    }
  }

  function showLoading(text = 'Gerando...') {
    const body = document.getElementById('whl-ai-body');
    if (!body) return;

    body.innerHTML = `
      <div class="whl-ai-loading">
        <div class="whl-ai-spinner"></div>
        <span>${text}</span>
      </div>
    `;
  }

  function showSuggestion(text) {
    const body = document.getElementById('whl-ai-body');
    if (!body) return;

    state.suggestion = text;
    state.suggestionShownAt = Date.now();

    // V3-004 FIX: Emit suggestion:shown for analytics and implicit tracking
    if (window.EventBus) {
      window.EventBus.emit('suggestion:shown', {
        suggestion: text,
        chatId: getActiveChatId() || null,
        shownAt: state.suggestionShownAt,
        source: 'ai-suggestion-button'
      });
    }

    body.innerHTML = `
      <div class="whl-ai-suggestion" id="whl-ai-sug-text">
        ${escapeHtml(text)}
      </div>
      <div class="whl-ai-hint">
        Clique para inserir no chat
      </div>
    `;

    body.querySelector('#whl-ai-sug-text').addEventListener('click', useSuggestion);
  }

  function showError(message) {
    const body = document.getElementById('whl-ai-body');
    if (!body) return;

    body.innerHTML = `
      <div class="whl-ai-error">
        <div style="font-size: 24px; margin-bottom: 8px;">❌</div>
        <div>${escapeHtml(message)}</div>
      </div>
    `;
  }

  /**
   * Mostra erro com opções de retry e fallback
   * @param {string} message - Mensagem de erro
   * @param {string} lastUserMsg - Última mensagem do usuário para fallback
   */
  function showErrorWithRetry(message, lastUserMsg) {
    const body = document.getElementById('whl-ai-body');
    if (!body) return;

    body.innerHTML = `
      <div style="padding: 16px; text-align: center;">
        <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
        <div style="color: #EF4444; margin-bottom: 16px; font-size: 14px;">${escapeHtml(message)}</div>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button id="whl-ai-retry" style="
            background: #3B82F6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
          ">🔄 Tentar Novamente</button>
          <button id="whl-ai-use-fallback" style="
            background: #6B7280;
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
          ">Usar Sugestão Básica</button>
        </div>
      </div>
    `;

    // Handler para retry
    document.getElementById('whl-ai-retry')?.addEventListener('click', () => {
      generateSuggestion();
    });

    // Handler para usar fallback
    document.getElementById('whl-ai-use-fallback')?.addEventListener('click', () => {
      const fallback = generateFallbackSuggestion(lastUserMsg);
      showSuggestion(fallback);
    });
  }

  async function useSuggestion() {
    if (!state.suggestion) return;

    try {
      await insertText(state.suggestion);
      hidePanel();

      // R-003 FIX: Emit suggestion:used for learning systems (matching AI-004 pattern)
      if (window.EventBus) {
        window.EventBus.emit('suggestion:used', {
          suggestion: state.suggestion,
          userMessage: '',
          chatId: getActiveChatId() || null,
          shownAt: state.suggestionShownAt || Date.now(),  // V3-004 FIX: Use stored timestamp
          wasEdited: false,
          source: 'ai-suggestion-button'
        });
      }

      // v9.3.0: snapshot dos campos relevantes ANTES das chamadas async pra evitar
      // race condition. Se generateSuggestion() rodar de novo enquanto feedback
      // está em flight, state.lastInteractionId/lastMetadata vão ser sobrescritos.
      // Snapshot garante que o feedback bata com a sugestão que o humano de fato usou.
      const usedInteractionId = state.lastInteractionId;
      const usedMetadata      = state.lastMetadata;
      const usedSuggestion    = state.suggestion;
      const usedChatId        = getActiveChatId() || null;

      // v9.3.0: fecha o feedback loop com o backend orchestrator.
      // Quando o usuário USA a sugestão sem editar, isso é sinal positivo forte
      // pro ValidatedLearningPipeline e pro AutoLearningLoop.
      if (usedInteractionId && window.BackendClient?.ai?.feedback) {
        // Reconstrói userMessage do contexto pra o endpoint de learn/feedback
        // (ele exige userMessage + assistantResponse pra gravar exemplo de treino)
        let lastUser = '';
        try {
          const msgs = extractMessages();
          lastUser = msgs.filter(m => m.role === 'user').pop()?.content || '';
        } catch (_) {}

        // Não-bloqueante: feedback async em background
        window.BackendClient.ai.feedback(usedInteractionId, 'positive', {
          chatId: usedChatId,
          userMessage: lastUser,
          assistantResponse: usedSuggestion,
          feedbackType: 'rating',
        }).catch(err => log('Feedback positivo falhou (não crítico):', err?.message));
      }

      // v9.3.0: registra outcome no autopilot maturity tracker.
      // 'approved' = humano enviou exatamente como sugerido (sucesso pleno).
      if (window.BackendClient?.autopilotMaturity?.record) {
        window.BackendClient.autopilotMaturity.record('approved', {
          interactionId: usedInteractionId,
          intent: usedMetadata?.intent || null,
        }).then(r => {
          // Se atingiu READY, notifica usuário
          if (r?.can_promote && window.NotificationsModule?.toast) {
            window.NotificationsModule.toast(
              `🎓 Autopilot pronto pra liberar! Taxa: ${(r.success_rate*100).toFixed(0)}%`,
              'success', 5000
            );
          }
        }).catch(err => log('Maturity record falhou (não crítico):', err?.message));
      }

      if (window.NotificationsModule?.toast) {
        window.NotificationsModule.toast('✅ Sugestão inserida', 'success', 1500);
      }
      
      // Registrar uso de sugestão no ConfidenceSystem
      if (window.confidenceSystem?.recordSuggestionUsed) {
        window.confidenceSystem.recordSuggestionUsed(false);
      }
    } catch (e) {
      console.error('[AI-Btn] Erro ao inserir:', e);
    }
  }

  async function insertText(text) {
    const composer = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                     document.querySelector('footer div[contenteditable="true"][data-lexical-editor="true"]') ||
                     document.querySelector('footer div[contenteditable="true"]');

    if (!composer) throw new Error('Campo de mensagem não encontrado');

    composer.focus();
    await sleep(50);

    // Limpar campo antes de digitar
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await sleep(30);
    } catch (_) {
      composer.textContent = '';
    }

    // Usar digitação humana se disponível
    if (window.HumanTyping?.type) {
      try {
        log('Usando HumanTyping para digitação...');
        await window.HumanTyping.type(composer, text, {
          minDelay: 18,
          maxDelay: 45,
          chunkSize: 2
        });
        composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return;
      } catch (e) {
        log('HumanTyping falhou, usando fallback:', e.message);
      }
    }

    // Fallback: inserção direta
    try {
      document.execCommand('insertText', false, text);
    } catch (_) {
      composer.textContent = text;
    }

    composer.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  let checkInterval = null;

  function init() {
    log('Inicializando AI Suggestion Button...');

    // Verificar periodicamente se precisa reinjetar
    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(() => {
      const btn = document.getElementById(CONFIG.BUTTON_ID);
      const footer = document.querySelector('#main footer');

      if (footer && !btn) {
        inject();
      }
    }, CONFIG.CHECK_INTERVAL);

    // Primeira tentativa
    setTimeout(() => {
      if (!state.injected) {
        inject();
      }
    }, 2000);
  }

  // Cleanup ao descarregar
  window.addEventListener('beforeunload', () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });

  // Expor API
  window.AISuggestionFixed = {
    init,
    inject,
    generateSuggestion
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  log('Módulo AI Suggestion Button carregado');
})();
