/**
 * ✅ ResponseQualityChecker
 * Vórtex Pro v10.0.0
 *
 * Avalia a qualidade de cada resposta gerada pelo LLM e,
 * se necessário, solicita uma regeneração com instruções reforçadas.
 *
 * Checklist de qualidade:
 *   ✓ answered_question  – respondeu a pergunta?
 *   ✓ used_context       – usou contexto/conhecimento?
 *   ✓ is_natural         – linguagem natural (não robótica)?
 *   ✓ has_cta            – tem call-to-action quando aplicável?
 *   ✓ not_generic        – específico, não genérico?
 *   ✓ adequate_length    – nem muito curta nem desnecessariamente longa?
 *
 * @module ai/quality/ResponseQualityChecker
 */

const logger = require('../../config/logger');
// Reusa o normalizador léxico (acento + match por prefixo) do ranker para o
// check de uso-de-contexto — evita falso "no_context" quando a resposta
// PARAFRASEIA o conhecimento (ex.: "entregamos" vs "entrega").
const { tokenize, matchTerm } = require('../search/LocalKnowledgeRanker');

// Intents de baixo risco: a resposta certa é curta/simples e regenerar via LLM
// não compensa (alto volume, baixo valor comercial). Usado para (a) não exigir
// regeneração cara e (b) não rotular uma saudação como "genérica".
const LOW_STAKES_INTENTS = new Set(['greeting', 'goodbye', 'thanks', 'feedback', 'confirmation']);

// ── Padrões de detecção de problemas ────────────────────────────────────────

const GENERIC_PATTERNS = [
  /^(claro|certo|ok|tudo\s+bem|entendido|com\s+certeza)[,!.]?\s*$/i,
  /^(olá|oi|bom\s+dia|boa\s+tarde|boa\s+noite)[,!.]?\s*$/i,
  /posso\s+(te\s+)?ajudar\s+com\s+mais\s+alguma\s+coisa/i,
  /qualquer\s+dúvida\s+estou\s+à\s+disposição/i,
  /estou\s+à\s+disposição/i,                            // v10.1: cobre "Claro, estou à disposição"
  /à\s+sua\s+disposição/i,
  /^(não\s+tenho|não\s+sei|sem\s+informações)[.!]?\s*$/i,
  /infelizmente\s+não\s+tenho\s+essa\s+informação/i,
  /não\s+(foi\s+)?possível\s+(processar|encontrar|acessar)/i,
];

const ROBOTIC_PATTERNS = [
  /como\s+um?\s+(assistente|IA|inteligência\s+artificial)/i,
  /sou\s+um?\s+(robô|bot|assistente\s+virtual)/i,
  /como\s+modelo\s+de\s+linguagem/i,
  /minha\s+base\s+de\s+dados\s+indica/i,
  /de\s+acordo\s+com\s+minhas\s+informações/i,
];

const CTA_PATTERNS = [
  /posso\s+(confirmar|ajudar|processar|agendar|continuar)/i,
  /que\s+tal\s+(agendarmos|marcarmos|confirmarmos)/i,
  /quer\s+(que\s+eu|saber\s+mais|avançar|continuar)/i,
  /\bme\s+diga\b|\bme\s+conta\b/i,
  /próximo\s+passo/i,
  /quando\s+podemos/i,
  /vamos\s+(ver|avançar|confirmar)/i,
  /\?$/m,  // termina com pergunta
];

// v11: autocrítica de TOM. Quando o cliente está negativo/irritado, a resposta
// precisa ACOLHER (empatia) antes de resolver e NÃO empurrar venda.
const EMPATHY_MARKERS = /\b(entendo|compreendo|imagino|sinto\s+muito|lamento|desculp|peço\s+desculpas?|poxa|que\s+chato|sei\s+como|reconheço)\b/i;
const SALESY_MARKERS = /\b(aproveite|promoç|oferta|desconto|compre|garanta?\s+(já|ja|agora)|não\s+perca|últimas?\s+unidades?|condição\s+especial|imperdível)\b/i;

const MIN_RESPONSE_LENGTH = 20;   // chars — evita respostas tipo "Ok!"
const MAX_RESPONSE_LENGTH = 1200; // chars — evita novelas desnecessárias

class ResponseQualityChecker {
  constructor(config = {}) {
    this.config = {
      maxRetries: 2,
      ctaRequiredGoals: ['fechar_venda', 'gerar_interesse', 'recuperar_engajamento'],
      lengthCheckEnabled: true,
      ...config,
    };

    this.stats = {
      total: 0,
      passed: 0,
      failed: 0,
      regenerated: 0,
      issueFrequency: {
        too_short:     0,
        too_long:      0,
        generic:       0,
        robotic:       0,
        missing_cta:   0,
        no_context:    0,
        tone_mismatch: 0,
      },
    };
  }

  /**
   * Avalia uma resposta e retorna o resultado do checklist.
   *
   * @param {string}  response        – Resposta gerada pelo LLM
   * @param {Object}  context         – Contexto da interação
   * @param {string}  context.message – Mensagem original do cliente
   * @param {string}  context.goal    – responseGoal classificado
   * @param {Array}   context.knowledge – Resultados do RAG
   * @returns {{ passed: boolean, issues: string[], score: number, reinforcement: string|null }}
   */
  evaluate(response, context = {}) {
    this.stats.total++;
    const issues = [];
    const {
      message = '', goal = 'responder_duvida', knowledge = [], intent = null,
      emotion = null, emotionIntensity = 0, // v11: contexto emocional p/ autocrítica de tom
    } = context;
    const isLowStakes = LOW_STAKES_INTENTS.has(intent);

    // ── 1. Comprimento adequado ────────────────────────────────────────────
    if (this.config.lengthCheckEnabled) {
      if (response.length < MIN_RESPONSE_LENGTH) {
        issues.push('too_short');
        this.stats.issueFrequency.too_short++;
      }
      if (response.length > MAX_RESPONSE_LENGTH) {
        issues.push('too_long');
        this.stats.issueFrequency.too_long++;
      }
    }

    // ── 2. Padrões genéricos ───────────────────────────────────────────────
    // Para intents de baixo risco (saudação/agradecimento/confirmação) uma
    // resposta "genérica" curta é o esperado — não é defeito.
    const isGeneric = GENERIC_PATTERNS.some(p => p.test(response));
    if (isGeneric && !isLowStakes) {
      issues.push('generic');
      this.stats.issueFrequency.generic++;
    }

    // ── 3. Linguagem robótica ──────────────────────────────────────────────
    const isRobotic = ROBOTIC_PATTERNS.some(p => p.test(response));
    if (isRobotic) {
      issues.push('robotic');
      this.stats.issueFrequency.robotic++;
    }

    // ── 4. CTA ausente (quando relevante) ─────────────────────────────────
    if (this.config.ctaRequiredGoals.includes(goal)) {
      const hasCTA = CTA_PATTERNS.some(p => p.test(response));
      if (!hasCTA) {
        issues.push('missing_cta');
        this.stats.issueFrequency.missing_cta++;
      }
    }

    // ── 5. Uso de contexto (se havia RAG disponível) ───────────────────────
    // Match léxico normalizado (acento + prefixo) em vez de substring exato:
    // "entregamos em 3 dias" CONTA como uso do conhecimento "prazo de entrega",
    // o que antes era falso "no_context" e disparava 2 regenerações inúteis.
    if (knowledge.length > 0) {
      const knowledgeTokens = tokenize(knowledge.map(k => k.content || '').join(' '), { minLen: 4, unique: true });
      const responseTokens = tokenize(response, { minLen: 3, unique: true });
      const overlap = knowledgeTokens.filter(kt => responseTokens.some(rt => matchTerm(kt, rt))).length;

      // Threshold: pelo menos 1 termo do RAG deve aparecer na resposta.
      if (overlap === 0 && knowledgeTokens.length > 0) {
        issues.push('no_context');
        this.stats.issueFrequency.no_context++;
      }
    }

    // ── 6. v11: Tom incompatível com a emoção do cliente ───────────────────
    // Cliente claramente negativo/irritado (intensidade >= 3): a resposta TEM que
    // acolher (empatia) e NÃO pode empurrar venda. Senão, regenera com reforço.
    const negativeEmotion = emotion === 'anger' || emotion === 'disappointment' || emotion === 'anxiety';
    if (negativeEmotion && Number(emotionIntensity) >= 3) {
      const hasEmpathy = EMPATHY_MARKERS.test(response);
      const hasSalesPush = SALESY_MARKERS.test(response);
      if (!hasEmpathy || hasSalesPush) {
        issues.push('tone_mismatch');
        this.stats.issueFrequency.tone_mismatch = (this.stats.issueFrequency.tone_mismatch || 0) + 1;
      }
    }

    const passed = issues.length === 0;
    const score = Math.max(0, 100 - issues.length * 20);

    if (passed) {
      this.stats.passed++;
    } else {
      this.stats.failed++;
    }

    return {
      passed,
      issues,
      score,
      reinforcement: passed ? null : this._buildReinforcement(issues, context),
    };
  }

  /**
   * Constrói instrução de reforço para a regeneração.
   * @private
   */
  _buildReinforcement(issues, context) {
    const parts = [
      '⚠️ ATENÇÃO: A resposta anterior não atendeu os critérios de qualidade. Corrija os seguintes pontos:',
    ];

    if (issues.includes('too_short')) {
      parts.push('- A resposta está MUITO CURTA. Seja mais completo e útil.');
    }
    if (issues.includes('too_long')) {
      parts.push('- A resposta está MUITO LONGA. Seja mais direto e objetivo.');
    }
    if (issues.includes('generic')) {
      parts.push('- A resposta está GENÉRICA DEMAIS. Seja específico e relevante para a situação do cliente.');
    }
    if (issues.includes('robotic')) {
      parts.push('- A resposta soa ROBÓTICA. Escreva de forma natural e humana.');
    }
    if (issues.includes('missing_cta')) {
      parts.push(`- Faltou CALL-TO-ACTION. Para o goal "${context.goal}", sempre conduza o cliente para o próximo passo.`);
    }
    if (issues.includes('no_context')) {
      parts.push('- Não utilizou o CONHECIMENTO disponível. Use as informações da empresa na resposta.');
    }
    if (issues.includes('tone_mismatch')) {
      const emo = context.emotion === 'anxiety' ? 'ansioso/inseguro'
        : context.emotion === 'disappointment' ? 'decepcionado'
        : 'irritado/frustrado';
      parts.push(`- O TOM não combina com o momento: o cliente está ${emo}. ACOLHA o sentimento dele primeiro (ex.: "entendo", "sinto muito"), seja humano e direto na solução, e NÃO use linguagem de venda/promoção.`);
    }

    parts.push('\nREGENERE agora com todas as correções aplicadas:');
    return parts.join('\n');
  }

  getStats() {
    const passRate = this.stats.total > 0
      ? ((this.stats.passed / this.stats.total) * 100).toFixed(1) + '%'
      : 'n/a';
    return { ...this.stats, passRate };
  }
}

// Compartilhado com o AIOrchestrator (_runQualityCycle) para decidir quando
// NÃO vale a pena gastar LLM regenerando.
ResponseQualityChecker.LOW_STAKES_INTENTS = LOW_STAKES_INTENTS;

module.exports = ResponseQualityChecker;
