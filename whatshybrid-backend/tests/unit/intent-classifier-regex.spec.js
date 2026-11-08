'use strict';

/**
 * IA-03 — HybridIntentClassifier: uma saudação no começo da mensagem não decide
 * a intenção, e um único termo solto ("semana", "dia" dentro de "diabetes")
 * não pula o LLM. Mensagens do cenário S1 da auditoria
 * (audit/evidencias/23-classificador-intencao.md).
 */

const HybridIntentClassifier = require('../../src/ai/classifiers/HybridIntentClassifier');

const c = new HybridIntentClassifier({});
const rx = (m) => c.classifyWithRegex(m.toLowerCase());

describe('IA-03 — saudação no começo não decide a intenção', () => {
  test('"Oi, quanto custa…" é pergunta de preço', () => {
    expect(rx('Oi, quanto custa o plano mensal de vocês? Tem desconto no anual?').intent).toBe(
      'pricing'
    );
  });

  test('"Bom dia! Vocês entregam…" não é saudação', () => {
    expect(rx('Bom dia! Vocês entregam em Campinas? Qual o prazo?').intent).not.toBe('greeting');
  });

  test('só o cumprimento continua sendo saudação, com confiança alta', () => {
    for (const m of ['Bom dia', 'Oi, tudo bem?', 'Olá!', 'E aí, tudo certo?']) {
      const r = rx(m);
      expect(r.intent).toBe('greeting');
      expect(r.confidence).toBeGreaterThan(c.confidenceThreshold);
    }
  });

  test('"Falar com…" e "Oitenta…" não começam com saudação', () => {
    expect(rx('Falar com atendente').intent).not.toBe('greeting');
    expect(rx('Oitenta reais está bom?').intent).not.toBe('greeting');
  });
});

describe('IA-03 — desempate por domínio, não pelo tamanho da regex', () => {
  test('reclamação de entrega é complaint', () => {
    expect(rx('Comprei semana passada e até agora não chegou, estou bem chateado').intent).toBe(
      'complaint'
    );
  });

  test('dinheiro de volta / Procon não é intenção de compra', () => {
    expect(['cancellation', 'complaint']).toContain(
      rx('Quero meu dinheiro de volta, vou no Procon').intent
    );
  });

  test('"diabetes" não vira agendamento', () => {
    expect(rx('Esse suplemento cura diabetes? Posso parar o remédio?').intent).not.toBe('schedule');
  });

  test('agendar um horário é schedule', () => {
    expect(rx('Quero agendar um horário para amanhã').intent).toBe('schedule');
  });
});

describe('IA-03 — termo solto não pula o LLM', () => {
  test('match único de substring fica abaixo do limiar', () => {
    const r = rx('Esse suplemento cura diabetes? Posso parar o remédio?');
    expect(r.confidence).toBeLessThanOrEqual(c.confidenceThreshold);
  });

  test('classify() consulta o LLM numa mensagem ambígua', async () => {
    const clf = new HybridIntentClassifier({});
    const spy = jest
      .spyOn(clf, 'classifyWithLLM')
      .mockResolvedValue({ intent: 'complaint', confidence: 0.9 });
    const r = await clf.classify(
      'Comprei semana passada e até agora não chegou, estou bem chateado'
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.intent).toBe('complaint');
    expect(r.source).toBe('llm');
  });

  test('palavra inteira exata ("sim") continua decisiva sem LLM', () => {
    const r = rx('sim');
    expect(r.intent).toBe('confirmation');
    expect(r.confidence).toBeGreaterThan(c.confidenceThreshold);
  });
});
