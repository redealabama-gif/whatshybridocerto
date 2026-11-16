/**
 * Testes do classificador do probe de armazenamento.
 *
 * A 1ª versão do probe olhava só a marca `mediaIsThumbnail` e, por isso, relatei
 * ao dono "arquivo completo: 4" para registros de 4 KB que eram miniatura (uma
 * imagem real do mesmo aparelho tem 151 KB). Estes casos usam exatamente os
 * dados que vieram do aparelho dele.
 */
const assert = require('node:assert');
const { test } = require('../_harness');

const PROBE = require.resolve('../../scripts/wa-recover-storage-probe.js');

function carregar() {
  const antes = global.window;
  global.window = {};
  delete require.cache[PROBE];
  try { require(PROBE); return global.window.WARecoverStorage; }
  finally { global.window = antes; }
}

const dados = (kb) => 'data:image/jpeg;base64,' + 'A'.repeat(Math.round((kb * 1024 * 4) / 3));

test('probe storage: 4 KB em imagem é miniatura, mesmo sem a marca (caso real do dono)', () => {
  const { classificar } = carregar();
  const r = classificar({ type: 'image', action: 'deleted', mediaData: dados(4) });
  assert.strictEqual(r.v, 'SO MINIATURA', 'voltou a chamar 4 KB de arquivo completo');
  assert.match(r.motivo, /piso/);
});

test('probe storage: imagem de 151 KB é arquivo completo', () => {
  const { classificar } = carregar();
  assert.strictEqual(classificar({ type: 'image', mediaData: dados(151) }).v, 'ARQUIVO OK');
});

test('probe storage: guardado bem menor que o size original é miniatura', () => {
  const { classificar } = carregar();
  const r = classificar({ type: 'image', size: 151 * 1024, mediaData: dados(30) });
  assert.strictEqual(r.v, 'SO MINIATURA');
  assert.match(r.motivo, /do original/);
});

test('probe storage: a marca mediaIsThumbnail continua valendo', () => {
  const { classificar } = carregar();
  assert.strictEqual(classificar({ type: 'image', mediaIsThumbnail: true, mediaData: dados(151) }).v, 'SO MINIATURA');
});

test('probe storage: registro sem nada e __HAS_MEDIA__ contam como SEM ARQUIVO', () => {
  const { classificar } = carregar();
  assert.strictEqual(classificar({ type: 'ptt', action: 'revoked' }).v, 'SEM ARQUIVO');
  assert.strictEqual(classificar({ type: 'video', mediaData: '__HAS_MEDIA__' }).v, 'SEM ARQUIVO');
});

test('probe storage: áudio tem piso menor (ptt de 12 KB é arquivo, não miniatura)', () => {
  const { classificar } = carregar();
  const r = classificar({ type: 'ptt', size: 12403, mediaData: 'data:audio/ogg;base64,' + 'A'.repeat(Math.round((12 * 1024 * 4) / 3)) });
  assert.strictEqual(r.v, 'ARQUIVO OK', 'áudio real de 12 KB foi tratado como miniatura');
});
