'use strict';

/**
 * Testes da calibração de custo do ResponseQualityChecker (Fase 2a):
 *  - no_context agora é normalizado (acento + prefixo) → não dispara falso
 *    positivo quando a resposta PARAFRASEIA o conhecimento;
 *  - intents de baixo risco não são rotulados como "generic".
 */

const ResponseQualityChecker = require('../../src/ai/quality/ResponseQualityChecker');

const checker = new ResponseQualityChecker();

describe('ResponseQualityChecker — no_context normalizado', () => {
  const knowledge = [{ content: 'Nós entregamos rápido para todo o Brasil em até 5 dias' }];

  test('resposta que PARAFRASEIA o conhecimento NÃO é falso no_context', () => {
    // "entrega" casa "entregamos" por prefixo; antes (substring exato) dava
    // no_context e disparava regeneração inútil.
    const r = checker.evaluate('Fazemos a entrega em poucos dias para sua região.', {
      goal: 'responder_duvida',
      knowledge,
    });
    expect(r.issues).not.toContain('no_context');
  });

  test('resposta totalmente alheia ao conhecimento É flagada como no_context', () => {
    const r = checker.evaluate('Bom dia, tenha um excelente feriado prolongado!', {
      goal: 'responder_duvida',
      knowledge,
    });
    expect(r.issues).toContain('no_context');
  });
});

describe('ResponseQualityChecker — intents de baixo risco', () => {
  // "Olá!" casa um GENERIC_PATTERN (saudação isolada) — serve para exercitar
  // a supressão por intent de baixo risco.
  test('saudação genérica NÃO é rotulada como generic quando intent=greeting', () => {
    const r = checker.evaluate('Olá!', { intent: 'greeting', goal: 'responder_duvida' });
    expect(r.issues).not.toContain('generic');
  });

  test('mesma saudação genérica É flagada quando intent NÃO é de baixo risco', () => {
    const r = checker.evaluate('Olá!', { intent: 'pricing', goal: 'responder_duvida' });
    expect(r.issues).toContain('generic');
  });

  test('LOW_STAKES_INTENTS exposto como estático para o orquestrador', () => {
    expect(ResponseQualityChecker.LOW_STAKES_INTENTS).toBeInstanceOf(Set);
    expect(ResponseQualityChecker.LOW_STAKES_INTENTS.has('greeting')).toBe(true);
    expect(ResponseQualityChecker.LOW_STAKES_INTENTS.has('pricing')).toBe(false);
  });
});
