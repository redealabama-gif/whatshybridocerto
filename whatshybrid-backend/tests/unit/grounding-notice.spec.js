'use strict';

/**
 * Testes do grounding/escalonamento (Fase 3a) no DynamicPromptBuilder.
 * Quando o cliente pergunta algo que exige conhecimento do negócio e o RAG não
 * trouxe nada, o prompt ganha um aviso instruindo a NÃO inventar e oferecer um
 * atendente. Em saudações/agradecimentos (ou quando há conhecimento), nada muda.
 */

const promptBuilder = require('../../src/ai/prompts/DynamicPromptBuilder'); // singleton
const { KNOWLEDGE_SEEKING_INTENTS } = promptBuilder;

const MARKER = 'Sem informação específica'; // trecho do aviso pt-BR

function withEnv(key, val, fn) {
  const old = process.env[key];
  if (val === undefined) delete process.env[key];
  else process.env[key] = val;
  try { return fn(); } finally {
    if (old === undefined) delete process.env[key];
    else process.env[key] = old;
  }
}

describe('DynamicPromptBuilder.buildGroundingNoticeSection', () => {
  test('intent que exige conhecimento + sem conhecimento → retorna aviso', () => {
    const t = promptBuilder.buildGroundingNoticeSection('pricing', false, 'pt-BR');
    expect(t).toContain(MARKER);
    expect(t).toMatch(/atendente/i);
  });

  test('com conhecimento → null (não há lacuna)', () => {
    expect(promptBuilder.buildGroundingNoticeSection('pricing', true, 'pt-BR')).toBeNull();
  });

  test('intent não-cacheável de conhecimento (greeting) → null', () => {
    expect(promptBuilder.buildGroundingNoticeSection('greeting', false, 'pt-BR')).toBeNull();
  });

  test('kill-switch WHL_GROUNDING_OFF=1 → null', () => {
    withEnv('WHL_GROUNDING_OFF', '1', () => {
      expect(promptBuilder.buildGroundingNoticeSection('pricing', false, 'pt-BR')).toBeNull();
    });
  });

  test('i18n: en e es retornam aviso no idioma certo', () => {
    expect(promptBuilder.buildGroundingNoticeSection('support', false, 'en')).toMatch(/human agent/i);
    expect(promptBuilder.buildGroundingNoticeSection('support', false, 'es')).toMatch(/agente humano/i);
  });
});

describe('DynamicPromptBuilder.build — integração do aviso de grounding', () => {
  const text = (cfg) => {
    const r = promptBuilder.build(cfg);
    return r && r.prompt ? r.prompt : r;
  };

  test('pricing + conhecimento vazio → prompt inclui o aviso', () => {
    expect(text({ intent: 'pricing', knowledge: [], language: 'pt-BR' })).toContain(MARKER);
  });

  test('pricing + conhecimento presente → prompt NÃO inclui o aviso', () => {
    const out = text({ intent: 'pricing', knowledge: [{ content: 'O plano custa R$99/mês', score: 0.9 }], language: 'pt-BR' });
    expect(out).not.toContain(MARKER);
  });

  test('greeting + conhecimento vazio → prompt NÃO inclui o aviso', () => {
    expect(text({ intent: 'greeting', knowledge: [], language: 'pt-BR' })).not.toContain(MARKER);
  });
});

describe('KNOWLEDGE_SEEKING_INTENTS exportado', () => {
  test('inclui intents de informação e exclui saudação', () => {
    expect(KNOWLEDGE_SEEKING_INTENTS.has('pricing')).toBe(true);
    expect(KNOWLEDGE_SEEKING_INTENTS.has('information')).toBe(true);
    expect(KNOWLEDGE_SEEKING_INTENTS.has('greeting')).toBe(false);
  });
});
