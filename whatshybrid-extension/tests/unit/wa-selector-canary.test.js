/**
 * Testes do canário de seletores (funções puras + checkOne com stub de DOM).
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const canary = require('../../scripts/wa-selector-canary.js');

test('SELECTORS: 10 chaves bem-formadas (primary string + fallbacks array + description)', () => {
  const keys = Object.keys(canary.SELECTORS);
  assert.strictEqual(keys.length, 10, 'esperava 10 seletores, veio ' + keys.length);
  for (const k of keys) {
    const d = canary.SELECTORS[k];
    assert.ok(typeof d.primary === 'string' && d.primary.length, k + ': primary inválido');
    assert.ok(Array.isArray(d.fallbacks) && d.fallbacks.length, k + ': fallbacks vazio');
    assert.ok(typeof d.description === 'string' && d.description.length, k + ': description ausente');
  }
});

const SAMPLE = `
  const SELECTORS = {
    MAIN_CHAT: {
      primary: 'div[data-tab="1"]',
      fallbacks: ['#main', 'div[role="main"]'],
      description: 'Container principal'
    },
    MESSAGE_INPUT: {
      primary: 'div[contenteditable="true"][data-tab="10"]',
      fallbacks: ['div[contenteditable="true"][data-tab="6"]', 'div[role="textbox"]'],
      description: 'Campo de digitação'
    }
  };
`;

test('_extractSelectorsFromSource: parseia chaves/primary/fallbacks (robusto a [ ] e " internos)', () => {
  const got = canary._extractSelectorsFromSource(SAMPLE);
  assert.deepStrictEqual(Object.keys(got).sort(), ['MAIN_CHAT', 'MESSAGE_INPUT']);
  assert.strictEqual(got.MAIN_CHAT.primary, 'div[data-tab="1"]');
  assert.deepStrictEqual(got.MAIN_CHAT.fallbacks, ['#main', 'div[role="main"]']);
  // fallback com ] e " por dentro tem que vir inteiro:
  assert.strictEqual(got.MESSAGE_INPUT.fallbacks[0], 'div[contenteditable="true"][data-tab="6"]');
});

test('_extractSelectorsFromSource: retorna {} sem bloco SELECTORS', () => {
  assert.deepStrictEqual(canary._extractSelectorsFromSource('const x = 1;'), {});
});

test('_diffSelectors: idênticos → []', () => {
  const a = { K: { primary: 'p', fallbacks: ['a', 'b'] } };
  const b = { K: { primary: 'p', fallbacks: ['a', 'b'] } };
  assert.deepStrictEqual(canary._diffSelectors(a, b), []);
});

test('_diffSelectors: pega primary divergente, fallback divergente e chave faltando', () => {
  const embedded = {
    A: { primary: 'p1', fallbacks: ['x'] },
    B: { primary: 'p2', fallbacks: ['y'] },
    C: { primary: 'p3', fallbacks: ['z'] }, // só no canário
  };
  const source = {
    A: { primary: 'p1-MUDOU', fallbacks: ['x'] },
    B: { primary: 'p2', fallbacks: ['y', 'NOVO'] },
  };
  const issues = canary._diffSelectors(embedded, source);
  assert.ok(issues.length >= 3, 'esperava ≥3 issues, veio ' + issues.length);
  assert.ok(issues.some((i) => i.includes('A.primary')), 'faltou A.primary');
  assert.ok(issues.some((i) => i.includes('B.fallbacks')), 'faltou B.fallbacks');
  assert.ok(issues.some((i) => i.includes('"C"')), 'faltou detectar chave C ausente na fonte');
});

test('checkOne: DEGRADED quando só um fallback casa; BROKEN quando nada casa', () => {
  const original = global.document;
  try {
    // "DOM" onde só '#main' existe
    global.document = { querySelector: (sel) => (sel === '#main' ? {} : null) };
    const r1 = canary.checkOne('MAIN_CHAT'); // primary não casa, mas '#main' é fallback
    assert.strictEqual(r1.status, 'DEGRADED');
    assert.strictEqual(r1.matched, '#main');
    const r2 = canary.checkOne('CONNECTION_STATUS'); // nada casa
    assert.strictEqual(r2.status, 'BROKEN');
  } finally {
    global.document = original;
  }
});
