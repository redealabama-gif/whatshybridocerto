'use strict';

/**
 * IA-03 — AutopilotGuard: pergunta factual do negócio (preço, prazo, entrega,
 * pagamento…) sem base de conhecimento é "ungrounded" mesmo que o classificador
 * tenha rotulado errado (ex.: "greeting"). Cenário S1 da auditoria: preço e
 * entrega saíam com allowAutoSend:true / riskTier low.
 */

const { evaluateAutoSend } = require('../../src/ai/safety/AutopilotGuard');

describe('IA-03 — guarda olha a mensagem, não só o rótulo', () => {
  test('preço rotulado como saudação, sem base → não auto-envia', () => {
    const g = evaluateAutoSend({
      intent: 'greeting',
      message: 'Oi, quanto custa o plano mensal de vocês? Tem desconto no anual?',
      knowledgeCount: 0,
    });
    expect(g.allowAutoSend).toBe(false);
    expect(g.reasons).toContain('ungrounded');
  });

  test('entrega rotulada como saudação, sem base → não auto-envia', () => {
    const g = evaluateAutoSend({
      intent: 'greeting',
      message: 'Bom dia! Vocês entregam em Campinas? Qual o prazo?',
      knowledgeCount: 0,
    });
    expect(g.allowAutoSend).toBe(false);
    expect(g.reasons).toContain('ungrounded');
  });

  test('pergunta factual COM base → libera, mas no tier normal (não "baixo risco")', () => {
    const g = evaluateAutoSend({
      intent: 'greeting',
      message: 'Oi, quanto custa o plano mensal de vocês?',
      knowledgeCount: 2,
    });
    expect(g.allowAutoSend).toBe(true);
    expect(g.riskTier).toBe('normal');
  });

  test('controle: saudação de verdade continua baixo risco', () => {
    const g = evaluateAutoSend({ intent: 'greeting', message: 'Bom dia', knowledgeCount: 0 });
    expect(g.allowAutoSend).toBe(true);
    expect(g.riskTier).toBe('low');
  });
});
