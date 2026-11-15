/**
 * LGP-01 — o servidor padrão da extensão não pode ser localhost quando ela é
 * instalada pela Chrome Web Store.
 *
 * Antes: BACKEND_DEFAULT era SEMPRE 'http://localhost:3000' (com um "TODO:
 * trocar antes de publicar"). Um cliente que instalasse da loja e não mexesse
 * em nada ficava apontado para a PRÓPRIA máquina — sem servidor — e login, IA
 * e sincronização falhavam.
 *
 * Regra: instalada pela loja (o manifesto ganha `update_url`) → servidor de
 * produção (https, trocável por WHL_BACKEND_PRODUCTION); carregada sem
 * compactar (desenvolvimento) → localhost.
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

const MODULO = path.join(__dirname, '../../constants/endpoints.js');

function carregar({ daLoja, override } = {}) {
  const anterior = { chrome: global.chrome, WHL_ENDPOINTS: global.WHL_ENDPOINTS, WHL_BACKEND_PRODUCTION: global.WHL_BACKEND_PRODUCTION, window: global.window };
  delete global.window; // força o caminho globalThis (service worker)
  global.WHL_ENDPOINTS = undefined;
  global.WHL_BACKEND_PRODUCTION = override;
  global.chrome = { runtime: { getManifest: () => (daLoja ? { update_url: 'https://clients2.google.com/service/update2/crx' } : {}) } };
  delete require.cache[require.resolve(MODULO)];
  require(MODULO);
  const r = global.WHL_ENDPOINTS;
  const restaurar = () => { global.chrome = anterior.chrome; global.WHL_ENDPOINTS = anterior.WHL_ENDPOINTS; global.WHL_BACKEND_PRODUCTION = anterior.WHL_BACKEND_PRODUCTION; if (anterior.window) global.window = anterior.window; };
  return { endpoints: r, restaurar };
}

test('LGP-01: instalada pela Chrome Web Store NÃO aponta para localhost', () => {
  const { endpoints, restaurar } = carregar({ daLoja: true });
  try {
    assert.ok(!/localhost|127\.0\.0\.1/.test(endpoints.BACKEND_DEFAULT), `apontou para a máquina do cliente: ${endpoints.BACKEND_DEFAULT}`);
    assert.ok(endpoints.BACKEND_DEFAULT.startsWith('https://'), `precisa ser https: ${endpoints.BACKEND_DEFAULT}`);
    assert.ok(!endpoints.BACKEND_FALLBACKS.some((u) => /localhost|127\.0\.0\.1/.test(u)), JSON.stringify(endpoints.BACKEND_FALLBACKS));
  } finally { restaurar(); }
});

test('LGP-01: carregada sem compactar (desenvolvimento) continua no localhost', () => {
  const { endpoints, restaurar } = carregar({ daLoja: false });
  try {
    assert.strictEqual(endpoints.BACKEND_DEFAULT, 'http://localhost:3000');
  } finally { restaurar(); }
});

test('LGP-01: o dono troca o servidor de produção com WHL_BACKEND_PRODUCTION', () => {
  const { endpoints, restaurar } = carregar({ daLoja: true, override: 'https://api.meudominio.com.br' });
  try {
    assert.strictEqual(endpoints.BACKEND_DEFAULT, 'https://api.meudominio.com.br');
    assert.deepStrictEqual(endpoints.BACKEND_FALLBACKS, ['https://api.meudominio.com.br']);
  } finally { restaurar(); }
});
