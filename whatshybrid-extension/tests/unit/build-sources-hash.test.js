/**
 * Testes do guard de bundle desatualizado (funções puras de hash da fonte).
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const bsh = require('../../scripts/build-sources-hash.js');

test('sourceFiles(): lista ordenada, com wpp-hooks-parts e SEM o wpp-hooks.js gerado', () => {
  const files = bsh.sourceFiles();
  assert.ok(Array.isArray(files) && files.length > 0, 'lista vazia');
  assert.deepStrictEqual(files, [...files].sort(), 'não está ordenada');
  assert.ok(files.some((f) => f.startsWith('content/wpp-hooks-parts/')), 'faltou wpp-hooks-parts');
  assert.ok(!files.includes('content/wpp-hooks.js'), 'não devia incluir o wpp-hooks.js gerado');
});

test('compute(): sha256 (64 hex) + fileCount > 0 e determinístico', () => {
  const a = bsh.compute();
  assert.match(a.sha256, /^[0-9a-f]{64}$/, 'sha256 fora do formato');
  assert.ok(a.fileCount > 0, 'fileCount deveria ser > 0');
  const b = bsh.compute();
  assert.strictEqual(a.sha256, b.sha256, 'compute não é determinístico');
  assert.strictEqual(a.fileCount, b.fileCount);
});
