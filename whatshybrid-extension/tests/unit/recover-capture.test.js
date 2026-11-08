/**
 * Recover — captura de mensagens apagadas e editadas (wpp-hooks.js).
 *
 * Carrega o content/wpp-hooks.js REAL (o arquivo que vai para a extensão)
 * dentro de um WhatsApp Web simulado:
 *   - a coleção de mensagens só existe em require('WAWebCollections').Msg, como
 *     no WhatsApp Web atual (o require('WAWebMsgCollection').Msg antigo NÃO
 *     existe — era a causa de os hooks de coleção não se registrarem);
 *   - a coleção emite add / change:type / remove como a do WhatsApp.
 *
 * Cenário do relatório: mensagens enviadas por você ("ei"), apagadas para todos
 * e editadas ("ei" → "eij"). O Recover precisa registrar o conteúdo original.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');
const HOOKS_FILE = path.join(EXT, 'content/wpp-hooks.js');
const PARTS_DIR = path.join(EXT, 'content/wpp-hooks-parts');

const CHAT = '5521995800771@c.us';
const ME = '559284891875@c.us';
const T_0717 = 1762586220; // horário de envio (segundos, como msg.t do WhatsApp)

let seq = 0;
function makeMsg(body, { fromMe = true, t = T_0717, type = 'chat' } = {}) {
  const id = '3EB0' + String(++seq).padStart(16, '0');
  const sender = fromMe ? ME : CHAT;
  const receiver = fromMe ? CHAT : ME;
  return {
    id: { id, remote: CHAT, fromMe, _serialized: `${fromMe}_${CHAT}_${id}` },
    from: { _serialized: sender, user: sender.split('@')[0] },
    to: { _serialized: receiver, user: receiver.split('@')[0] },
    body,
    type,
    t,
  };
}

// Coleção no estilo da do WhatsApp (Backbone-like).
function makeCollection() {
  const models = new Map();
  const handlers = {};
  const keyOf = (k) => (k && typeof k === 'object' ? k._serialized : k);
  return {
    handlers,
    on(events, cb) {
      for (const e of String(events).split(/\s+/)) (handlers[e] = handlers[e] || []).push(cb);
    },
    emit(e, ...args) {
      for (const cb of handlers[e] || []) cb(...args);
    },
    get(k) {
      return models.get(keyOf(k)) || null;
    },
    getModelsArray() {
      return [...models.values()];
    },
    put(m) { models.set(m.id._serialized, m); }, // já carregada, sem evento
    add(m) { this.put(m); this.emit('add', m); },
    // Como no WhatsApp: a revogação apaga o conteúdo E os dados de download.
    revoke(m) {
      m.type = 'revoked'; m.body = ''; m.caption = undefined;
      m.directPath = undefined; m.mediaKey = undefined; m.filehash = undefined; m.encFilehash = undefined;
      this.emit('change:type', m, 'revoked');
    },
    remove(m) { models.delete(m.id._serialized); this.emit('remove', m); },
  };
}

function memStorage() {
  const s = new Map();
  return {
    getItem: (k) => (s.has(k) ? s.get(k) : null),
    setItem: (k, v) => s.set(k, String(v)),
    removeItem: (k) => s.delete(k),
    clear: () => s.clear(),
  };
}

function stubElement() {
  return {
    style: {}, dataset: {}, children: [], classList: { add() {}, remove() {}, contains: () => false },
    appendChild(c) { return c; }, removeChild() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    remove() {},
  };
}

// Balão na tela (o WhatsApp só redesenha depois do evento): texto, ícone
// (data-icon) e títulos — o suficiente para os seletores usados pelo hook.
function makeDomBubble(spec) {
  const { text = '', icon = null, titles = [] } = typeof spec === 'string' ? { text: spec } : spec;
  const span = { childNodes: text ? [{ nodeType: 3, nodeValue: text }] : [], textContent: text };
  const iconMatches = (sel) => !!icon && sel.split(',').some((part) => {
    const m = /\[data-icon(\*|\^)?="([^"]+)"( i)?\]/.exec(part.trim());
    if (!m) return false;
    const val = m[3] ? icon.toLowerCase() : icon;
    const pat = m[3] ? m[2].toLowerCase() : m[2];
    return m[1] === '*' ? val.includes(pat) : m[1] === '^' ? val.startsWith(pat) : val === pat;
  });
  return {
    querySelector(sel) {
      if (/recalled/.test(sel)) return icon && /recalled/.test(icon) ? {} : null;
      if (/selectable-text|msg-text|data-pre-plain-text/.test(sel)) return text ? span : null;
      return iconMatches(sel) ? {} : null;
    },
    querySelectorAll(sel) {
      if (sel === '[title]') return titles.map((t) => ({ getAttribute: () => t }));
      return [];
    },
  };
}

async function bootHooks({ preloaded = [], downloadManager = null, dom = {}, activeChat = null } = {}) {
  const coll = makeCollection();
  preloaded.forEach((m) => coll.put(m));
  const posted = [];
  const modules = {
    WAWebMessageProcessRenderable: { processRenderableMessages: (msgs) => msgs },
    WAWebDBProcessEditProtocolMsgs: { processEditProtocolMsgs: (arr) => arr },
    WAWebCollections: { Msg: coll },
  };
  if (downloadManager) modules.WAWebDownloadManager = { downloadManager };
  if (activeChat) modules.WAWebChatCollection = { ChatCollection: { getActive: () => activeChat, getModelsArray: () => [activeChat] } };
  const intervals = [];
  const req = (name) => {
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
    throw new Error('Cannot find module ' + name);
  };
  const quiet = { log() {}, info() {}, debug() {}, warn() {}, error() {}, group() {}, groupEnd() {}, table() {} };
  const doc = Object.assign(stubElement(), {
    readyState: 'complete',
    head: stubElement(),
    body: stubElement(),
    documentElement: stubElement(),
    createElement: () => stubElement(),
    getElementById: () => null,
    querySelector: (sel) => {
      const m = /\[data-id="([^"]+)"\]/.exec(sel);
      return m && Object.prototype.hasOwnProperty.call(dom, m[1]) ? makeDomBubble(dom[m[1]]) : null;
    },
  });
  const sandbox = {
    console: quiet,
    setTimeout, clearTimeout,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; }, clearInterval() {},
    Blob, URL, TextEncoder, TextDecoder, Promise, Date, Math, JSON, Map, Set, Error,
    btoa, atob, AbortController,
    require: req,
    localStorage: memStorage(),
    sessionStorage: memStorage(),
    location: { origin: 'https://web.whatsapp.com', href: 'https://web.whatsapp.com/' },
    document: doc,
    navigator: { userAgent: 'node-test' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    postMessage: (data) => posted.push(data),
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    CustomEvent: function (type, init) { return { type, detail: init && init.detail }; },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(HOOKS_FILE, 'utf8'), sandbox, { filename: 'wpp-hooks.js' });

  // Os hooks iniciam ~1s depois (setTimeout(load_and_start, 1000)).
  const deadline = Date.now() + 6000;
  while (!coll.handlers['change:type'] && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(coll.handlers['change:type'], 'hook de revogação (change:type) não se registrou na coleção');

  const records = () => posted
    .filter((p) => p && p.type === 'WHL_RECOVER_NEW_MESSAGE')
    .map((p) => p.payload);
  const mediaReady = () => posted
    .filter((p) => p && p.type === 'WHL_RECOVER_MEDIA_READY')
    .map((p) => p.payload);
  const received = () => posted.filter((p) => p && p.type === 'WHL_MESSAGE_RECEIVED');
  // Roda a varredura periódica da conversa aberta (o setInterval é simulado).
  const sweepActiveChat = () => intervals
    .filter((i) => String(i.fn).includes('cachearConversaAberta'))
    .forEach((i) => i.fn());
  return { coll, modules, records, mediaReady, received, sweepActiveChat, sandbox };
}

test('Recover: hooks de coleção se registram com o caminho atual (WAWebCollections.Msg)', async () => {
  const { coll } = await bootHooks();
  for (const evt of ['add', 'remove', 'change:type', 'change:ack']) {
    assert.ok((coll.handlers[evt] || []).length > 0, `nenhum listener em "${evt}"`);
  }
});

test('Recover: mensagem SUA apagada para todos guarda o conteúdo original e os horários', async () => {
  const { coll, records } = await bootHooks();
  const msg = makeMsg('ei');
  coll.add(msg); // enviada por você
  const before = Date.now();
  coll.revoke(msg); // apagada para todos
  const recs = records();
  assert.strictEqual(recs.length, 1, 'deveria registrar exatamente 1 evento');
  const r = recs[0];
  assert.strictEqual(r.action, 'revoked');
  assert.strictEqual(r.body, 'ei', 'conteúdo original não foi recuperado');
  assert.strictEqual(r.contentCaptured, true);
  assert.strictEqual(r.fromMe, true);
  assert.strictEqual(r.originalTimestamp, T_0717 * 1000, 'horário de envio errado');
  assert.ok(r.timestamp >= before, 'timestamp deve ser o momento da exclusão');
  assert.strictEqual(r.id, msg.id.id);
});

test('Recover: mensagem já aberta antes de a extensão iniciar também é recuperável', async () => {
  const antiga = makeMsg('mensagem que já estava na tela');
  const { coll, records } = await bootHooks({ preloaded: [antiga] });
  coll.revoke(antiga);
  const recs = records();
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].body, 'mensagem que já estava na tela');
});

test('Recover: edição da SUA mensagem guarda o texto anterior ("ei" → "eij")', async () => {
  const { coll, modules, records } = await bootHooks();
  const msg = makeMsg('ei');
  coll.add(msg);
  modules.WAWebDBProcessEditProtocolMsgs.processEditProtocolMsgs([{
    id: { id: 'PROTO' + msg.id.id, remote: CHAT, fromMe: true, _serialized: `true_${CHAT}_PROTO${msg.id.id}` },
    from: msg.from, to: msg.to,
    protocolMessageKey: msg.id,
    body: 'eij',
    type: 'chat',
    subtype: 'message_edit',
  }]);
  const edits = records().filter((r) => r.action === 'edited');
  assert.strictEqual(edits.length, 1);
  assert.strictEqual(edits[0].body, 'eij');
  assert.strictEqual(edits[0].previousContent, 'ei', 'texto anterior não foi guardado');
});

test('Recover: edição busca o texto anterior no Store quando o cache não tem', async () => {
  const { coll, modules, records } = await bootHooks();
  const msg = makeMsg('olá');
  coll.put(msg); // está no Store, mas nunca passou pelo cache
  modules.WAWebDBProcessEditProtocolMsgs.processEditProtocolMsgs([{
    id: { id: 'PROTO' + msg.id.id, remote: CHAT, fromMe: true, _serialized: `true_${CHAT}_PROTO${msg.id.id}` },
    from: msg.from, to: msg.to,
    protocolMessageKey: msg.id,
    body: 'olá, tudo bem?',
    type: 'chat',
    subtype: 'message_edit',
  }]);
  const edit = records().find((r) => r.action === 'edited');
  assert.ok(edit, 'edição não registrada');
  assert.strictEqual(edit.previousContent, 'olá');
});

test('Recover: sem o conteúdo, registra o evento sem fingir que era mídia', async () => {
  const { coll, records } = await bootHooks();
  const desconhecida = makeMsg('');
  desconhecida.type = 'revoked'; // chega já sem conteúdo e nunca esteve no cache
  coll.put(desconhecida);
  coll.emit('change:type', desconhecida, 'revoked');
  const r = records()[0];
  assert.ok(r, 'a exclusão deveria ser registrada mesmo sem conteúdo');
  assert.strictEqual(r.contentCaptured, false);
  assert.ok(!/mídia ou sticker/i.test(r.body), 'rótulo não pode afirmar que era mídia');
  assert.ok(!['image', 'video', 'audio', 'sticker', 'document'].includes(r.type));
});

test('Recover: sem duplicatas e sem registros falsos de revogações antigas', async () => {
  const { coll, records } = await bootHooks();
  const msg = makeMsg('duplicada?');
  coll.add(msg);
  coll.revoke(msg);
  coll.emit('change:type', msg, 'revoked'); // mesmo evento de novo
  assert.strictEqual(records().length, 1, 'revogação duplicada');

  // Abrir um chat "adiciona" mensagens revogadas há dias: não estão no cache,
  // então não podem virar um registro com o horário de agora.
  const antigaRevogada = makeMsg('');
  antigaRevogada.type = 'revoked';
  coll.add(antigaRevogada);
  assert.strictEqual(records().length, 1, 'revogação antiga virou registro falso');
});

test('Recover: "apagar para mim" registra só mensagens novas (não a limpeza de memória)', async () => {
  const { coll, records } = await bootHooks();
  const despejada = makeMsg('saiu da memória');
  despejada.isNewMsg = false;
  coll.add(despejada);
  coll.remove(despejada);
  assert.strictEqual(records().length, 0, 'remoção por memória virou "apagada"');

  const apagada = makeMsg('apaguei pra mim');
  apagada.isNewMsg = true;
  coll.add(apagada);
  coll.remove(apagada);
  const r = records()[0];
  assert.ok(r, '"apagar para mim" não registrado');
  assert.strictEqual(r.action, 'deleted');
  assert.strictEqual(r.body, 'apaguei pra mim');
});

test('Recover: content/wpp-hooks.js está em sincronia com wpp-hooks-parts (rode o build)', () => {
  // Mesmo formato que build.js gera.
  const parts = fs.readdirSync(PARTS_DIR).filter((f) => f.endsWith('.js') && !f.startsWith('._')).sort();
  let expected = `/**
 * wpp-hooks.js — concatenado de wpp-hooks-parts/*.js (gerado por build.js).
 * Não editar; mexa nos arquivos em content/wpp-hooks-parts/ e re-build.
 */
console.log('[WHL WPP Hooks] carregando');
`;
  for (const p of parts) {
    expected += `\n// ─── BEGIN ${p} ───\n` + fs.readFileSync(path.join(PARTS_DIR, p), 'utf8') + `\n// ─── END ${p} ───\n`;
  }
  assert.ok(fs.readFileSync(HOOKS_FILE, 'utf8') === expected,
    'content/wpp-hooks.js desatualizado em relação a content/wpp-hooks-parts — rode `npm run build` na extensão');
});


// ─── Mídia apagada: imagem, vídeo, áudio, figurinha, documento ───────────────

// Arquivos falsos (bytes reais conhecidos) e o "CDN" do WhatsApp simulado.
const FILES = {
  '/v/t62/foto.enc': { bytes: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]), mime: 'image/jpeg' },
  '/v/t62/audio.enc': { bytes: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(2000, 3)]), mime: 'audio/ogg; codecs=opus' },
  '/v/t62/video.enc': { bytes: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(5000, 1)]), mime: 'video/mp4' },
  '/v/t62/doc.enc': { bytes: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(4000, 2)]), mime: 'application/pdf' },
  '/v/t62/fig.enc': { bytes: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP'), Buffer.alloc(1500, 5)]), mime: 'image/webp' },
};
const THUMB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(300, 9)]).toString('base64'); // "/9j/..."

function fakeDownloadManager({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async downloadAndMaybeDecrypt(args) {
      calls.push(args);
      const f = FILES[args.directPath];
      if (fail || !f || !args.mediaKey) throw Object.assign(new Error('media not found (404)'), { status: 404 });
      const u8 = new Uint8Array(f.bytes);
      return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    },
  };
}

function makeMediaMsg(type, directPath, { caption, fromMe = false, size, filename } = {}) {
  const m = makeMsg('', { fromMe, type });
  const f = FILES[directPath];
  // WhatsApp Web: em imagem/vídeo o body é a MINIATURA (base64); o texto é a legenda.
  m.body = ['image', 'video'].includes(type) ? THUMB : '';
  if (caption) m.caption = caption;
  m.mimetype = f.mime;
  m.directPath = directPath;
  m.mediaKey = 'bWVkaWFLZXk' + directPath.length;
  m.mediaKeyTimestamp = 1762586000;
  m.filehash = 'ZmlsZWhhc2g=';
  m.encFilehash = 'ZW5jRmlsZWhhc2g=';
  m.size = size || f.bytes.length;
  if (filename) m.filename = filename;
  return m;
}

const dataUrlOf = (path) => `data:${FILES[path].mime};base64,${FILES[path].bytes.toString('base64')}`;

async function waitFor(fn, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
  return fn();
}

test('Recover mídia: imagem apagada guarda a legenda (não a miniatura) e o arquivo ORIGINAL', async () => {
  const dm = fakeDownloadManager();
  const { coll, records } = await bootHooks({ downloadManager: dm });
  const img = makeMediaMsg('image', '/v/t62/foto.enc', { caption: 'foto do contrato' });
  coll.add(img);
  await waitFor(() => dm.calls.length); // download antecipado (mensagem nova)
  await new Promise((r) => setTimeout(r, 30));
  coll.revoke(img);
  const r = records()[0];
  assert.ok(r, 'imagem apagada não registrada');
  assert.strictEqual(r.body, 'foto do contrato', 'o texto deve ser a legenda, não o base64 da miniatura');
  assert.strictEqual(r.mediaData, dataUrlOf('/v/t62/foto.enc'), 'deveria trazer a imagem original baixada');
  assert.strictEqual(r.mediaIsThumbnail, false);
  assert.strictEqual(r.contentCaptured, true);
  assert.strictEqual(r.mediaType, 'image');
});

test('Recover mídia: áudio já aberto (pré-carga) é baixado na hora em que é apagado', async () => {
  const dm = fakeDownloadManager();
  const audio = makeMediaMsg('ptt', '/v/t62/audio.enc');
  const { coll, records, mediaReady } = await bootHooks({ preloaded: [audio], downloadManager: dm });
  assert.strictEqual(dm.calls.length, 0, 'a pré-carga não deve baixar nada');
  coll.revoke(audio); // o modelo perde directPath/mediaKey aqui
  const r = records()[0];
  assert.ok(r, 'áudio apagado não registrado');
  assert.strictEqual(r.mediaType, 'ptt');
  assert.strictEqual(r.contentCaptured, true);
  const ready = await waitFor(() => mediaReady()[0]);
  assert.ok(ready, 'o áudio original não foi entregue (WHL_RECOVER_MEDIA_READY)');
  assert.strictEqual(ready.id, audio.id.id);
  assert.strictEqual(ready.mediaData, dataUrlOf('/v/t62/audio.enc'));
  // baixado com os campos guardados ANTES da revogação
  assert.strictEqual(dm.calls[0].directPath, '/v/t62/audio.enc');
  assert.strictEqual(dm.calls[0].type, 'ptt');
  assert.ok(dm.calls[0].mediaKey, 'mediaKey do cache não foi usado');
});

test('Recover mídia: vídeo grande não é baixado antes; ao apagar, miniatura na hora e original depois', async () => {
  const dm = fakeDownloadManager();
  const { coll, records, mediaReady } = await bootHooks({ downloadManager: dm });
  const video = makeMediaMsg('video', '/v/t62/video.enc', { caption: 'olha isso', size: 50 * 1024 * 1024 });
  coll.add(video);
  await new Promise((r) => setTimeout(r, 200));
  assert.strictEqual(dm.calls.length, 0, 'vídeo de 50MB não deveria ser baixado antecipadamente');
  coll.revoke(video);
  const r = records()[0];
  assert.strictEqual(r.body, 'olha isso');
  assert.strictEqual(r.mediaIsThumbnail, true, 'enquanto o original não chega, vai a miniatura');
  assert.ok(String(r.mediaData).startsWith('/9j/'));
  const ready = await waitFor(() => mediaReady()[0]);
  assert.ok(ready, 'vídeo original não entregue');
  assert.strictEqual(ready.mediaData, dataUrlOf('/v/t62/video.enc'));
});

test('Recover mídia: documento e figurinha "apagados para mim" trazem o arquivo e o nome', async () => {
  const dm = fakeDownloadManager();
  const { coll, records, mediaReady } = await bootHooks({ downloadManager: dm });
  const doc = makeMediaMsg('document', '/v/t62/doc.enc', { filename: 'contrato.pdf' });
  doc.isNewMsg = true;
  const fig = makeMediaMsg('sticker', '/v/t62/fig.enc');
  fig.isNewMsg = true;
  coll.put(doc); coll.put(fig); // já na tela (sem download antecipado)
  coll.remove(doc);
  coll.remove(fig);
  const recs = records();
  assert.strictEqual(recs.length, 2);
  const rDoc = recs.find((x) => x.id === doc.id.id);
  assert.strictEqual(rDoc.action, 'deleted');
  assert.strictEqual(rDoc.filename, 'contrato.pdf');
  assert.strictEqual(rDoc.mimetype, 'application/pdf');
  assert.ok(!/mensagem sem texto/i.test(rDoc.body), 'documento não é "mensagem sem texto"');
  const readyDoc = await waitFor(() => mediaReady().find((x) => x.id === doc.id.id));
  assert.ok(readyDoc, 'PDF não entregue');
  assert.strictEqual(readyDoc.mediaData, dataUrlOf('/v/t62/doc.enc'));
  const readyFig = await waitFor(() => mediaReady().find((x) => x.id === fig.id.id));
  assert.ok(readyFig, 'figurinha não entregue');
  assert.strictEqual(readyFig.mediaData, dataUrlOf('/v/t62/fig.enc'));
});

test('Recover mídia: falha no download não quebra o registro (fica a mídia identificada)', async () => {
  const dm = fakeDownloadManager({ fail: true });
  const { coll, records, mediaReady } = await bootHooks({ downloadManager: dm });
  const audio = makeMediaMsg('audio', '/v/t62/audio.enc');
  coll.add(audio); // download antecipado falha…
  await waitFor(() => dm.calls.length);
  coll.revoke(audio); // …e o da hora da exclusão também
  const r = records()[0];
  assert.ok(r, 'registro não pode depender do download');
  assert.strictEqual(r.mediaType, 'audio');
  assert.strictEqual(r.contentCaptured, true);
  await new Promise((res) => setTimeout(res, 150));
  assert.strictEqual(mediaReady().length, 0);
});


// ─── Mensagem apagada que já estava na tela ─────────────────────────────────

test('Recover: apagada sem cache usa o texto do balão na tela (antes de o WhatsApp redesenhar)', async () => {
  const msg = makeMsg('');
  const dom = { [msg.id._serialized]: 'oi, tudo certo?' };
  const { coll, records } = await bootHooks({ dom });
  msg.body = 'oi, tudo certo?';
  coll.put(msg); // carregada sem 'add' e depois da pré-carga: não está no cache
  coll.revoke(msg);
  const r = records()[0];
  assert.ok(r, 'exclusão não registrada');
  assert.strictEqual(r.body, 'oi, tudo certo?', 'deveria usar o texto que estava no balão');
  assert.strictEqual(r.contentCaptured, true);
  assert.strictEqual(r.originalTimestamp, T_0717 * 1000);
});

test('Recover: conversa aberta entra no cache mesmo quando o WhatsApp carrega sem "add"', async () => {
  const msg = makeMsg('mensagem antiga da conversa');
  const activeChat = { active: true, msgs: { getModelsArray: () => [msg] } };
  const { coll, records, sweepActiveChat } = await bootHooks({ activeChat });
  coll.put(msg); // chegou silenciosamente, depois da pré-carga
  sweepActiveChat();
  coll.revoke(msg);
  const r = records()[0];
  assert.ok(r);
  assert.strictEqual(r.body, 'mensagem antiga da conversa');
});

test('Recover: mensagem ANTIGA carregada ao abrir o chat não aciona o piloto automático', async () => {
  const { coll, records, received } = await bootHooks();
  const antiga = makeMsg('pergunta de ontem', { fromMe: false });
  antiga.isNewMsg = false; // histórico carregado
  coll.add(antiga);
  assert.strictEqual(received().length, 0, 'mensagem antiga virou "mensagem recebida" (dispara o Copiloto)');
  coll.revoke(antiga);
  assert.strictEqual(records()[0].body, 'pergunta de ontem', 'mas o conteúdo precisa ficar no cache');

  const nova = makeMsg('pergunta agora', { fromMe: false });
  nova.isNewMsg = true;
  coll.add(nova);
  assert.strictEqual(received().length, 1, 'mensagem nova deve continuar avisando o Copiloto');
});


// ─── Mídia apagada sem cache: tela, modelo e atributos anteriores ───────────

test('Recover mídia: sem cache, o balão na tela diz que era documento (nome) e o modelo ainda baixa', async () => {
  const dm = fakeDownloadManager();
  const doc = makeMediaMsg('document', '/v/t62/doc.enc', { filename: 'proposta.pdf' });
  const dom = { [doc.id._serialized]: { icon: 'document-PDF-icon', titles: ['proposta.pdf'] } };
  const { coll, records, mediaReady } = await bootHooks({ downloadManager: dm, dom });
  coll.put(doc); // nunca passou pelo cache
  // revogação que troca só type/body: os campos de mídia continuam no modelo
  doc.type = 'revoked'; doc.body = '';
  coll.emit('change:type', doc, 'revoked');
  const r = records()[0];
  assert.ok(r, 'exclusão não registrada');
  assert.strictEqual(r.mediaType, 'document', 'o tipo deveria vir da tela/modelo');
  assert.strictEqual(r.filename, 'proposta.pdf');
  assert.strictEqual(r.contentCaptured, true);
  const ready = await waitFor(() => mediaReady()[0]);
  assert.ok(ready, 'o modelo ainda tinha directPath/mediaKey: deveria baixar o PDF');
  assert.strictEqual(ready.mediaData, dataUrlOf('/v/t62/doc.enc'));
});

test('Recover mídia: sem cache, o arquivo que o modelo tem em memória (mediaBlob) é recuperado', async () => {
  const audioBytes = FILES['/v/t62/audio.enc'].bytes;
  const ptt = makeMsg('', { fromMe: false, type: 'ptt' });
  ptt.mimetype = 'audio/ogg; codecs=opus';
  ptt.mediaData = { mediaBlob: { forceToBlob: () => new Blob([audioBytes], { type: 'audio/ogg' }) } };
  const dom = { [ptt.id._serialized]: { icon: 'audio-play' } };
  const { coll, records, mediaReady } = await bootHooks({ dom });
  coll.put(ptt);
  ptt.type = 'revoked'; ptt.body = '';
  coll.emit('change:type', ptt, 'revoked');
  const r = records()[0];
  assert.ok(r);
  assert.strictEqual(r.mediaType, 'audio');
  const ready = await waitFor(() => mediaReady()[0]);
  assert.ok(ready, 'áudio em memória não foi recuperado');
  assert.strictEqual(ready.mediaData, 'data:audio/ogg;base64,' + audioBytes.toString('base64'));
});

test('Recover mídia: sem cache, atributos anteriores do modelo trazem legenda e dados para baixar', async () => {
  const dm = fakeDownloadManager();
  const { coll, records, mediaReady } = await bootHooks({ downloadManager: dm });
  const img = makeMediaMsg('image', '/v/t62/foto.enc', { caption: 'nota fiscal' });
  const before = { ...img }; // atributos de antes da troca para 'revoked'
  coll.put(img); // nunca passou pelo cache
  // A revogação limpa o modelo, que ainda expõe os atributos anteriores (Backbone).
  img.type = 'revoked'; img.body = ''; img.caption = undefined;
  img.directPath = undefined; img.mediaKey = undefined; img.mimetype = undefined;
  img.previousAttributes = () => before;
  coll.emit('change:type', img, 'revoked');
  const r = records()[0];
  assert.ok(r, 'exclusão não registrada');
  assert.strictEqual(r.body, 'nota fiscal');
  assert.strictEqual(r.mediaType, 'image');
  const ready = await waitFor(() => mediaReady()[0]);
  assert.ok(ready, 'deveria baixar a foto com os dados de antes da revogação');
  assert.strictEqual(ready.mediaData, dataUrlOf('/v/t62/foto.enc'));
});

test('Recover: diagnóstico WHL_RecoverDiag mostra de onde veio o conteúdo de cada exclusão', async () => {
  const msg = makeMsg('');
  const dom = { [msg.id._serialized]: 'texto da tela' };
  const { coll, sandbox } = await bootHooks({ dom });
  coll.put(msg);
  coll.revoke(msg);
  const d = sandbox.WHL_RecoverDiag();
  assert.strictEqual(d.colecaoDeMensagens, true);
  const last = d.ultimasExclusoes[d.ultimasExclusoes.length - 1];
  assert.ok(last, 'exclusão não apareceu no diagnóstico');
  assert.match(last.fontes, /tela/);
  assert.strictEqual(last.texto, true);
});

// ─── Formato do WhatsApp atual (diagnóstico real, v9.6.4) ───────────────────

test('Recover: balão com data-id só com o id da mensagem (WhatsApp atual) é lido na exclusão', async () => {
  const msg = makeMsg('');
  const dom = { [msg.id.id]: 'teste diag' }; // data-id="3EB0…", não "true_<chat>_<id>"
  const { coll, records } = await bootHooks({ dom });
  coll.put(msg);
  coll.revoke(msg);
  const r = records()[0];
  assert.ok(r);
  assert.strictEqual(r.body, 'teste diag');
  assert.strictEqual(r.contentCaptured, true);
});

test('Recover: mensagem que entrou VAZIA no cache é atualizada pela varredura antes de ser apagada', async () => {
  const { coll, records, sweepActiveChat } = await bootHooks();
  const msg = makeMsg(''); // a mensagem enviada entra na coleção antes do texto
  coll.add(msg);
  msg.body = 'texto preenchido depois';
  sweepActiveChat(); // varredura periódica (coleção geral)
  coll.revoke(msg);
  const r = records()[0];
  assert.ok(r);
  assert.strictEqual(r.body, 'texto preenchido depois', 'cache vazio não foi atualizado');
});

test('Recover: SUA edição segue para o WhatsApp gravar (com "Antes/Editada para"), como a do contato', async () => {
  const { coll, modules, records } = await bootHooks();
  const msg = makeMsg('oi');
  coll.add(msg);
  const edit = {
    id: { id: 'PROTO' + msg.id.id, remote: CHAT, fromMe: true, _serialized: `true_${CHAT}_PROTO${msg.id.id}` },
    from: msg.from, to: msg.to, protocolMessageKey: msg.id, body: 'oie', type: 'chat', subtype: 'message_edit',
  };
  // o módulo simulado devolve o que o WhatsApp de fato processaria (e gravaria)
  const applied = modules.WAWebDBProcessEditProtocolMsgs.processEditProtocolMsgs([edit]);
  assert.strictEqual(applied.length, 1, 'a edição foi descartada — o WhatsApp não gravaria o texto novo');
  assert.strictEqual(applied[0].subtype, 'message_edit', 'deixou de ser uma edição');
  assert.ok(applied[0].protocolMessageKey, 'a ligação com a mensagem original foi removida');
  assert.match(applied[0].body, /Antes: oi[\s\S]*Editada para: oie/);
  const r = records().find((x) => x.action === 'edited');
  assert.strictEqual(r.previousContent, 'oi');
  assert.strictEqual(r.body, 'oie', 'o histórico guarda o texto novo sem o marcador');
});
