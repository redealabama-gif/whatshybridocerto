/**
 * 🎭 ClientBehaviorAdapter
 * WhatsHybrid Pro v10.1.0 — "True 10/10"
 *
 * Implementa as 5 camadas de micro-adaptação comportamental:
 *
 *  1. Stage-Aware Shaping    — instrução de comportamento por estágio do cliente
 *  2. Style Anti-Repetition  — variação de forma para evitar padrão robótico
 *  3. Response Energy Level  — intensidade HIGH / MEDIUM / LOW por contexto
 *  4. Closing Moment Detector— detecta "momento ideal de fechar" e age sobre isso
 *  5. Client Style Adapter   — detecta perfil de comunicação e adapta o tom
 *
 * Uso: instanciado no AIOrchestrator, chamado antes do promptBuilder.build()
 *
 * @module ai/intelligence/ClientBehaviorAdapter
 */

const logger = require('../../config/logger');

// ─── 1. STAGE-AWARE SHAPING ──────────────────────────────────────────────────
const STAGE_INSTRUCTIONS = {
  cold: {
    label: 'Novo visitante (frio)',
    instruction: `O cliente ainda não conhece bem os produtos/serviços.
- Seja mais explicativo e didático
- Apresente contexto e benefícios antes de qualquer proposta
- Evite jargões ou assumir conhecimento prévio
- Crie curiosidade genuína para avançar o diálogo
- Tom: acolhedor, educativo, sem pressão`,
  },
  interested: {
    label: 'Demonstrou interesse',
    instruction: `O cliente já demonstrou interesse e está avaliando.
- Foque em benefícios concretos e diferenciadores
- Antecipe objeções comuns e responda antes que pergunte
- Mostre casos de uso relevantes quando possível
- Use perguntas de qualificação para entender melhor a necessidade
- Tom: consultivo, engajante, orientado a valor`,
  },
  warm: {
    label: 'Lead quente (próximo de decidir)',
    instruction: `O cliente está próximo de uma decisão. Cada mensagem conta.
- Evite explicações longas — ele já sabe o suficiente
- Seja direto e conduza para a próxima ação concreta
- Reduza o atrito: facilite o próximo passo ao máximo
- Reforce o benefício mais relevante para ele, não todos
- Tom: confiante, direto, orientado a fechamento`,
  },
  customer: {
    label: 'Cliente ativo',
    instruction: `Este é um cliente existente. Trate com familiaridade e valorize o relacionamento.
- Evite repetir informações básicas que ele já conhece
- Foque em resolver a necessidade atual com eficiência
- Reforce o valor da parceria continuada quando natural
- Abra portas para upsell/cross-sell quando genuinamente relevante
- Tom: parceiro, objetivo, fidelizador`,
  },
  inactive: {
    label: 'Cliente inativo (reativação)',
    instruction: `O cliente havia demonstrado interesse mas ficou ausente. Reative com cuidado.
- Reconheça a ausência de forma natural, sem cobrar
- Retome contexto anterior brevemente se disponível
- Ofereça valor imediato: novidade, atualização ou condição especial
- Não force — abra uma porta, não empurre
- Tom: caloroso, sem pressão, genuíno`,
  },
};

// ─── 3. RESPONSE ENERGY LEVEL ────────────────────────────────────────────────
// HIGH: lead quente, fechamento iminente, recuperação de engajamento
// MEDIUM: interesse demonstrado, dúvida com intenção implícita
// LOW: suporte técnico, reclamação, dúvida factual simples

const ENERGY_LEVELS = {
  HIGH: {
    label: 'Alta energia',
    instruction: `Responda com ALTA ENERGIA:
- Tom proativo e entusiasmado (sem exagero)
- Use linguagem de ação e movimento
- Curta a pontual — vá direto ao próximo passo
- Termine com pergunta ou CTA que avança a conversa`,
  },
  MEDIUM: {
    label: 'Energia moderada',
    instruction: `Responda com ENERGIA MODERADA:
- Tom equilibrado entre informativo e engajante
- Complete a resposta com uma abertura natural para continuar
- Não arraste, mas não corte a conversa`,
  },
  LOW: {
    label: 'Energia baixa (foco em resolver)',
    instruction: `Responda com FOCO TOTAL EM RESOLVER:
- Tom sereno, claro e profissional
- Priorize precisão acima de qualquer outra coisa
- Sem motivação forçada — apenas solução eficiente
- Confirme entendimento do problema antes de responder quando necessário`,
  },
};

// ─── 5. CLIENT STYLE DETECTION ───────────────────────────────────────────────
// Sinais para detecção de perfil de comunicação

const DIRECT_SIGNALS = [
  /\bvai\s+direto\b/i,
  /\bme\s+fala\s+logo\b/i,
  /\bsim\s+ou\s+n[aã]o\b/i,           // aceita "nao" sem acento
  /\bresponde\s+r[aá]pido\b/i,
  /\bprecisa[r]?\s+urgente\b/i,
  /^(ok|certo|entendi|blz|beleza)[.!]?\s*$/i,
];

const DETAILED_SIGNALS = [
  /\bpreciso\s+(entender|saber)\s+(melhor|mais|tudo|exatamente)\b/i,
  /\bme\s+explica\s+(melhor|mais|direitinho|detalhadamente)\b/i,
  /\bcomo\s+funciona\s+(exatamente|especificamente|na\s+prática)\b/i,
  /\bquero\s+saber\s+(todos\s+os\s+detalhes|mais\s+sobre|tudo)\b/i,
  /\btem\s+algum\s+(tutorial|passo\s+a\s+passo|exemplo|manual)\b/i,
];

const INFORMAL_SIGNALS = [
  /\bvlw\b|\bvaleu\b|\bfala\b|\bblz\b|\bbeleza\b/i,
  /\bcaramba\b|\bpô\b|\bxi\b|\baí\b|\bein\b/i,
  /haha|kkk|rsrs|😂|😅|😊|😍|🙏/,
  /[!?]{2,}/,
  /\btá\b|\bto\b|\bvc\b|\bvcs\b|\btbm\b|\bmsm\b/i,
];

const CLIENT_STYLE_INSTRUCTIONS = {
  direct: {
    label: 'Perfil direto',
    instruction: `O cliente prefere comunicação direta e objetiva.
- Respostas CURTAS e sem rodeios
- Vá ao ponto imediatamente, sem introduções
- Bullet points ou 1-2 frases quando possível
- Zero lero-lero`,
  },
  detailed: {
    label: 'Perfil detalhista',
    instruction: `O cliente aprecia profundidade e completude.
- Seja mais abrangente e explique o raciocínio
- Inclua exemplos práticos quando relevante
- Antecipe dúvidas de follow-up e responda preventivamente
- Estruture visualmente quando a complexidade pedir`,
  },
  informal: {
    label: 'Perfil informal',
    instruction: `O cliente usa tom descontraído e informal.
- Adapte o tom: mais leve, próximo, sem formalidades excessivas
- Linguagem natural, pode usar contrações e expressões coloquiais
- Emojis esparsos são bem-vindos se o cliente os usar
- Mantenha profissionalismo no conteúdo, mas libere o tom`,
  },
  neutral: {
    label: 'Perfil neutro',
    instruction: `Tom profissional padrão — adapte à conversa conforme ela se desenvolve.`,
  },
};

// ─── 4. CLOSING MOMENT SIGNALS ───────────────────────────────────────────────
const CLOSING_SIGNALS = [
  /\bquanto\s+(custa|é|fica|vale)\b/i,
  /\btem\s+(parcelamento|parcela|desconto|promoção)\b/i,
  /\bposso\s+(pagar|fechar|assinar|confirmar)\b/i,
  /\bcomo\s+(faço|procedo|confirmo|finalizo)\b/i,
  /\bquero\s+(fechar|confirmar|assinar|contratar|começar)\b/i,
  /\bvou\s+(levar|pegar|fechar|contratar|comprar)\b/i,
  /\bme\s+(manda|envia|passa)\s+(o\s+link|o\s+pix|o\s+boleto|os\s+dados)\b/i,
  /\bquando\s+(posso|começa|entrega|libera)\b/i,
  /\bpreciso\s+(disso|desse|dessa)\s+agora\b/i,
];

// Sinais de "quase fechando" (cliente prestes a decidir mas ainda com dúvida)
const PRE_CLOSING_SIGNALS = [
  /\bse\s+(eu\s+)?(comprar|contratar|assinar|fechar)\b/i,
  /\bse\s+eu\s+quiser\b/i,
  /\bvaleria\s+a\s+pena\b/i,
  /\bcompensaria\b/i,
  /\bestou\s+(pensando|considerando|avaliando)\b/i,
];

class ClientBehaviorAdapter {
  constructor(config = {}) {
    this.config = {
      styleHistoryWeight: 0.7,   // peso do histórico vs mensagem atual
      minStyleSignals: 1,        // mínimo de sinais para classificar estilo
      ...config,
    };

    this.stats = {
      total: 0,
      closingMomentDetected: 0,
      byStyle: { direct: 0, detailed: 0, informal: 0, neutral: 0 },
      byEnergy: { HIGH: 0, MEDIUM: 0, LOW: 0 },
    };
  }

  /**
   * Ponto de entrada principal.
   * Retorna um `behaviorProfile` completo para injeção no DynamicPromptBuilder.
   *
   * @param {string}  message         – Mensagem atual do cliente
   * @param {Object}  intentResult    – { intent, confidence }
   * @param {Object}  commercialResult– { goal, confidence } do CommercialIntelligenceEngine
   * @param {Object}  conversationCtx – Contexto da ConversationMemory (inclui clientStage)
   * @returns {Object} behaviorProfile
   */
  analyze(message, intentResult = {}, commercialResult = {}, conversationCtx = {}) {
    this.stats.total++;

    const clientStage = conversationCtx.clientStage || 'cold';
    const goal = commercialResult.goal || 'responder_duvida';
    const recentMessages = conversationCtx.recentMessages || [];

    // ── 1. Stage instruction ────────────────────────────────────────────────
    const stageProfile = STAGE_INSTRUCTIONS[clientStage] || STAGE_INSTRUCTIONS.cold;

    // ── 5. Client style detection ────────────────────────────────────────────
    const styleResult = this._detectClientStyle(message, recentMessages);
    this.stats.byStyle[styleResult.style]++;

    // ── 3. Response energy level ─────────────────────────────────────────────
    const energyResult = this._computeEnergyLevel(goal, clientStage, intentResult, styleResult.style);
    this.stats.byEnergy[energyResult.level]++;

    // ── 4. Closing moment detection ──────────────────────────────────────────
    // Normalize: strip leading "se eu X, " conditional preamble so it doesn't
    // fire closing signals inside hypothetical phrases like "se eu contratar, tem desconto?"
    const normalizedMsg = message.replace(/\bse\s+(eu\s+)?(comprar|contratar|assinar|fechar|tiver|pedir)[^,?!.]*[,]?\s*/gi, '');
    const closingResult = this._detectClosingMoment(normalizedMsg, goal, clientStage, recentMessages);
    if (closingResult.isClosingMoment) this.stats.closingMomentDetected++;

    // ── 2. Style variation hint (anti-repetição) ─────────────────────────────
    const variationHint = this._buildVariationHint(recentMessages);

    const profile = {
      stageInstruction: stageProfile.instruction,
      stageLabel: stageProfile.label,
      clientStyle: styleResult.style,
      styleInstruction: CLIENT_STYLE_INSTRUCTIONS[styleResult.style].instruction,
      styleLabel: CLIENT_STYLE_INSTRUCTIONS[styleResult.style].label,
      energyLevel: energyResult.level,
      energyInstruction: ENERGY_LEVELS[energyResult.level].instruction,
      energyLabel: ENERGY_LEVELS[energyResult.level].label,
      isClosingMoment: closingResult.isClosingMoment,
      isPreClosing: closingResult.isPreClosing,
      closingCTA: closingResult.cta,
      closingInstruction: closingResult.instruction,
      variationHint,
    };

    logger.debug(`[ClientBehaviorAdapter] stage=${clientStage} style=${styleResult.style} energy=${energyResult.level} closing=${closingResult.isClosingMoment}`);
    return profile;
  }

  // ── PRIVATE ────────────────────────────────────────────────────────────────

  /**
   * Detecta o perfil de comunicação do cliente.
   * Analisa a mensagem atual + últimas 5 mensagens do cliente.
   * @private
   */
  _detectClientStyle(message, recentMessages) {
    const clientMessages = recentMessages
      .filter(m => m.role === 'user')
      .slice(-5)
      .map(m => m.content || '')
      .concat([message])
      .join(' ');

    const scores = {
      direct:   DIRECT_SIGNALS.filter(p => p.test(clientMessages)).length,
      detailed: DETAILED_SIGNALS.filter(p => p.test(clientMessages)).length,
      informal: INFORMAL_SIGNALS.filter(p => p.test(clientMessages)).length,
    };

    const maxScore = Math.max(...Object.values(scores));
    if (maxScore < this.config.minStyleSignals) {
      return { style: 'neutral', scores };
    }

    const style = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
    return { style, scores };
  }

  /**
   * Calcula o nível de energia baseado em goal, estágio e intent.
   * @private
   */
  _computeEnergyLevel(goal, clientStage, intentResult, clientStyle) {
    // Direto sempre quer resposta compacta — não forçar alta energia
    if (clientStyle === 'direct') {
      return { level: 'LOW', reason: 'direct_client_style' };
    }

    // Suporte/reclamação → LOW independentemente
    if (['support', 'complaint'].includes(intentResult.intent)) {
      return { level: 'LOW', reason: 'support_intent' };
    }

    // Fechamento iminente → HIGH
    if (goal === 'fechar_venda' && ['warm', 'interested'].includes(clientStage)) {
      return { level: 'HIGH', reason: 'closing_goal_warm_stage' };
    }

    // Recuperação de engajamento → HIGH (precisamos reativar atenção)
    if (goal === 'recuperar_engajamento') {
      return { level: 'HIGH', reason: 'reengagement_goal' };
    }

    // Gerar interesse com cliente frio → MEDIUM
    if (goal === 'gerar_interesse') {
      return { level: 'MEDIUM', reason: 'interest_goal' };
    }

    // Cliente customer com dúvida → LOW (já é cliente, precisa de solução)
    if (clientStage === 'customer') {
      return { level: 'LOW', reason: 'existing_customer' };
    }

    return { level: 'MEDIUM', reason: 'default' };
  }

  /**
   * Detecta se este é o momento ideal de fechar e sugere CTA específico.
   * @private
   */
  _detectClosingMoment(message, goal, clientStage, recentMessages) {
    const isExplicitClosing = CLOSING_SIGNALS.some(p => p.test(message));
    const isPreClosing = PRE_CLOSING_SIGNALS.some(p => p.test(message));

    // Verificar momentum: se as últimas 3 mensagens tiveram goal=fechar_venda
    const recentGoals = recentMessages
      .slice(-3)
      .map(m => m.metadata?.responseGoal)
      .filter(Boolean);
    const hasMomentum = recentGoals.filter(g => g === 'fechar_venda').length >= 2;

    const isClosingMoment = isExplicitClosing || (isPreClosing && hasMomentum) ||
      (goal === 'fechar_venda' && clientStage === 'warm' && hasMomentum);

    let cta = null;
    let instruction = null;

    if (isClosingMoment) {
      cta = this._selectClosingCTA(message);
      instruction = `🎯 MOMENTO DE FECHAMENTO DETECTADO.
PARE de explicar features — o cliente já sabe o suficiente.
VAIA direto para a ação: facilite o próximo passo com uma pergunta ou proposta concreta.
CTA sugerido: "${cta}"
Não adicione informações extras — qualquer nova informação agora pode criar dúvida e atrasar a decisão.`;
    } else if (isPreClosing) {
      instruction = `O cliente está quase decidindo.
Responda a dúvida restante de forma CURTA e DIRETA.
Ao terminar, abra a porta para o fechamento naturalmente.`;
    }

    return { isClosingMoment, isPreClosing, cta, instruction };
  }

  /**
   * Seleciona o CTA de fechamento mais adequado para a mensagem.
   * @private
   */
  _selectClosingCTA(message) {
    if (/pix|pagamento|pagar/i.test(message)) return 'Posso te passar os dados para pagamento agora mesmo!';
    if (/plano|assinar|contratar/i.test(message)) return 'Posso confirmar o plano para você agora?';
    if (/agendar|reunião|conversar/i.test(message)) return 'Qual o melhor horário para você?';
    if (/entrega|prazo|quando/i.test(message)) return 'Confirmo o pedido agora e já aciono o processo!';
    return 'Posso confirmar tudo pra você agora — o que prefere?';
  }

  /**
   * Gera hint de variação de estilo para evitar respostas repetitivas.
   * Analisa os últimos 3 padrões de resposta.
   * @private
   */
  _buildVariationHint(recentMessages) {
    const lastAssistantMessages = recentMessages
      .filter(m => m.role === 'assistant')
      .slice(-3)
      .map(m => m.content || '');

    if (lastAssistantMessages.length < 2) {
      return 'Varie a estrutura e abertura das suas respostas para soar sempre natural e humano.';
    }

    const hints = [];

    // Detectar se todas as últimas respostas começam da mesma forma
    const openings = lastAssistantMessages.map(m => m.split(/[.!?]/)[0]?.toLowerCase() || '');
    const hasRepetitiveOpenings = openings.length >= 2 && openings[0].slice(0, 15) === openings[1].slice(0, 15);
    if (hasRepetitiveOpenings) {
      hints.push('Varie a ABERTURA — não comece igual à resposta anterior');
    }

    // Detectar tamanhos muito uniformes
    const lengths = lastAssistantMessages.map(m => m.length);
    const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const allSimilarLength = lengths.every(l => Math.abs(l - avgLen) < avgLen * 0.2);
    if (allSimilarLength && lastAssistantMessages.length >= 3) {
      hints.push('Varie o COMPRIMENTO — nem toda resposta precisa ter o mesmo tamanho');
    }

    // Detectar uso repetitivo de listas
    const listCount = lastAssistantMessages.filter(m => (m.match(/\n-|\n•|\n\*/g) || []).length > 2).length;
    if (listCount >= 2) {
      hints.push('Evite listas em excesso — use prosa quando for mais natural');
    }

    if (hints.length === 0) {
      hints.push('Continue variando o estilo naturalmente — está funcionando bem');
    }

    return hints.join('. ') + '.';
  }

  getStats() {
    return {
      ...this.stats,
      closingRate: this.stats.total > 0
        ? ((this.stats.closingMomentDetected / this.stats.total) * 100).toFixed(1) + '%'
        : 'n/a',
    };
  }
}

module.exports = ClientBehaviorAdapter;
