'use strict';

/**
 * AutopilotGuard — guarda de auto-envio do autopilot (FASE 3b).
 *
 * POR QUE EXISTE
 * --------------
 * O autopilot envia respostas SEM revisão humana. Hoje a decisão de auto-enviar
 * mora só no cliente (extensão) e olha um número de confiança
 * (`window.confidenceSystem`). Esse número NÃO enxerga o que o backend sabe ao
 * gerar a resposta: se o tema é sensível, se o cliente está irritado, se ele
 * pediu um humano, ou se a resposta saiu SEM base de conhecimento (um chute).
 * Resultado: um bot autônomo podia mandar um chute confiante num cliente
 * reclamando — o pior cenário de marca.
 *
 * O backend é o único lugar com TODOS esses sinais juntos (intent, filtro de
 * segurança, conhecimento recuperado). Então a inteligência da decisão mora
 * aqui, e o cliente apenas honra: o orquestrador anexa o veredito em
 * `metadata.autopilot`; no auto-envio, o cliente não envia quando
 * `allowAutoSend === false` e roteia pra revisão humana (copiloto).
 *
 * QUANDO ESCALAR PARA HUMANO (qualquer um basta)
 * ----------------------------------------------
 *   1. unsafe_response    — o texto carrega PII vazada / injeção (safety high).
 *   2. sensitive_topic    — médico/jurídico/financeiro/emergência (safety).
 *   3. human_requested    — o cliente pediu explicitamente um atendente.
 *   4. negative_sentiment — reclamação / cliente irritado (intent + léxico).
 *   5. high_stakes_intent — negociação/cancelamento: compromete dinheiro/contrato.
 *   6. ungrounded         — pergunta que exige conhecimento e o RAG não trouxe
 *                           nada → a resposta é especulação (casa com a Fase 3a).
 *
 * VIÉS DE RECALL (de propósito)
 * -----------------------------
 * Os custos são assimétricos: um falso-positivo só enfileira a mensagem pra um
 * humano revisar (dano mínimo); um falso-negativo deixa o bot mandar algo que
 * não devia (dano alto). Por isso os gatilhos são abrangentes — preferimos
 * escalar a mais do que a menos.
 *
 * 100% determinístico, sem DB e sem rede → testável em
 * tests/unit/autopilot-guard.spec.js. Reusa o `normalize` do LocalKnowledgeRanker
 * (minúscula + sem acento) pra os matches de texto serem acento-insensíveis.
 *
 * Reversível por env: WHL_AUTOPILOT_GUARD=0 → passthrough (comportamento pré-3b,
 * sempre allowAutoSend:true).
 */

const { normalize } = require('../search/LocalKnowledgeRanker');

// Intents transacionais de alto valor — comprometem dinheiro/contrato. Um bot
// autônomo não deve fechar desconto nem confirmar cancelamento sem um humano.
const HIGH_STAKES_INTENTS = new Set(['negotiation', 'cancellation']);

// FASE 4 — Gate por INTENÇÃO em vez de um limiar global de confiança. Intents
// de baixo risco (saudação, agradecimento, confirmação, info trivial como
// horário) podem auto-enviar com confiança MENOR; os demais mantêm o limiar
// normal; os escalonados nunca auto-enviam por confiança.
const LOW_RISK_INTENTS = new Set([
  'greeting',
  'goodbye',
  'thanks',
  'feedback',
  'confirmation',
  'information',
]);

// Limiares de confiança do autopilot (0..100) por tier. 'escalate' é
// inalcançável → quando escala, nunca auto-envia por confiança.
const CONFIDENCE_TIERS = { low: 70, normal: 85, escalate: 101 };

// Fallback do conjunto de intents que dependem de conhecimento do negócio. O
// orquestrador injeta o KNOWLEDGE_SEEKING_INTENTS real (DynamicPromptBuilder)
// via options pra não divergir; isto só vale se nada for injetado.
const DEFAULT_KNOWLEDGE_SEEKING_INTENTS = new Set([
  'information',
  'pricing',
  'question',
  'support',
  'schedule',
  'purchase',
  'negotiation',
]);

// emotionalContext negativos. A rota v2 hoje não envia emotionalContext, mas
// honramos pra quando a extensão começar a mandar (futuro-prova, custo zero).
const NEGATIVE_EMOTIONS = new Set(['angry', 'frustrated', 'sad', 'worried']);

// Léxico de sentimento muito negativo na PRÓPRIA mensagem do cliente, JÁ
// normalizado (sem acento). Sinal independente do classifier — pega o cliente
// irritado mesmo quando o intent saiu errado.
const NEGATIVE_LEXICON = [
  'pessimo',
  'pessima',
  'horrivel',
  'absurdo',
  'inadmissivel',
  'ridiculo',
  'vergonha',
  'palhacada',
  'enganacao',
  'enganaram',
  'golpe',
  'processar',
  'procon',
  'advogado',
  'nunca mais',
  'odiei',
  'decepcionado',
  'decepcao',
  'revoltado',
  'indignado',
  'lixo',
  'descaso',
];

// Pedido EXPLÍCITO de atendimento humano — honrar sempre. Regex sobre o texto
// normalizado (sem acento, minúsculo); por isso os tokens estão sem acento.
const HUMAN_REQUEST_PATTERNS = [
  /\b(atendente|humano|gerente|supervisor|responsavel)\b/,
  /\bpessoa (real|de verdade)\b/,
  /\bfalar com (alguem|uma pessoa|atendente|humano|gerente|voces|alguma pessoa)\b/,
  /\b(quero|queria|preciso|posso|gostaria de) falar com\b/,
  /\bme (transfere|transfira|passa|encaminha|atende)\b/,
  /\bnao (quero|e|to|estou) (falar com )?(um |uma )?(robo|bot|maquina|ia)\b/,
];

function asArray(x) {
  return Array.isArray(x) ? x : [];
}

/**
 * Decide se o autopilot pode auto-enviar ou deve escalar para um humano.
 *
 * @param {object} signals
 * @param {string}  signals.intent             intent classificado
 * @param {number}  [signals.confidence]       0..1 (reservado; hoje não bloqueia)
 * @param {string}  [signals.message]          mensagem do CLIENTE (não a resposta)
 * @param {Array}   [signals.safetyIssues]     issues do ResponseSafetyFilter
 * @param {number}  [signals.knowledgeCount]   nº de itens de conhecimento recuperados
 * @param {string}  [signals.emotionalContext] emoção do cliente, se disponível
 * @param {object}  [options]
 * @param {Set}     [options.knowledgeSeekingIntents]
 * @returns {{ allowAutoSend: boolean, escalate: boolean, reasons: string[], primaryReason: string|null }}
 */
function evaluateAutoSend(signals = {}, options = {}) {
  // Kill-switch — passthrough total (comportamento pré-3b). minConfidence null
  // → o cliente usa seu próprio limiar global (não força o tier por intenção).
  if (process.env.WHL_AUTOPILOT_GUARD === '0') {
    return { allowAutoSend: true, escalate: false, reasons: [], primaryReason: null, riskTier: 'normal', minConfidence: null };
  }

  const intent = signals.intent || 'unknown';
  const message = typeof signals.message === 'string' ? signals.message : '';
  const issues = asArray(signals.safetyIssues);
  const knowledgeCount = Number.isFinite(signals.knowledgeCount) ? signals.knowledgeCount : 0;
  const emotion = signals.emotionalContext || null;

  const knowledgeSeeking =
    options.knowledgeSeekingIntents instanceof Set
      ? options.knowledgeSeekingIntents
      : DEFAULT_KNOWLEDGE_SEEKING_INTENTS;

  const norm = normalize(message); // minúsculo, sem acento, pontuação→espaço
  const issueTypes = new Set(issues.map((i) => i && i.type).filter(Boolean));

  const reasons = [];

  // ── 1. Resposta intrinsecamente arriscada (safety de alta severidade) ──────
  if (issueTypes.has('pii_leak') || issueTypes.has('blocked_pattern')) {
    reasons.push('unsafe_response');
  }

  // ── 2. Tema sensível (médico/jurídico/financeiro/emergência) ───────────────
  if (issueTypes.has('sensitive_topic')) {
    reasons.push('sensitive_topic');
  }

  // ── 3. Pedido explícito de humano — honrar sempre ──────────────────────────
  if (norm && HUMAN_REQUEST_PATTERNS.some((re) => re.test(norm))) {
    reasons.push('human_requested');
  }

  // ── 4. Sentimento negativo / reclamação → cliente irritado quer gente ──────
  const negativeLexHit = !!norm && NEGATIVE_LEXICON.some((w) => norm.includes(w));
  if (
    intent === 'complaint' ||
    negativeLexHit ||
    (emotion && NEGATIVE_EMOTIONS.has(emotion)) ||
    issueTypes.has('inappropriate_tone')
  ) {
    reasons.push('negative_sentiment');
  }

  // ── 5. Transação de alto valor (negociação/cancelamento) ───────────────────
  if (HIGH_STAKES_INTENTS.has(intent)) {
    reasons.push('high_stakes_intent');
  }

  // ── 6. Resposta sem base — nunca auto-enviar um chute ──────────────────────
  if (knowledgeCount === 0 && knowledgeSeeking.has(intent)) {
    reasons.push('ungrounded');
  }

  // Dedup preservando a ordem de prioridade (primaryReason = mais prioritário).
  const uniqueReasons = [...new Set(reasons)];
  const escalate = uniqueReasons.length > 0;

  // FASE 4 — tier de confiança por intenção (advisory). O cliente compara a
  // confiança do autopilot contra `minConfidence`: baixo risco passa com menos,
  // os demais exigem o normal, e escalonado nunca passa por confiança.
  let riskTier;
  let minConfidence;
  if (escalate) {
    riskTier = 'high';
    minConfidence = CONFIDENCE_TIERS.escalate;
  } else if (LOW_RISK_INTENTS.has(intent)) {
    riskTier = 'low';
    minConfidence = CONFIDENCE_TIERS.low;
  } else {
    riskTier = 'normal';
    minConfidence = CONFIDENCE_TIERS.normal;
  }

  return {
    allowAutoSend: !escalate,
    escalate,
    reasons: uniqueReasons,
    primaryReason: uniqueReasons[0] || null,
    riskTier,
    minConfidence,
  };
}

module.exports = {
  evaluateAutoSend,
  HIGH_STAKES_INTENTS,
  LOW_RISK_INTENTS,
  NEGATIVE_EMOTIONS,
  DEFAULT_KNOWLEDGE_SEEKING_INTENTS,
  CONFIDENCE_TIERS,
};
