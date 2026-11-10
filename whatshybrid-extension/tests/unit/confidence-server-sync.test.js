/**
 * IA-60 — a confiança do Autopilot ficava só no navegador.
 *
 * ConfidenceSystem (pontuação que libera o envio automático, modo copiloto e
 * limite) era gravado só em chrome.storage. Computador novo, navegador
 * reinstalado ou dados apagados → pontuação 0 e Autopilot travado até o cliente
 * aprovar dezenas de sugestões de novo. Agora vai para o servidor
 * (/api/v1/sync/autopilot_confidence, por usuário) e volta no computador novo
 * — sem que o estado zerado do computador novo apague o do servidor.
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

const MODULE = path.join(__dirname, '../../modules/confidence-system.js');
const DO_SERVIDOR = {
  schemaVersion: 2, score: 92, level: 'expert', copilotEnabled: true, threshold: 85,
  metrics: { feedbackGood: 50, feedbackBad: 2, feedbackCorrections: 6, suggestionsUsed: 55, suggestionsEdited: 6, autoSent: 30, faqsAdded: 10, productsAdded: 5, examplesAdded: 3, totalInteractions: 58 },
};

function ambiente({ local, servidor = DO_SERVIDOR, conectaDepoisDe = 0 } = {}) {
  const store = local ? { whl_confidence_system: JSON.stringify(local) } : {};
  const enviados = [];
  let consultas = 0;
  const prev = { window: global.window, chrome: global.chrome };
  global.window = {
    confidenceSystem: {}, // impede o init() automático
    BackendClient: {
      isConnected: () => ++consultas > conectaDepoisDe,
      get: async (url) => (url === '/api/v1/sync/autopilot_confidence/download' ? { success: true, data: servidor ? JSON.parse(JSON.stringify(servidor)) : null } : null),
      post: async (url, body) => { if (url === '/api/v1/sync/autopilot_confidence') enviados.push(JSON.parse(JSON.stringify(body.data))); return { success: true }; },
    },
  };
  global.chrome = { storage: { local: {
    get: async (k) => { const r = {}; (Array.isArray(k) ? k : [k]).forEach((x) => { if (store[x] !== undefined) r[x] = store[x]; }); return r; },
    set: async (o) => { Object.assign(store, o); },
  } } };
  delete require.cache[require.resolve(MODULE)];
  require(MODULE);
  const CS = global.window.ConfidenceSystem;
  const cs = new CS();
  const restaurar = () => { global.window = prev.window; global.chrome = prev.chrome; };
  return { cs, store, enviados, restaurar };
}

test('IA-60: computador novo recebe a confiança que estava no servidor', async () => {
  const { cs, store, restaurar } = ambiente();
  try {
    await cs.init();
    await cs._reconcilePromise;
    assert.strictEqual(cs.score, 92, `pontuação no computador novo: ${cs.score}`);
    assert.strictEqual(cs.copilotEnabled, true);
    assert.strictEqual(cs.threshold, 85);
    assert.strictEqual(JSON.parse(store.whl_confidence_system).score, 92, 'não gravou no navegador');
  } finally { restaurar(); }
});

test('IA-60: o que muda na confiança vai para o servidor', async () => {
  const { cs, enviados, restaurar } = ambiente();
  try {
    await cs.init();
    await cs._reconcilePromise;
    await cs.sendConfidenceFeedback('good', { source: 'teste' });
    const ultimo = enviados[enviados.length - 1];
    assert.ok(ultimo, 'nada enviado ao servidor');
    assert.strictEqual(ultimo.metrics.feedbackGood, 51);
  } finally { restaurar(); }
});

test('IA-60: computador novo com a sessão ainda carregando não apaga a confiança do servidor', async () => {
  const { cs, enviados, restaurar } = ambiente({ conectaDepoisDe: 5 });
  try {
    await cs.init();
    await cs.sendConfidenceFeedback('good', { source: 'teste' }); // aprova algo antes de conectar
    await cs._reconcilePromise;
    assert.ok(enviados.length > 0, 'nada enviado');
    for (const e of enviados) assert.ok(e.metrics.totalInteractions >= 58, `enviou estado zerado: ${JSON.stringify(e.metrics)}`);
    assert.strictEqual(cs.score, 92);
  } finally { restaurar(); }
});

test('IA-60 (controle): navegador com mais histórico que o servidor mantém o seu e o envia', async () => {
  const local = { ...DO_SERVIDOR, score: 95, metrics: { ...DO_SERVIDOR.metrics, feedbackGood: 80, totalInteractions: 90 } };
  const { cs, enviados, restaurar } = ambiente({ local });
  try {
    await cs.init();
    await cs._reconcilePromise;
    assert.strictEqual(cs.metrics.feedbackGood, 80);
    assert.strictEqual(enviados[enviados.length - 1].metrics.feedbackGood, 80);
  } finally { restaurar(); }
});
