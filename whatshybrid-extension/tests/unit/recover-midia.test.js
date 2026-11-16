/**
 * WA-05 (2ª metade) — quando vale ir ao WhatsApp procurar o arquivo.
 * Texto não tem arquivo: navegar só abria a conversa errada pelo @lid.
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { ehDeMidia, valeNavegarPorMidia } = require('../../utils/recover-midia.js');

test('WA-05: mensagem de texto editada NÃO manda navegar (caso real do dono)', () => {
  const editada = { id: 'X1', type: 'chat', action: 'edited', body: 'E eu vivia muito', chatId: '244194828361906@lid' };
  assert.strictEqual(ehDeMidia(editada), false);
  assert.strictEqual(
    valeNavegarPorMidia(editada),
    false,
    'ia abrir a conversa pelo @lid e o WhatsApp mostrava "+244 ... não está no WhatsApp"'
  );
});

test('WA-05: áudio e imagem continuam podendo navegar', () => {
  for (const tipo of ['ptt', 'audio', 'image', 'video', 'sticker', 'document']) {
    const m = { id: 'Y', type: tipo, chatId: '5521999@c.us', mediaKey: 'k', directPath: '/v/x' };
    assert.strictEqual(valeNavegarPorMidia(m), true, tipo + ' deixou de poder navegar');
  }
});

test('WA-05: mídia sem nada por onde buscar não navega à toa', () => {
  assert.strictEqual(valeNavegarPorMidia({ type: 'image' }), false);
});

test('WA-05: o mimetype também identifica mídia quando o tipo vem vazio', () => {
  assert.strictEqual(ehDeMidia({ mimetype: 'audio/ogg; codecs=opus' }), true);
  assert.strictEqual(ehDeMidia({ mimetype: 'image/jpeg' }), true);
  assert.strictEqual(ehDeMidia({ mimetype: 'text/plain' }), false);
});

test('WA-05: registro nulo ou vazio não quebra', () => {
  assert.strictEqual(ehDeMidia(null), false);
  assert.strictEqual(valeNavegarPorMidia(undefined), false);
});
