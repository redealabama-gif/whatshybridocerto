/**
 * Pré-carregado no backend (NODE_OPTIONS=--require ...) no diagnóstico com
 * chaves REAIS: deixa as chamadas aos provedores seguirem normalmente e grava,
 * em LOG_FETCH_FILE (JSONL, fora do repositório), o que foi enviado ao modelo
 * (modelo + mensagens) e a resposta crua, com status e tempo. Cobre o fetch
 * (AIRouter/providers) e o axios (rota /api/v1/ai/complete). Cabeçalhos — onde
 * ficam as chaves — nunca são gravados.
 */
'use strict';
const fs = require('fs');

const FILE = process.env.LOG_FETCH_FILE;
const AI_HOST = /(api\.openai\.com|api\.groq\.com|api\.anthropic\.com)/i;

function write(entry) {
  try { fs.appendFileSync(FILE, JSON.stringify(entry) + '\n'); } catch (_) { /* diagnóstico */ }
}
function parse(x) {
  if (x == null) return null;
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch (_) { return null; }
}
function describe(via, url, body, started) {
  return {
    via,
    at: new Date(started).toISOString(),
    url: String(url).replace(/\?.*$/, ''),
    model: body && body.model,
    messages: body && body.messages,
    temperature: body && body.temperature,
    max_tokens: body && (body.max_tokens || body.max_completion_tokens),
  };
}
function addResult(entry, status, data) {
  entry.status = status;
  const j = parse(data);
  if (j && j.choices && j.choices[0] && j.choices[0].message) entry.reply = j.choices[0].message.content;
  if (j && j.error) entry.error = j.error;
  if (j && j.usage) entry.usage = j.usage;
  if (!j && data) entry.raw = String(data).slice(0, 500);
}

if (FILE) {
  // fetch (BaseProvider e classificador)
  const orig = globalThis.fetch;
  if (typeof orig === 'function') {
    globalThis.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      if (!AI_HOST.test(url)) return orig(input, init);
      const started = Date.now();
      const entry = describe('fetch', url, parse(init && init.body), started);
      try {
        const res = await orig(input, init);
        const text = await res.clone().text().catch(() => '');
        addResult(entry, res.status, text);
        entry.ms = Date.now() - started;
        write(entry);
        return res;
      } catch (e) {
        entry.ms = Date.now() - started;
        entry.exception = String((e && e.message) || e);
        write(entry);
        throw e;
      }
    };
  }

  // axios do backend (a rota /api/v1/ai/complete chama os provedores com ele)
  try {
    const axios = require(require.resolve('axios', { paths: [process.cwd()] }));
    axios.interceptors.request.use((cfg) => {
      if (AI_HOST.test(cfg.url || '')) cfg.__auditStarted = Date.now();
      return cfg;
    });
    const done = (cfg, status, data, exception) => {
      if (!cfg || !cfg.__auditStarted) return;
      const entry = describe('axios', cfg.url, parse(cfg.data), cfg.__auditStarted);
      addResult(entry, status, data);
      if (exception) entry.exception = exception;
      entry.ms = Date.now() - cfg.__auditStarted;
      write(entry);
    };
    axios.interceptors.response.use(
      (res) => { done(res.config, res.status, res.data); return res; },
      (err) => {
        done(err && err.config, err && err.response && err.response.status, err && err.response && err.response.data, err && err.message);
        return Promise.reject(err);
      }
    );
  } catch (_) { /* sem axios: só o fetch é registrado */ }
}
