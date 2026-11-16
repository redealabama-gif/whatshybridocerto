/**
 * WA-06 — dedupe do histórico do Recover.
 *
 * Caso real: o dono apagou um áudio e uma imagem na mesma conversa, no mesmo
 * segundo. Os dois foram salvos inteiros (29 KB e 98 KB, tamanhos dos
 * originais), mas só o áudio apareceu na lista.
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { dedupRecoverHistory, chaveDe } = require('../../utils/recover-dedup.js');

// Os dois registros exatamente como vieram do aparelho do dono.
const AUDIO = {
  id: 'A1B2C3AUDIO', from: '553287250715', to: '559284891875', body: '',
  type: 'ptt', action: 'revoked', timestamp: 1763243363000, mimetype: 'audio/ogg',
};
const IMAGEM = {
  id: 'D4E5F6IMAGE', from: '553287250715', to: '559284891875', body: '',
  type: 'image', action: 'revoked', timestamp: 1763243363000, mimetype: 'image/jpeg',
};

/** A chave ANTIGA, para deixar a regressão explícita no próprio teste. */
const chaveAntiga = (h) =>
  `${h.from || ''}_${h.to || ''}_${(h.body || '').substring(0, 50)}_${Math.floor((h.timestamp || 0) / 5000)}`;

test('WA-06 (o defeito): a chave antiga era IGUAL para o áudio e a imagem', () => {
  assert.strictEqual(
    chaveAntiga(AUDIO),
    chaveAntiga(IMAGEM),
    'se estas chaves fossem diferentes, o defeito relatado não existiria'
  );
});

test('WA-06: áudio e imagem apagados no mesmo segundo aparecem os DOIS', () => {
  const vistos = dedupRecoverHistory([AUDIO, IMAGEM]);
  assert.strictEqual(vistos.length, 2, 'a imagem continuou sendo descartada como duplicata');
  assert.deepStrictEqual(vistos.map((m) => m.type), ['ptt', 'image']);
});

test('WA-06: duplicata de verdade (mesmo id, dois caminhos de captura) some', () => {
  const vistos = dedupRecoverHistory([AUDIO, { ...AUDIO, origem: 'dom' }, IMAGEM]);
  assert.strictEqual(vistos.length, 2);
});

test('WA-06: sem id, a heurística separa por tipo e ação', () => {
  const base = { from: '5511', to: '5522', body: '', timestamp: 1763243363000 };
  const lista = [
    { ...base, type: 'ptt', action: 'revoked' },
    { ...base, type: 'image', action: 'revoked' },
    { ...base, type: 'image', action: 'deleted' },
    { ...base, type: 'image', action: 'revoked' }, // esta sim é duplicata
  ];
  assert.strictEqual(dedupRecoverHistory(lista).length, 3);
});

test('WA-06: duas mensagens de texto iguais no mesmo segundo ainda contam como uma', () => {
  const base = { from: '5511', to: '5522', body: 'oi', type: 'chat', action: 'revoked', timestamp: 1763243363000 };
  assert.strictEqual(dedupRecoverHistory([base, { ...base }]).length, 1);
});

test('WA-06: o id manda sobre a heurística', () => {
  assert.strictEqual(chaveDe(AUDIO), 'id:A1B2C3AUDIO');
  assert.notStrictEqual(chaveDe(AUDIO), chaveDe(IMAGEM));
});

test('WA-06: lista vazia ou nula não quebra', () => {
  assert.deepStrictEqual(dedupRecoverHistory(null), []);
  assert.deepStrictEqual(dedupRecoverHistory([]), []);
});
