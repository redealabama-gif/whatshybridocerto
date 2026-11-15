/**
 * WA-03 — miniatura guardada como se fosse o arquivo original.
 *
 * Medido no WhatsApp do dono (15/11/2026, scripts/wa-recover-storage-probe.js):
 * 4 registros de imagem com 4 KB estavam marcados como "arquivo completo".
 * Uma imagem real do mesmo aparelho tem 151 KB — aqueles 4 KB são a miniatura.
 *
 * Duas consequências, as duas cobertas aqui:
 *   1. o painel oferece "Baixar" prometendo o original e entrega a miniatura;
 *   2. pior: applyMediaUpdate tratava o registro como completo e RECUSAVA o
 *      original quando ele finalmente chegava (hasFull) — a miniatura ficava
 *      para sempre.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const FILE = path.join(__dirname, '../../modules/recover-advanced.js');

function carregarRecover() {
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const guardado = {};
  const sandbox = {
    console: quiet,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    queueMicrotask: (fn) => fn(),
    document: { readyState: 'complete', addEventListener() {}, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, body: null },
    addEventListener() {}, removeEventListener() {},
    location: { origin: 'https://web.whatsapp.com', href: 'https://web.whatsapp.com/' },
    navigator: { userAgent: 'node' },
    fetch: async () => { throw new Error('sem rede no teste'); },
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    localStorage: {
      getItem: (k) => (k in guardado ? guardado[k] : null),
      setItem: (k, v) => { guardado[k] = String(v); },
      removeItem: (k) => { delete guardado[k]; },
    },
    chrome: {
      runtime: { id: 'test', sendMessage() {}, onMessage: { addListener() {} }, lastError: null },
      storage: {
        local: {
          get: (keys, cb) => { const out = {}; (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in guardado) out[k] = guardado[k]; }); return cb ? cb(out) : Promise.resolve(out); },
          set: (obj, cb) => { Object.assign(guardado, obj); return cb ? cb() : Promise.resolve(); },
          remove: (k, cb) => { delete guardado[k]; return cb ? cb() : Promise.resolve(); },
        },
        onChanged: { addListener() {} },
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'recover-advanced.js' });
  return sandbox.RecoverAdvanced;
}

const dataUrl = (mime, kb) => `data:${mime};base64,${'A'.repeat(Math.round((kb * 1024 * 4) / 3))}`;

const MINIATURA = dataUrl('image/jpeg', 4);    // o que o WhatsApp embute na mensagem
const ORIGINAL = dataUrl('image/jpeg', 151);   // tamanho real medido no aparelho do dono

async function comRegistro(R, id) {
  await R.addMessage({ id, chatId: '5511999@c.us', from: '5511999', to: 'me', type: 'image', action: 'revoked', mimetype: 'image/jpeg', body: '' });
  return () => R.getMessages().find((m) => m.id === id);
}

test('WA-03: o original substitui a miniatura que ficou guardada sem a marca', async () => {
  const R = carregarRecover();
  const achar = await comRegistro(R, 'MSG_SEM_MARCA');

  // Estado real do aparelho do dono: miniatura guardada SEM isThumbnail
  // (versões antigas só marcavam quando dava para baixar o original).
  await R.applyMediaUpdate({ id: 'MSG_SEM_MARCA', mediaData: MINIATURA, mimetype: 'image/jpeg' });
  const antes = achar();
  assert.ok(antes && antes.mediaData, 'a miniatura não foi guardada');
  assert.strictEqual(antes.mediaIsThumbnail, false, 'cenário: o registro está marcado como arquivo completo');

  // O original chega depois (download no ato da captura, WA-02b).
  await R.applyMediaUpdate({ id: 'MSG_SEM_MARCA', mediaData: ORIGINAL, mimetype: 'image/jpeg', isThumbnail: false });
  const depois = achar();
  assert.ok(
    depois.mediaData.length > antes.mediaData.length * 4,
    'o original foi RECUSADO: o registro continuou com a miniatura de 4 KB para sempre'
  );
});

test('WA-03 (controle): arquivo original de verdade não é trocado por uma miniatura', async () => {
  const R = carregarRecover();
  const achar = await comRegistro(R, 'MSG_COM_ORIGINAL');
  await R.applyMediaUpdate({ id: 'MSG_COM_ORIGINAL', mediaData: ORIGINAL, mimetype: 'image/jpeg', isThumbnail: false });
  const antes = achar().mediaData.length;
  await R.applyMediaUpdate({ id: 'MSG_COM_ORIGINAL', mediaData: MINIATURA, mimetype: 'image/jpeg', isThumbnail: true });
  assert.strictEqual(achar().mediaData.length, antes, 'uma miniatura sobrescreveu o arquivo original');
});

test('WA-03 (controle): re-download de tamanho parecido não reescreve o registro à toa', async () => {
  const R = carregarRecover();
  const achar = await comRegistro(R, 'MSG_IGUAL');
  await R.applyMediaUpdate({ id: 'MSG_IGUAL', mediaData: ORIGINAL, mimetype: 'image/jpeg', isThumbnail: false });
  const antes = achar().mediaData;
  await R.applyMediaUpdate({ id: 'MSG_IGUAL', mediaData: dataUrl('image/jpeg', 155), mimetype: 'image/jpeg', isThumbnail: false });
  assert.strictEqual(achar().mediaData, antes, 'trocou um arquivo completo por outro de tamanho parecido');
});
