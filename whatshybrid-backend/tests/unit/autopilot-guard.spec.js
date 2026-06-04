'use strict';

/**
 * Testes do AutopilotGuard (Fase 3b) — a decisão de auto-envio vs. escalonamento.
 * O autopilot envia sem revisão humana; este guard, no backend, escala pra humano
 * quando os sinais pedem (tema sensível, PII, reclamação, pedido de atendente,
 * transação de alto valor, ou resposta sem base). Puro e determinístico.
 */

const {
  evaluateAutoSend,
  HIGH_STAKES_INTENTS,
  DEFAULT_KNOWLEDGE_SEEKING_INTENTS,
} = require('../../src/ai/safety/AutopilotGuard');

function withEnv(key, val, fn) {
  const old = process.env[key];
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
}

describe('AutopilotGuard.evaluateAutoSend — permite auto-envio', () => {
  test('saudação trivial → permite', () => {
    const r = evaluateAutoSend({ intent: 'greeting', message: 'oi, bom dia!', knowledgeCount: 0 });
    expect(r.allowAutoSend).toBe(true);
    expect(r.escalate).toBe(false);
    expect(r.reasons).toEqual([]);
    expect(r.primaryReason).toBeNull();
  });

  test('pergunta de preço COM conhecimento recuperado → permite', () => {
    const r = evaluateAutoSend({
      intent: 'pricing',
      message: 'qual o preço do plano?',
      knowledgeCount: 3,
    });
    expect(r.allowAutoSend).toBe(true);
  });

  test('confirmação simples → permite', () => {
    expect(
      evaluateAutoSend({ intent: 'confirmation', message: 'sim, pode ser', knowledgeCount: 1 })
        .allowAutoSend
    ).toBe(true);
  });
});

describe('AutopilotGuard.evaluateAutoSend — escala para humano', () => {
  test('reclamação (intent complaint) → negative_sentiment', () => {
    const r = evaluateAutoSend({
      intent: 'complaint',
      message: 'o produto veio quebrado',
      knowledgeCount: 5,
    });
    expect(r.allowAutoSend).toBe(false);
    expect(r.reasons).toContain('negative_sentiment');
  });

  test('léxico negativo mesmo com intent neutro → negative_sentiment', () => {
    const r = evaluateAutoSend({
      intent: 'information',
      message: 'que PÉSSIMO atendimento, um absurdo',
      knowledgeCount: 9,
    });
    expect(r.allowAutoSend).toBe(false);
    expect(r.reasons).toContain('negative_sentiment');
  });

  test('pedido explícito de atendente → human_requested', () => {
    const r = evaluateAutoSend({
      intent: 'question',
      message: 'quero falar com um atendente',
      knowledgeCount: 9,
    });
    expect(r.allowAutoSend).toBe(false);
    expect(r.reasons).toContain('human_requested');
  });

  test('"não quero falar com robô" → human_requested', () => {
    expect(
      evaluateAutoSend({
        intent: 'question',
        message: 'não quero falar com robô',
        knowledgeCount: 9,
      }).reasons
    ).toContain('human_requested');
  });

  test('tema sensível (safety) → sensitive_topic', () => {
    const r = evaluateAutoSend({
      intent: 'question',
      message: 'estou passando mal',
      knowledgeCount: 2,
      safetyIssues: [{ type: 'sensitive_topic', topic: 'medical advice' }],
    });
    expect(r.allowAutoSend).toBe(false);
    expect(r.reasons).toContain('sensitive_topic');
  });

  test('PII vazada / injeção (safety high) → unsafe_response', () => {
    expect(
      evaluateAutoSend({
        intent: 'information',
        message: 'qual o endereço?',
        knowledgeCount: 1,
        safetyIssues: [{ type: 'pii_leak' }],
      }).reasons
    ).toContain('unsafe_response');
    expect(
      evaluateAutoSend({
        intent: 'information',
        message: 'oi',
        knowledgeCount: 1,
        safetyIssues: [{ type: 'blocked_pattern' }],
      }).reasons
    ).toContain('unsafe_response');
  });

  test('negociação e cancelamento → high_stakes_intent', () => {
    expect(
      evaluateAutoSend({ intent: 'negotiation', message: 'me dá um desconto', knowledgeCount: 3 })
        .reasons
    ).toContain('high_stakes_intent');
    expect(
      evaluateAutoSend({ intent: 'cancellation', message: 'quero cancelar', knowledgeCount: 3 })
        .reasons
    ).toContain('high_stakes_intent');
  });

  test('pergunta que exige conhecimento + RAG vazio → ungrounded', () => {
    const r = evaluateAutoSend({
      intent: 'pricing',
      message: 'quanto custa o plano enterprise?',
      knowledgeCount: 0,
    });
    expect(r.allowAutoSend).toBe(false);
    expect(r.reasons).toContain('ungrounded');
  });

  test('intent que NÃO exige conhecimento + RAG vazio → NÃO marca ungrounded', () => {
    const r = evaluateAutoSend({ intent: 'greeting', message: 'olá', knowledgeCount: 0 });
    expect(r.reasons).not.toContain('ungrounded');
    expect(r.allowAutoSend).toBe(true);
  });

  test('emotionalContext negativo (quando presente) → negative_sentiment', () => {
    const r = evaluateAutoSend({
      intent: 'question',
      message: 'e aí',
      knowledgeCount: 2,
      emotionalContext: 'angry',
    });
    expect(r.reasons).toContain('negative_sentiment');
  });
});

describe('AutopilotGuard.evaluateAutoSend — forma e robustez da saída', () => {
  test('múltiplos gatilhos acumulam e deduplicam; primaryReason é o mais prioritário', () => {
    // PII (unsafe_response) + complaint (negative_sentiment) + cancelamento (high_stakes)
    const r = evaluateAutoSend({
      intent: 'cancellation',
      message: 'que palhaçada, quero cancelar',
      knowledgeCount: 0,
      safetyIssues: [{ type: 'pii_leak' }],
    });
    expect(r.escalate).toBe(true);
    expect(r.primaryReason).toBe('unsafe_response'); // 1º na ordem de prioridade
    // sem duplicatas
    expect(new Set(r.reasons).size).toBe(r.reasons.length);
  });

  test('match de texto é acento-insensível', () => {
    // "péssimo" (com acento) e "PÉSSIMO" caem no mesmo léxico normalizado "pessimo"
    expect(
      evaluateAutoSend({ intent: 'feedback', message: 'péssimo', knowledgeCount: 1 }).reasons
    ).toContain('negative_sentiment');
  });

  test('sinais ausentes/inválidos não quebram (defaults seguros)', () => {
    expect(() => evaluateAutoSend()).not.toThrow();
    expect(() => evaluateAutoSend({})).not.toThrow();
    expect(() =>
      evaluateAutoSend({ intent: 'x', message: 123, safetyIssues: 'nope', knowledgeCount: 'NaN' })
    ).not.toThrow();
    // message não-string → sem matches de texto; sem outros sinais → permite
    expect(
      evaluateAutoSend({ intent: 'question', message: null, knowledgeCount: 2 }).allowAutoSend
    ).toBe(true);
  });

  test('options.knowledgeSeekingIntents injetado tem precedência sobre o default', () => {
    // 'feedback' não está no default; injetando um set que o inclui, vira ungrounded
    const r = evaluateAutoSend(
      { intent: 'feedback', message: 'e aí', knowledgeCount: 0 },
      { knowledgeSeekingIntents: new Set(['feedback']) }
    );
    expect(r.reasons).toContain('ungrounded');
  });
});

describe('AutopilotGuard — kill-switch e exports', () => {
  test('WHL_AUTOPILOT_GUARD=0 → passthrough (sempre permite)', () => {
    withEnv('WHL_AUTOPILOT_GUARD', '0', () => {
      const r = evaluateAutoSend({
        intent: 'complaint',
        message: 'absurdo, quero cancelar',
        knowledgeCount: 0,
        safetyIssues: [{ type: 'pii_leak' }],
      });
      expect(r.allowAutoSend).toBe(true);
      expect(r.escalate).toBe(false);
      expect(r.reasons).toEqual([]);
    });
  });

  test('conjuntos exportados têm o conteúdo esperado', () => {
    expect(HIGH_STAKES_INTENTS.has('negotiation')).toBe(true);
    expect(HIGH_STAKES_INTENTS.has('cancellation')).toBe(true);
    expect(HIGH_STAKES_INTENTS.has('greeting')).toBe(false);
    expect(DEFAULT_KNOWLEDGE_SEEKING_INTENTS.has('pricing')).toBe(true);
    expect(DEFAULT_KNOWLEDGE_SEEKING_INTENTS.has('greeting')).toBe(false);
  });
});
