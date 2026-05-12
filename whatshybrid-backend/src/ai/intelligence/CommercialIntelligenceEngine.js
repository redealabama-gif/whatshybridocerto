/**
 * 🧠 CommercialIntelligenceEngine
 * WhatsHybrid Pro v10.0.0
 *
 * Classifica o objetivo comercial da resposta ANTES do LLM,
 * permitindo que o prompt seja ajustado dinamicamente para
 * maximizar conversão, engajamento e satisfação.
 *
 * responseGoal values:
 *   - responder_duvida      → cliente tem pergunta objetiva
 *   - gerar_interesse       → cliente está explorando/frio
 *   - fechar_venda          → cliente demonstrou intenção de compra
 *   - recuperar_engajamento → cliente sumiu ou resposta lenta
 *
 * @module ai/intelligence/CommercialIntelligenceEngine
 */

const logger = require('../../config/logger');

// ── Sinais léxicos por goal ──────────────────────────────────────────────────
const GOAL_SIGNALS = {
  fechar_venda: [
    /\bquero\s+(comprar|adquirir|contratar|fechar|pedir)\b/i,
    /\bvou\s+(levar|pegar|comprar|contratar)\b/i,
    /\bcomo\s+(pago|faço\s+o\s+pagamento|finalizo|assino)\b/i,
    /\bpix\b|\bcartão\b|\bboleto\b|\bparcela[do]?\b/i,
    /\bpreciso\s+(disso|desse|dessa|urgente)\b/i,
    /\bfecha[r]?\s+negócio\b/i,
    /\bvamos\s+fechar\b/i,
    /\bquero\s+começar\b/i,
    /\bquando\s+(começa|entrega|libera|fica\s+pronto)\b/i,
    /\bprazo\s+de\s+entrega\b/i,
  ],
  gerar_interesse: [
    /\bme\s+conta\s+mais\b/i,
    /\bcomo\s+funciona\b/i,
    /\btem\s+(algum|alguma)\b/i,
    /\bquais\s+(são\s+)?os\s+(benefícios|vantagens|diferenciais|planos|opções)\b/i,
    /\bpara\s+que\s+serve\b/i,
    /\bvi\s+(um\s+anúncio|no\s+instagram|no\s+face|uma\s+publicação)\b/i,
    /\bme\s+fala\s+sobre\b/i,
    /\btenho\s+interesse\b/i,
    /\bpode\s+me\s+explicar\b/i,
    /\bquero\s+saber\s+mais\b/i,
  ],
  recuperar_engajamento: [
    /\b(voltei|oi\s+novamente|vim\s+ver|tô\s+de\s+volta)\b/i,
    /\b(lembra\s+que|naquele\s+dia|semana\s+passada|mês\s+passado)\b/i,
    /\bainda\s+(tem|está|vale)\b/i,
    /\bcontinua\s+(valendo|disponível|de\s+pé)\b/i,
  ],
};

// ── Intents do HybridIntentClassifier → goal mapping ────────────────────────
const INTENT_TO_GOAL = {
  purchase:    'fechar_venda',
  pricing:     'fechar_venda',
  checkout:    'fechar_venda',
  payment:     'fechar_venda',
  sales:       'gerar_interesse',
  product_info:'gerar_interesse',
  browse:      'gerar_interesse',
  greeting:    'gerar_interesse',
  question:    'responder_duvida',
  support:     'responder_duvida',
  complaint:   'responder_duvida',
  faq:         'responder_duvida',
  return:      'responder_duvida',
};

// ── Estágio do cliente → goal de fallback ────────────────────────────────────
const STAGE_GOAL_FALLBACK = {
  cold:        'gerar_interesse',
  warm:        'fechar_venda',
  interested:  'fechar_venda',
  customer:    'responder_duvida',
  inactive:    'recuperar_engajamento',
};

class CommercialIntelligenceEngine {
  constructor(config = {}) {
    this.config = {
      minConfidenceForOverride: 0.75, // só sobrescreve o intent se confiança alta
      ...config,
    };
    this.stats = {
      total: 0,
      byGoal: {
        fechar_venda: 0,
        gerar_interesse: 0,
        responder_duvida: 0,
        recuperar_engajamento: 0,
      },
    };
  }

  /**
   * Classifica o objetivo comercial da resposta.
   *
   * @param {string}  message         – Mensagem do cliente
   * @param {Object}  intentResult    – Resultado do HybridIntentClassifier
   * @param {Object}  conversationCtx – Contexto da ConversationMemory
   * @returns {{ goal: string, confidence: number, reasoning: string }}
   */
  classify(message, intentResult = {}, conversationCtx = {}) {
    this.stats.total++;

    const signals = [];
    let goal = null;
    let confidence = 0;

    // ── 1. Sinais léxicos diretos (prioridade máxima) ──────────────────────
    for (const [candidateGoal, patterns] of Object.entries(GOAL_SIGNALS)) {
      for (const pattern of patterns) {
        if (pattern.test(message)) {
          signals.push(`lexical:${candidateGoal}`);
          if (!goal || candidateGoal === 'fechar_venda') {
            goal = candidateGoal;
            confidence = 0.92;
          }
        }
      }
    }

    // ── 2. Intent do classificador (alta confiança) ────────────────────────
    if (!goal && intentResult.intent && intentResult.confidence >= this.config.minConfidenceForOverride) {
      const mapped = INTENT_TO_GOAL[intentResult.intent];
      if (mapped) {
        goal = mapped;
        confidence = intentResult.confidence * 0.9;
        signals.push(`intent_map:${intentResult.intent}`);
      }
    }

    // ── 3. Estágio do cliente como fallback ────────────────────────────────
    if (!goal) {
      const clientStage = conversationCtx?.client?.stage || conversationCtx?.clientStage;
      if (clientStage && STAGE_GOAL_FALLBACK[clientStage]) {
        goal = STAGE_GOAL_FALLBACK[clientStage];
        confidence = 0.65;
        signals.push(`client_stage:${clientStage}`);
      }
    }

    // ── 4. Fallback universal ──────────────────────────────────────────────
    if (!goal) {
      goal = 'responder_duvida';
      confidence = 0.5;
      signals.push('fallback:default');
    }

    this.stats.byGoal[goal]++;

    const result = { goal, confidence, reasoning: signals.join(' | ') };
    logger.debug(`[CommercialIntelligenceEngine] ${JSON.stringify(result)}`);
    return result;
  }

  /**
   * Retorna instruções de comportamento para injeção no prompt
   * com base no goal classificado.
   *
   * @param {string} goal
   * @param {string} [language='pt-BR']
   * @returns {string}
   */
  getBehavioralDirective(goal, language = 'pt-BR') {
    const directives = {
      fechar_venda: `
## 🎯 OBJETIVO DA RESPOSTA: FECHAR VENDA
O cliente está próximo de tomar uma decisão. Sua missão é remover obstáculos e conduzir ao fechamento.
- Confirme os benefícios mais relevantes para a necessidade dele
- Remova objeções de forma proativa e segura
- Facilite o próximo passo (pagamento, assinatura, agendamento)
- Use linguagem de ação: "Posso confirmar agora", "É só..."
- Termine com uma pergunta ou CTA direto para fechar
`.trim(),

      gerar_interesse: `
## 🔥 OBJETIVO DA RESPOSTA: GERAR INTERESSE
O cliente está em fase de descoberta. Sua missão é criar desejo e avançar o relacionamento.
- Destaque benefícios reais e diferenciais (não apenas características)
- Use exemplos concretos ou histórias de sucesso quando disponíveis
- Desperte curiosidade para a próxima camada de informação
- Faça uma pergunta de continuação ao final para manter o diálogo
- Tom: empolgante mas honesto, nunca exagerado
`.trim(),

      responder_duvida: `
## 💡 OBJETIVO DA RESPOSTA: RESOLVER DÚVIDA
O cliente precisa de clareza. Sua missão é responder de forma precisa e abrir caminho para a próxima etapa.
- Vá direto ao ponto — responda a dúvida completamente
- Use informações verificadas da base de conhecimento
- Se relevante, conecte a resposta ao próximo passo natural
- Tom: profissional, claro, confiante
- Evite respostas genéricas ou incompletas
`.trim(),

      recuperar_engajamento: `
## 🔄 OBJETIVO DA RESPOSTA: RECUPERAR ENGAJAMENTO
O cliente havia demonstrado interesse mas sumiu. Sua missão é reativar a conversa com calor.
- Reconheça a ausência de forma natural, sem cobrar
- Lembre rapidamente do contexto anterior (se disponível)
- Ofereça valor imediato: nova informação, condição especial ou atualização
- Termine com uma pergunta aberta e acolhedora
- Tom: amigável, sem pressão, genuinamente útil
`.trim(),
    };

    return directives[goal] || directives['responder_duvida'];
  }

  getStats() {
    return { ...this.stats };
  }
}

module.exports = CommercialIntelligenceEngine;
