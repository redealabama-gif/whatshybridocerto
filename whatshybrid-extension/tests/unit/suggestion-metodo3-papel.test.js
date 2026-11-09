/**
 * IA-42 (extensão) — o MÉTODO 3 do popup (/api/v1/ai/complete, usado quando o
 * orquestrador falha) mandava o próprio prompt: "Você é um atendente humano,
 * atencioso e profissional..." e a conversa rotulada "Atendente:"/"Cliente:".
 * Com a chave real, a sugestão saía como atendente de loja ("Perfeito, o código
 * de rastreio que você enviou realmente pertence à transportadora Jet") até
 * quando o dono da conta era o comprador, e inventava preço ("R$ [valor]").
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { loadSuggestionEnv, CONV } = require('./_suggestion-env');

test('IA-42: MÉTODO 3 pede a próxima mensagem do dono da conta, com "Eu"/"Contato"', async () => {
  let sent = null;
  const backend = {
    isConnected: () => true,
    ai: {
      process: async () => { throw new Error('orchestrator_timeout'); },
      complete: async (messages) => { sent = messages; return { content: 'Show, valeu! Vou acompanhar pela Jet.' }; },
    },
  };
  const { sandbox, body } = loadSuggestionEnv({ backend });
  await sandbox.AISuggestionFixed.generateSuggestion();
  assert.ok(sent, 'o MÉTODO 3 não foi chamado');
  const [system, user] = sent;
  assert.doesNotMatch(system.content, /atendente humano/i);
  assert.match(system.content, /próxima mensagem que o dono deste WhatsApp/i);
  assert.match(system.content, /Não invente/i);
  assert.ok(user.content.includes(`Eu: ${CONV[0][1]}`), `transcrição sem "Eu:": ${user.content}`);
  assert.ok(user.content.includes(`Contato: ${CONV[3][1]}`), `transcrição sem "Contato:": ${user.content}`);
  assert.doesNotMatch(user.content, /Cliente:|Atendente:/);
  assert.match(body.innerHTML, /Show, valeu! Vou acompanhar pela Jet\./);
});

test('IA-42: resposta do MÉTODO 3 que repete o rótulo ("Eu: ...") aparece sem ele', async () => {
  const backend = {
    isConnected: () => true,
    ai: {
      process: async () => { throw new Error('orchestrator_timeout'); },
      complete: async () => ({ content: 'Eu: Obrigado! Vou acompanhar o rastreio na Jet.' }),
    },
  };
  const { sandbox, body } = loadSuggestionEnv({ backend });
  await sandbox.AISuggestionFixed.generateSuggestion();
  assert.match(body.innerHTML, /Obrigado! Vou acompanhar o rastreio na Jet\./);
  assert.doesNotMatch(body.innerHTML, /Eu: Obrigado/);
});
