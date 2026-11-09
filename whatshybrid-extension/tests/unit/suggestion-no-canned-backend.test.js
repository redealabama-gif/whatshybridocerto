/**
 * IA-39 — com o backend conectado, quando a IA do servidor falhava (MÉTODO 0
 * /api/v2/ai/process e MÉTODO 3 /api/v1/ai/complete), o popup "Sugestão de IA"
 * caía no MÉTODO 4 (smart-suggestions.js) e mostrava uma frase pronta sorteada
 * sem ler a conversa — "Ok! Em que posso ser útil?", "Certo! Pode me dar mais
 * detalhes?" — como se fosse a sugestão da IA. São exatamente os textos dos
 * prints do usuário. O comentário do código dizia que esse fallback "só deve
 * entrar quando NÃO há backend nem providers", mas a condição não verificava.
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { loadSuggestionEnv, FRASES_PRONTAS } = require('./_suggestion-env');

const backendFalhando = () => ({
  isConnected: () => true,
  ai: {
    process: async () => { throw new Error('orchestrator_timeout'); },
    complete: async () => { const e = new Error('Request failed with status code 404'); e.status = 404; throw e; },
  },
});

test('IA-39: backend conectado e IA do servidor falhando → erro com "Tentar Novamente", nunca frase pronta', async () => {
  const { sandbox, body } = loadSuggestionEnv({ backend: backendFalhando() });
  await sandbox.AISuggestionFixed.generateSuggestion();
  const html = body.innerHTML;
  const frase = FRASES_PRONTAS.find((f) => html.includes(f));
  assert.ok(!frase, `o popup mostrou a frase pronta "${frase}" como sugestão`);
  assert.match(html, /Tentar Novamente/, `esperava o erro com nova tentativa; painel: ${html.replace(/\s+/g, ' ').slice(0, 300)}`);
  assert.match(html, /servidor/i, 'o erro deve dizer que foi a IA do servidor que falhou');
});

test('IA-39: sugestão do orquestrador com o telefone da loja (liberado no backend, IA-07) aparece como veio', async () => {
  const texto = 'Pode ligar no (11) 3456-7890, é o telefone da loja, que te passo o rastreio por lá.';
  const backend = { isConnected: () => true, ai: { process: async () => ({ success: true, response: texto, metadata: {} }) } };
  const { sandbox, body } = loadSuggestionEnv({ backend, safetyFilter: true });
  assert.ok(sandbox.aiSafetyFilter, 'filtro local não carregou');
  await sandbox.AISuggestionFixed.generateSuggestion();
  const frase = FRASES_PRONTAS.find((f) => body.innerHTML.includes(f));
  assert.ok(!frase, `a sugestão do servidor foi trocada pela frase pronta "${frase}"`);
  assert.ok(body.innerHTML.includes('3456-7890'), `sugestão do servidor não apareceu: ${body.innerHTML.replace(/\s+/g, ' ').slice(0, 300)}`);
});

test('IA-39 (controle): sem backend e sem provedores (modo offline) → sugestão local continua', async () => {
  const { sandbox, body } = loadSuggestionEnv({});
  await sandbox.AISuggestionFixed.generateSuggestion();
  assert.ok(body.innerHTML.trim().length > 0, 'painel vazio');
  assert.doesNotMatch(body.innerHTML, /Tentar Novamente/);
});
