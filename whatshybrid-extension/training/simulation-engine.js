/**
 * 🧠 Simulation Engine - Motor de Simulação Neural
 * WhatsHybrid v7.7.0
 * 
 * Ambiente controlado para testar e treinar a IA real
 * com conversas artificiais supervisionadas.
 * 
 * Princípio: Uma conta, um cérebro, múltiplos robôs lógicos
 * 
 * @version 1.0.0
 */

class SimulationEngine {
  // v7.9.13: Backend Soberano - Configuração global
  static FORCE_BACKEND = true;

  // SECURITY FIX P0-032: Sanitize text to prevent prompt injection
  static sanitizeForPrompt(text, maxLen = 4000) {
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
        console.warn('[SimulationEngine Security] Prompt injection attempt detected and neutralized');
        clean = clean.replace(pattern, '[FILTERED]');
      }
    });

    if (clean.length > maxLen) {
      clean = clean.substring(0, maxLen) + '...';
    }

    return clean.trim();
  }

  constructor() {
    // Estado da simulação
    this.state = {
      isRunning: false,
      isPaused: false,
      sessionId: null,
      theme: null,
      executorProfile: 'vendedor_senior',
      simulatorProfile: 'cliente_simulado',
      conversation: [],
      pendingApprovals: [],
      approvedResponses: [],
      rejectedResponses: [],
      metrics: {
        totalMessages: 0,
        executorResponses: 0,
        approved: 0,
        rejected: 0,
        avgLatency: 0,
        startTime: null,
        endTime: null
      }
    };

    // Configurações
    this.config = {
      maxTurns: 20,
      minLatency: 500,
      maxLatency: 2000,
      autoAdvance: false,
      autoAdvanceDelay: 3000
    };

    // Perfis do Executor (Vendedor/Atendente)
    this.executorProfiles = {
      vendedor_senior: {
        id: 'vendedor_senior',
        name: '👔 Vendedor Sênior',
        description: 'Experiente em vendas e negociação',
        systemPrompt: 'Você é um vendedor experiente. Seja persuasivo mas respeitoso. Foque em benefícios e valor. Use técnicas de venda consultiva.'
      },
      suporte_tecnico: {
        id: 'suporte_tecnico',
        name: '🛠️ Suporte Técnico',
        description: 'Especialista em resolver problemas',
        systemPrompt: 'Você é um especialista em suporte técnico. Seja paciente, claro e resolva problemas de forma eficiente.'
      },
      atendente_geral: {
        id: 'atendente_geral',
        name: '🎯 Atendente Geral',
        description: 'Atendimento versátil',
        systemPrompt: 'Você é um atendente versátil. Responda de forma clara, educada e profissional.'
      }
    };

    // Perfis do Simulador (Cliente)
    this.simulatorProfiles = {
      cliente_simulado: {
        id: 'cliente_simulado',
        name: '👤 Cliente Simulado',
        description: 'Cliente padrão com perguntas variadas'
      },
      cliente_dificil: {
        id: 'cliente_dificil',
        name: '😤 Cliente Difícil',
        description: 'Cliente exigente e com objeções'
      },
      cliente_indeciso: {
        id: 'cliente_indeciso',
        name: '🤔 Cliente Indeciso',
        description: 'Cliente que precisa de mais informações'
      },
      cliente_apressado: {
        id: 'cliente_apressado',
        name: '⏰ Cliente Apressado',
        description: 'Cliente com urgência e pouco tempo'
      }
    };

    // Temas de simulação
    this.themes = {
      venda_abordagem: {
        id: 'venda_abordagem',
        name: '🎯 Melhores Abordagens de Venda',
        description: 'Testar técnicas de abertura e engajamento',
        simulatorBehavior: 'Faça perguntas sobre produtos, peça detalhes, demonstre interesse moderado.',
        initialMessages: [
          'Olá, gostaria de saber o preço do plano Enterprise.',
          'Vi vocês no Instagram, o que vocês fazem exatamente?',
          'Estou procurando uma solução para minha empresa.'
        ]
      },
      quebra_objecoes: {
        id: 'quebra_objecoes',
        name: '🛡️ Quebra de Objeções',
        description: 'Treinar respostas para objeções comuns',
        simulatorBehavior: 'Apresente objeções: preço alto, não tenho tempo, preciso pensar, já uso outro.',
        initialMessages: [
          'Achei muito caro, vocês tem desconto?',
          'Não sei se vale a pena, já tentei outras soluções...',
          'Preciso falar com meu sócio antes de decidir.'
        ]
      },
      negociacao_preco: {
        id: 'negociacao_preco',
        name: '💰 Negociação de Preço',
        description: 'Praticar negociação e fechamento',
        simulatorBehavior: 'Peça descontos, compare com concorrentes, questione valor.',
        initialMessages: [
          'Esse preço está fora do meu orçamento.',
          'Encontrei mais barato em outro lugar.',
          'Se fizer um desconto, fecho agora.'
        ]
      },
      pos_venda: {
        id: 'pos_venda',
        name: '🎁 Pós-Venda e Suporte',
        description: 'Testar atendimento pós-compra',
        simulatorBehavior: 'Faça perguntas sobre uso, relate problemas, peça ajuda.',
        initialMessages: [
          'Comprei ontem mas não consegui acessar.',
          'Como faço para usar essa função?',
          'Meu pedido ainda não chegou.'
        ]
      },
      cliente_dificil: {
        id: 'cliente_dificil',
        name: '😠 Cliente Difícil',
        description: 'Treinar paciência e resolução de conflitos',
        simulatorBehavior: 'Seja impaciente, reclame, exija respostas rápidas.',
        initialMessages: [
          'Isso é um absurdo! Ninguém me responde!',
          'Quero falar com o gerente agora!',
          'Vocês são péssimos, nunca mais compro aqui.'
        ]
      },
      consistencia_memoria: {
        id: 'consistencia_memoria',
        name: '🧠 Consistência e Memória',
        description: 'Testar se a IA mantém contexto ao longo da conversa',
        simulatorBehavior: 'Faça referências a mensagens anteriores, teste memória.',
        initialMessages: [
          'Olá, sou o João da empresa ABC.',
          'Sobre aquele orçamento que pedi...',
          'Lembra que te falei sobre o projeto?'
        ]
      }
    };

    // Event handlers
    this.eventHandlers = {};
  }

  // ============================================
  // CONTROLE DA SIMULAÇÃO
  // ============================================

  /**
   * Inicia uma nova simulação
   * @param {Object} options - Configurações da simulação
   */
  async start(options = {}) {
    if (this.state.isRunning) {
      throw new Error('Simulação já está em execução');
    }

    const {
      theme = 'venda_abordagem',
      executorProfile = 'vendedor_senior',
      simulatorProfile = 'cliente_simulado'
    } = options;

    // Validar tema
    if (!this.themes[theme]) {
      throw new Error(`Tema inválido: ${theme}`);
    }

    // Inicializar estado
    this.state = {
      isRunning: true,
      isPaused: false,
      sessionId: `sim_${crypto.randomUUID()}`, // SECURITY FIX: ID criptograficamente seguro
      theme: theme,
      executorProfile: executorProfile,
      simulatorProfile: simulatorProfile,
      conversation: [],
      pendingApprovals: [],
      approvedResponses: [],
      rejectedResponses: [],
      metrics: {
        totalMessages: 0,
        executorResponses: 0,
        approved: 0,
        rejected: 0,
        avgLatency: 0,
        startTime: Date.now(),
        endTime: null
      }
    };

    console.log('[SimulationEngine] ▶️ Simulação iniciada:', {
      sessionId: this.state.sessionId,
      theme: theme,
      executor: executorProfile,
      simulator: simulatorProfile
    });

    // Emitir evento
    this.emit('simulation:started', {
      sessionId: this.state.sessionId,
      theme: this.themes[theme],
      executorProfile: this.executorProfiles[executorProfile],
      simulatorProfile: this.simulatorProfiles[simulatorProfile]
    });

    // Iniciar primeira mensagem do simulador
    await this.generateSimulatorMessage();

    return this.state.sessionId;
  }

  /**
   * Pausa a simulação
   */
  pause() {
    if (!this.state.isRunning || this.state.isPaused) {
      return false;
    }

    this.state.isPaused = true;
    console.log('[SimulationEngine] ⏸️ Simulação pausada');

    this.emit('simulation:paused', {
      sessionId: this.state.sessionId,
      conversation: this.state.conversation
    });

    return true;
  }

  /**
   * Continua a simulação pausada
   */
  async resume() {
    if (!this.state.isRunning || !this.state.isPaused) {
      return false;
    }

    this.state.isPaused = false;
    console.log('[SimulationEngine] ▶️ Simulação retomada');

    this.emit('simulation:resumed', {
      sessionId: this.state.sessionId
    });

    // Se há mensagem pendente de resposta, continuar
    const lastMsg = this.state.conversation[this.state.conversation.length - 1];
    if (lastMsg && lastMsg.role === 'simulator') {
      await this.generateExecutorResponse(lastMsg.content);
    }

    return true;
  }

  /**
   * Para a simulação completamente
   */
  stop() {
    if (!this.state.isRunning) {
      return false;
    }

    this.state.isRunning = false;
    this.state.isPaused = false;
    this.state.metrics.endTime = Date.now();

    console.log('[SimulationEngine] ⏹️ Simulação encerrada:', this.state.metrics);

    this.emit('simulation:stopped', {
      sessionId: this.state.sessionId,
      conversation: this.state.conversation,
      metrics: this.state.metrics,
      pendingApprovals: this.state.pendingApprovals,
      approvedResponses: this.state.approvedResponses
    });

    return true;
  }

  // ============================================
  // GERAÇÃO DE MENSAGENS
  // ============================================

  /**
   * Gera mensagem do Robô Simulador (Cliente)
   */
  async generateSimulatorMessage() {
    if (!this.state.isRunning || this.state.isPaused) return null;

    const theme = this.themes[this.state.theme];
    const simulatorProfile = this.simulatorProfiles[this.state.simulatorProfile];

    let content;

    // Se é a primeira mensagem, usar uma das iniciais do tema
    if (this.state.conversation.length === 0) {
      const initialMessages = theme.initialMessages || ['Olá, preciso de ajuda.'];
      content = initialMessages[Math.floor(Math.random() * initialMessages.length)];
    } else {
      // Gerar mensagem contextual baseada na conversa
      content = await this.generateContextualSimulatorMessage();
    }

    const message = {
      id: `msg_${Date.now()}`,
      role: 'simulator',
      content: content,
      timestamp: Date.now(),
      profile: simulatorProfile
    };

    this.state.conversation.push(message);
    this.state.metrics.totalMessages++;

    this.emit('message:simulator', message);

    // Simular latência e gerar resposta do executor
    const latency = this.config.minLatency + Math.random() * (this.config.maxLatency - this.config.minLatency);
    
    setTimeout(async () => {
      if (!this.state.isPaused) {
        await this.generateExecutorResponse(content);
      }
    }, latency);

    return message;
  }

  /**
   * Gera mensagem contextual do simulador baseada na conversa
   */
  async generateContextualSimulatorMessage() {
    const theme = this.themes[this.state.theme];
    const profile = this.simulatorProfiles[this.state.simulatorProfile];

    // Construir contexto da conversa
    const conversationHistory = this.state.conversation
      .slice(-6)
      .map(m => `${m.role === 'simulator' ? 'Cliente' : 'Atendente'}: ${m.content}`)
      .join('\n');

    // Usar a IA para gerar uma resposta contextual do cliente
    if (window.AIService) {
      try {
        // SECURITY FIX (NOTAUDIT-001): Sanitizar inputs para prevenir prompt injection
        const safeName = this._sanitizePrompt(theme.name);
        const safeBehavior = this._sanitizePrompt(theme.simulatorBehavior);
        const safeDescription = this._sanitizePrompt(profile.description);

        const systemPrompt = `Você está simulando um cliente em uma conversa de ${safeName}.
${safeBehavior}

Perfil do cliente: ${safeDescription}

REGRAS:
- Responda como um cliente real faria
- Seja natural e humano
- Continue o contexto da conversa
- Faça perguntas, apresente dúvidas ou objeções
- Mantenha o tom do tema da simulação
- Responda apenas com a mensagem do cliente (sem explicações)`;

        // SECURITY FIX P0-032: Sanitize conversation history to prevent prompt injection
        const safeHistory = SimulationEngine.sanitizeForPrompt(conversationHistory, 2000);

        const result = await window.AIService.complete([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Conversa até agora:\n${safeHistory}\n\nGere a próxima mensagem do cliente:` }
        ], { temperature: 0.8, maxTokens: 150 });

        return result.content?.trim() || 'Pode me explicar melhor?';
      } catch (e) {
        console.warn('[SimulationEngine] Erro ao gerar mensagem contextual:', e);
      }
    }

    // Fallback: mensagem genérica
    const fallbacks = [
      'Entendi, mas pode me explicar melhor?',
      'Quanto custa isso?',
      'Tem outras opções?',
      'Preciso pensar mais...',
      'Isso resolve meu problema?'
    ];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  /**
   * Gera resposta do Robô Executor (IA real)
   * v7.9.13: Backend Soberano - Usa CopilotEngine obrigatoriamente
   */
  async generateExecutorResponse(clientMessage) {
    if (!this.state.isRunning || this.state.isPaused) return null;

    const startTime = Date.now();
    const theme = this.themes[this.state.theme];
    const executorProfile = this.executorProfiles[this.state.executorProfile];

    let content;
    let confidence = 0;
    let latency = 0;

    console.log('[SimulationEngine] 🚀 [MOTOR: BACKEND] Gerando resposta do executor...');

    try {
      // IMPORTANTE: Usar o CopilotEngine real (cérebro único)
      if (window.CopilotEngine) {
        console.log('[SimulationEngine] 🤖 [MOTOR: BACKEND/CopilotEngine] Iniciando...');
        
        // Criar análise fake para o CopilotEngine
        const analysis = {
          originalMessage: clientMessage,
          intent: { id: 'general', confidence: 0.8 },
          sentiment: { score: 0, label: 'neutral' },
          entities: [],
          category: theme.id
        };

        // Adicionar contexto do tema ao prompt
        const themeContext = `
CONTEXTO DA SIMULAÇÃO:
- Tema: ${theme.name}
- Objetivo: ${theme.description}
- Perfil: ${executorProfile.name}
${executorProfile.systemPrompt}`;

        // Usar o método real de geração
        const response = await window.CopilotEngine.generateResponse(
          `simulation_${this.state.sessionId}`,
          analysis,
          { 
            skipCache: true, // Não usar cache em simulações
            additionalContext: themeContext
          }
        );

        content = response.content;
        confidence = response.confidence;
        latency = Date.now() - startTime;
        
        console.log(`[SimulationEngine] ✅ [MOTOR: BACKEND] Resposta gerada em ${latency}ms`);

      } else if (window.AIService && !SimulationEngine.FORCE_BACKEND) {
        // Fallback: usar AIService diretamente (APENAS se FORCE_BACKEND = false)
        console.warn('[SimulationEngine] ⚠️ [MOTOR: LOCAL] Usando AIService como fallback');
        
        const conversationHistory = this.state.conversation
          .slice(-8)
          .map(m => ({
            role: m.role === 'simulator' ? 'user' : 'assistant',
            content: m.content
          }));

        const systemPrompt = `${executorProfile.systemPrompt}

CONTEXTO DO TEMA: ${theme.name}
${theme.description}

Responda de forma natural e profissional.`;

        // SECURITY FIX P0-032: Sanitize client message to prevent prompt injection
        const safeClientMessage = SimulationEngine.sanitizeForPrompt(clientMessage, 1000);

        const result = await window.AIService.complete([
          { role: 'system', content: systemPrompt },
          ...conversationHistory,
          { role: 'user', content: safeClientMessage }
        ], { temperature: 0.7, maxTokens: 300 });

        content = result.content;
        confidence = 0.8;
        latency = Date.now() - startTime;

      } else {
        // v7.9.13: Se FORCE_BACKEND, propagar erro
        console.error('[SimulationEngine] ❌ [MOTOR: BLOQUEADO] CopilotEngine não disponível');
        throw new Error('❌ Backend obrigatório indisponível. CopilotEngine não carregado.');
      }

    } catch (error) {
      console.error('[SimulationEngine] ❌ [MOTOR: BACKEND] Erro ao gerar resposta:', error.message);
      
      // v7.9.13: Se FORCE_BACKEND, mostrar erro real ao invés de mensagem genérica
      if (SimulationEngine.FORCE_BACKEND) {
        content = `⚠️ Erro de IA: ${error.message}. Verifique a conexão com o backend.`;
      } else {
        content = 'Desculpe, não consegui processar sua mensagem. Poderia reformular?';
      }
      confidence = 0;
      latency = Date.now() - startTime;
    }

    const message = {
      id: `msg_${Date.now()}`,
      role: 'executor',
      content: content,
      timestamp: Date.now(),
      profile: executorProfile,
      confidence: confidence,
      latency: latency,
      approved: null // Pendente de aprovação
    };

    this.state.conversation.push(message);
    this.state.metrics.totalMessages++;
    this.state.metrics.executorResponses++;

    // Atualizar latência média
    const prevAvg = this.state.metrics.avgLatency;
    const count = this.state.metrics.executorResponses;
    this.state.metrics.avgLatency = (prevAvg * (count - 1) + latency) / count;

    // Adicionar à lista de pendentes de aprovação
    this.state.pendingApprovals.push(message);

    this.emit('message:executor', message);

    return message;
  }

  // ============================================
  // APROVAÇÃO/REJEIÇÃO (CURADORIA HUMANA)
  // ============================================

  /**
   * Aprova uma resposta do executor
   * @param {string} messageId - ID da mensagem
   */
  approve(messageId) {
    const message = this.state.conversation.find(m => m.id === messageId);
    if (!message || message.role !== 'executor') {
      return false;
    }

    message.approved = true;
    this.state.approvedResponses.push(message);
    this.state.pendingApprovals = this.state.pendingApprovals.filter(m => m.id !== messageId);
    this.state.metrics.approved++;

    console.log('[SimulationEngine] ✅ Resposta aprovada:', messageId);

    this.emit('response:approved', {
      message,
      theme: this.state.theme,
      context: this.getMessageContext(messageId)
    });

    return true;
  }

  /**
   * Rejeita uma resposta do executor
   * @param {string} messageId - ID da mensagem
   * @param {string} reason - Motivo da rejeição
   */
  reject(messageId, reason = '') {
    const message = this.state.conversation.find(m => m.id === messageId);
    if (!message || message.role !== 'executor') {
      return false;
    }

    message.approved = false;
    message.rejectionReason = reason;
    this.state.rejectedResponses.push(message);
    this.state.pendingApprovals = this.state.pendingApprovals.filter(m => m.id !== messageId);
    this.state.metrics.rejected++;

    console.log('[SimulationEngine] ❌ Resposta rejeitada:', messageId, reason);

    this.emit('response:rejected', {
      message,
      reason,
      theme: this.state.theme
    });

    return true;
  }

  /**
   * Obtém contexto de uma mensagem (mensagem anterior)
   */
  getMessageContext(messageId) {
    const index = this.state.conversation.findIndex(m => m.id === messageId);
    if (index <= 0) return null;

    return this.state.conversation[index - 1];
  }

  // ============================================
  // SALVAMENTO PARA APRENDIZADO
  // ============================================

  /**
   * Salva as respostas aprovadas para aprendizado
   * @returns {Object} Resumo do salvamento
   */
  async saveForLearning() {
    if (this.state.approvedResponses.length === 0) {
      return { saved: 0, message: 'Nenhuma resposta aprovada para salvar' };
    }

    const theme = this.themes[this.state.theme];
    let saved = 0;

    for (const response of this.state.approvedResponses) {
      const context = this.getMessageContext(response.id);
      if (!context) continue;

      try {
        // Salvar como exemplo de few-shot learning
        if (window.fewShotLearning) {
          await window.fewShotLearning.addExample({
            input: context.content, // Pergunta do cliente
            output: response.content, // Resposta aprovada (pode estar editada)
            category: theme.id,
            intent: theme.id,
            quality: response.edited ? 10 : 9, // Editado = qualidade ainda maior
            edited: response.edited || false,
            editedAt: response.editedAt || null,
            tags: [theme.id, 'simulation', 'approved', ...(response.edited ? ['edited'] : [])],
            context: {
              theme: theme.name,
              profile: response.profile?.id,
              sessionId: this.state.sessionId
            },
            source: response.edited ? 'neural_simulation_edited' : 'neural_simulation'
          });

          saved++;
          console.log('[SimulationEngine] 💾 Exemplo salvo para aprendizado');
        }

        // Emitir evento para outros sistemas
        this.emit('learning:saved', {
          input: context.content,
          output: response.content,
          theme: theme.id,
          sessionId: this.state.sessionId
        });

      } catch (error) {
        console.error('[SimulationEngine] Erro ao salvar exemplo:', error);
      }
    }

    // Limpar após salvar
    this.state.approvedResponses = [];

    return {
      saved,
      message: `${saved} exemplo(s) salvo(s) para aprendizado`
    };
  }

  // ============================================
  // AVANÇAR CONVERSA (PRÓXIMO TURNO)
  // ============================================

  /**
   * Avança para o próximo turno da conversa
   */
  async nextTurn() {
    if (!this.state.isRunning || this.state.isPaused) {
      return false;
    }

    // Verificar limite de turnos
    if (this.state.conversation.length >= this.config.maxTurns * 2) {
      console.log('[SimulationEngine] Limite de turnos atingido');
      this.stop();
      return false;
    }

    // Gerar próxima mensagem do simulador
    await this.generateSimulatorMessage();

    return true;
  }

  // ============================================
  // EVENTOS
  // ============================================

  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  off(event, handler) {
    if (!this.eventHandlers[event]) return;
    this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
  }

  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => {
        try {
          handler(data);
        } catch (e) {
          console.error(`[SimulationEngine] Error in event handler for ${event}:`, e);
        }
      });
    }

    // Também emitir no EventBus global
    if (window.EventBus) {
      window.EventBus.emit(`simulation:${event}`, data);
    }
  }

  // ============================================
  // GETTERS
  // ============================================

  getState() {
    return { ...this.state };
  }

  getConversation() {
    return [...this.state.conversation];
  }

  getMetrics() {
    return { ...this.state.metrics };
  }

  getThemes() {
    return Object.values(this.themes);
  }

  getExecutorProfiles() {
    return Object.values(this.executorProfiles);
  }

  getSimulatorProfiles() {
    return Object.values(this.simulatorProfiles);
  }

  isRunning() {
    return this.state.isRunning;
  }

  isPaused() {
    return this.state.isPaused;
  }

  /**
   * SECURITY FIX (NOTAUDIT-001): Sanitizar texto para prevenir prompt injection
   * Remove caracteres especiais e limita tamanho
   */
  _sanitizePrompt(text) {
    if (!text || typeof text !== 'string') return '';

    // Remover caracteres potencialmente perigosos
    const sanitized = text
      .replace(/[<>{}[\]\\]/g, '') // Remove brackets e chars especiais
      .replace(/\n{3,}/g, '\n\n')  // Limitar quebras de linha consecutivas
      .trim();

    // Limitar tamanho para evitar prompt muito longo
    return sanitized.substring(0, 500);
  }
}

// Exportar como singleton
window.SimulationEngine = SimulationEngine;

if (!window.simulationEngine) {
  window.simulationEngine = new SimulationEngine();
  console.log('[SimulationEngine] ✅ Motor de simulação neural inicializado');
}
