/**
 * Testes do probe de download de mídia (scripts/wa-media-probe.js).
 *
 * O probe é a ferramenta que decide a correção do WA-02 a partir do WhatsApp
 * real. Se ele der veredito errado, a correção sai errada — por isso ele é
 * testado contra um `downloadAndMaybeDecrypt` falso que reproduz a validação
 * real (a mesma do erro visto em produção:
 * "Unexpected mimetype application/octet-stream for media type ptt").
 */
const assert = require('node:assert');
const { test } = require('../_harness');

const PROBE = require.resolve('../../scripts/wa-media-probe.js');

/**
 * Carrega o probe num `window` novo e roda `fn(probe)` COM esse window ainda
 * instalado — o probe lê `window` na hora da chamada, não no carregamento.
 */
async function comJanela(win, fn, doc) {
  const antesW = global.window;
  const antesD = global.document;
  global.window = win;
  global.document = doc || { querySelector: () => null };
  delete require.cache[PROBE];
  try {
    require(PROBE);
    return await fn(global.window.WAMediaProbe);
  } finally {
    global.window = antesW;
    global.document = antesD;
  }
}

/** Imita o WhatsApp: compara o mimetype baixado com o `type` pedido. */
function dmQueValida(registro) {
  return {
    async downloadAndMaybeDecrypt(args) {
      if (registro) registro.push(args);
      const baixado = args.mimetype || 'application/octet-stream';
      const esperado = { ptt: /^audio\//, audio: /^audio\//, image: /^image\//, video: /^video\// }[args.type];
      if (args.type && esperado && !esperado.test(baixado)) {
        throw new Error(`Unexpected mimetype ${baixado} for media type ${args.type}`);
      }
      return new Uint8Array(1024);
    }
  };
}

function janelaComDm(dm) {
  return {
    webpackChunkwhatsapp_web_client: {
      push: () => {
        const r = (n) => (n === 'WAWebDownloadManager' ? { downloadManager: dm } : null);
        r.c = {};
        return r;
      }
    }
  };
}

test('probe: acha o downloadManager pelo webpack e diz por qual caminho', () =>
  comJanela(janelaComDm(dmQueValida()), (probe) => {
    const { dm, via } = probe.getDownloadManager();
    assert.ok(dm, 'não achou o downloadManager');
    assert.match(via, /WAWebDownloadManager/);
  }));

test('probe: sem WhatsApp nenhum, avisa em vez de explodir', () =>
  comJanela({}, async (probe) => {
    const txt = await probe.run();
    assert.match(txt, /BLOQUEIO: nao achei downloadAndMaybeDecrypt/);
  }));

test('probe: camposDeMidia pega o mimetype do modelo e também de dentro de mediaData', () =>
  comJanela(janelaComDm(dmQueValida()), (probe) => {
  const a = probe.camposDeMidia({ type: 'ptt', mimetype: 'audio/ogg; codecs=opus', directPath: '/v/x', mediaKey: 'k' });
  assert.strictEqual(a.mimetype, 'audio/ogg; codecs=opus');
  const b = probe.camposDeMidia({ type: 'image', mediaData: { mimetype: 'image/jpeg' }, directPath: '/v/y', mediaKey: 'k' });
  assert.strictEqual(b.mimetype, 'image/jpeg', 'mimetype dentro de mediaData foi ignorado');
  assert.strictEqual(probe.camposDeMidia(null), null);
  }));

test('probe: a matriz separa a correção (A/B) do bug original (C) para ptt e image', () =>
  comJanela(janelaComDm(dmQueValida()), async (probe) => {
  const dm = dmQueValida();
  for (const campos of [
    { type: 'ptt', mimetype: 'audio/ogg; codecs=opus', directPath: '/v/x', mediaKey: 'k', mediaKeyTimestamp: '1700000000' },
    { type: 'image', mimetype: 'image/jpeg', directPath: '/v/y', mediaKey: 'k', mediaKeyTimestamp: 1700000000 }
  ]) {
    const ok = [];
    const falhou = [];
    for (const [id, , montar] of probe.VARIANTES) {
      try {
        await dm.downloadAndMaybeDecrypt({ directPath: campos.directPath, mediaKey: campos.mediaKey, ...montar(campos) });
        ok.push(id);
      } catch (_) {
        falhou.push(id);
      }
    }
    assert.ok(falhou.includes('C'), campos.type + ': variante C (comportamento antigo) deveria falhar, e passou');
    assert.ok(ok.includes('A'), campos.type + ': variante A (mandar o mimetype real) deveria passar');
    assert.ok(ok.includes('B'), campos.type + ': variante B (sem `type`) deveria passar');
  }
  }));

test('probe: a variante C reproduz LITERALMENTE o erro que o usuário viu', () =>
  comJanela(janelaComDm(dmQueValida()), async (probe) => {
  const dm = dmQueValida();
  const campos = { type: 'ptt', mimetype: 'audio/ogg; codecs=opus', directPath: '/v/x', mediaKey: 'k' };
  const C = probe.VARIANTES.find((v) => v[0] === 'C');
  await assert.rejects(
    () => dm.downloadAndMaybeDecrypt({ directPath: campos.directPath, mediaKey: campos.mediaKey, ...C[2](campos) }),
    /Unexpected mimetype application\/octet-stream for media type ptt/
  );
  }));

test('probe: as 6 variantes estão bem-formadas (id, rótulo e montador)', () =>
  comJanela(janelaComDm(dmQueValida()), (probe) => {
  assert.strictEqual(probe.VARIANTES.length, 6);
  const ids = probe.VARIANTES.map((v) => v[0]);
  assert.deepStrictEqual(ids, ['A', 'B', 'C', 'D', 'E', 'F']);
  for (const [id, rotulo, montar] of probe.VARIANTES) {
    assert.ok(typeof rotulo === 'string' && rotulo.trim().length, id + ': rótulo vazio');
    assert.strictEqual(typeof montar, 'function', id + ': montador não é função');
    assert.strictEqual(typeof montar({ type: 'ptt', mimetype: 'audio/ogg' }), 'object');
  }
  }));
