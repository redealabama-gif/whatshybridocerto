/**
 * IA-54 — o aprendizado com 👍/👎 nunca chegava ao backend.
 *
 * O painel de sugestão manda o feedback (Aprovar, Editar+Aprovar, Reprovar)
 * para /api/v1/ai/learn/feedback com chatId = getActiveChatId() || null. Essa
 * função só lê window.Store, que não existe no mundo isolado do content script
 * (é da página do WhatsApp) → chatId nulo → o backend responde 400 "chatId
 * inválido" e nada é gravado: correção do operador, aprovações e reprovações
 * se perdiam. Na tela real: 7 de 7 feedbacks com HTTP 400.
 * Prova real: audit/evidencias/fase3/62-aprendizado-tela-real.json.
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { loadSuggestionEnv } = require('./_suggestion-env');

function ambiente() {
  const feedbacks = [];
  const backend = {
    isConnected: () => true,
    ai: {
      process: async () => ({ success: true, response: 'Temos sim, estacionamento conveniado.', metadata: { interactionId: 'int_teste_1' } }),
      feedback: async (id, rating, payload) => { feedbacks.push({ id, rating, payload }); return { success: true }; },
    },
    autopilotMaturity: { record: async () => ({}) },
  };
  const { sandbox, body } = loadSuggestionEnv({ backend });
  // Captura os handlers reais dos botões do painel (Editar / Reprovar / Aprovar).
  const handlers = {};
  body.querySelector = (sel) => ({ addEventListener: (t, fn) => { handlers[sel] = fn; } });
  // Campo de digitação do WhatsApp e o que insertText usa.
  const composer = { focus() {}, dispatchEvent() {}, textContent: '' };
  const qs = sandbox.document.querySelector.bind(sandbox.document);
  sandbox.document.querySelector = (s) => (/compose-box|contenteditable/.test(s) ? composer : qs(s));
  sandbox.document.execCommand = () => true;
  // Sem modo edição: a caixa de edição não existe (o ambiente devolve um falso para todo id whl-ai-*).
  const gid = sandbox.document.getElementById;
  sandbox.document.getElementById = (id) => (id === 'whl-ai-sug-edit-area' ? null : gid(id));
  sandbox.InputEvent = class { constructor(t) { this.type = t; } };
  return { sandbox, handlers, feedbacks };
}
const espera = () => new Promise((r) => setTimeout(r, 200));

test('IA-54: Aprovar manda o feedback com o id da conversa (sem ele o backend recusa com 400)', async () => {
  const { sandbox, handlers, feedbacks } = ambiente();
  await sandbox.AISuggestionFixed.generateSuggestion();
  assert.ok(handlers['#whl-ai-sug-approve'], 'o painel não mostrou a sugestão');
  await handlers['#whl-ai-sug-approve']();
  await espera();
  assert.strictEqual(feedbacks.length, 1, 'nenhum feedback enviado');
  const chatId = feedbacks[0].payload && feedbacks[0].payload.chatId;
  assert.ok(typeof chatId === 'string' && chatId.length > 0, `chatId enviado: ${JSON.stringify(chatId)}`);
});

test('IA-54: Reprovar manda o feedback negativo com o id da conversa', async () => {
  const { sandbox, handlers, feedbacks } = ambiente();
  await sandbox.AISuggestionFixed.generateSuggestion();
  handlers['#whl-ai-sug-reject']();
  await espera();
  assert.strictEqual(feedbacks.length, 1, 'nenhum feedback enviado');
  assert.strictEqual(feedbacks[0].rating, 'negative');
  const chatId = feedbacks[0].payload && feedbacks[0].payload.chatId;
  assert.ok(typeof chatId === 'string' && chatId.length > 0, `chatId enviado: ${JSON.stringify(chatId)}`);
});
