'use strict';

/**
 * IA-14 — o teste A/B alterava o texto que o modelo escreveu: a variant_b
 * colava " Posso te ajudar com mais alguma informação?" em toda resposta sem
 * "?" e a variant_a cortava "Olá!/Oi!/Claro," do começo. Com a chave real, a
 * frase colada apareceu como fim da sugestão numa conversa pessoal — o tipo de
 * texto genérico de que o usuário reclamou. A variante continua registrada nas
 * métricas; só o texto deixa de ser mexido.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-jwt-key-for-pipeline-runs-not-a-real-key';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'ci-webhook-key-for-pipeline-runs';

const AIOrchestrator = require('../../src/ai/AIOrchestrator');

function generate(variant, llmText) {
  const self = {
    aiRouter: { complete: async () => ({ content: llmText }) },
    config: { maxHistoryMessages: 10, maxResponseTokens: 300 },
    tenantId: 't-ab',
    _fallbackSystemPrompt: AIOrchestrator.prototype._fallbackSystemPrompt,
    _semanticCacheKey: () => null,
  };
  return AIOrchestrator.prototype._generateResponse.call(
    self, 'Esse rastreio é da transportadora Jet', { intent: 'information', confidence: 0.9 },
    { recentMessages: [] }, variant, [], 'prompt de sistema', 'pt-BR', false, null, null
  );
}

test('variant_b: não cola "Posso te ajudar com mais alguma informação?"', async () => {
  await expect(generate('variant_b', 'Beleza, vou acompanhar pela Jet. Valeu!')).resolves.toBe('Beleza, vou acompanhar pela Jet. Valeu!');
});

test('variant_a: não corta o começo da mensagem', async () => {
  await expect(generate('variant_a', 'Oi! Recebi o código, valeu.')).resolves.toBe('Oi! Recebi o código, valeu.');
});

test('controle: default devolve o texto do modelo', async () => {
  await expect(generate('default', 'Recebi, obrigado!')).resolves.toBe('Recebi, obrigado!');
});
