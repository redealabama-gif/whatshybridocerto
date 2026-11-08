/**
 * Pré-carregado no backend de teste (NODE_OPTIONS=--require ...): redireciona as
 * chamadas aos provedores reais para o provedor falso local. As URLs dos
 * provedores são fixas no código (sem variável de ambiente), então este é o
 * único jeito de testar sem alterar o código-fonte. Qualquer outro host externo
 * de IA é bloqueado (garantia de "nenhuma chamada real").
 */
'use strict';
const FAKE = process.env.FAKE_AI_URL || 'http://127.0.0.1:18080';
const MAP = [
  ['https://api.openai.com/v1', `${FAKE}/v1`],
  ['https://api.groq.com/openai/v1', `${FAKE}/v1`],
  ['https://api.anthropic.com/v1', `${FAKE}/v1`],
];
const BLOCK = /(openai\.com|anthropic\.com|groq\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai)/i;
const orig = globalThis.fetch;
if (typeof orig === 'function') {
  globalThis.fetch = function (input, init) {
    let url = typeof input === 'string' ? input : (input && input.url) || String(input);
    for (const [from, to] of MAP) if (url.startsWith(from)) { url = to + url.slice(from.length); return orig(url, init); }
    if (BLOCK.test(url)) return Promise.reject(new Error(`[audit] chamada externa de IA bloqueada: ${url}`));
    return orig(input, init);
  };
}
