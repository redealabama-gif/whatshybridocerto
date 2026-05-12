/**
 * Unit tests — OrchestratorRegistry
 *
 * Cobre:
 * - Single instance per tenant (sync get)
 * - LRU eviction quando excede MAX_SIZE
 * - TTL eviction de tenants inativos
 * - Concurrent getAsync (race condition test)
 *
 * Run: node tests/unit/orchestrator-registry.test.js
 */

const assert = require('node:assert/strict');
const Module = require('module');
const orig = Module.prototype.require;

const mockLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
};

let createCount = 0;
const created = [];

class MockOrchestrator {
  constructor(config) {
    this.tenantId = config.tenantId;
    this.id = ++createCount;
    this.config = config;
    created.push(this);
  }
  async init() {
    await new Promise(r => setTimeout(r, 10));
    this.initialized = true;
  }
}

Module.prototype.require = function (id) {
  if (id === '../utils/logger' || id.endsWith('/logger')) return mockLogger;
  if (id === '../ai/AIOrchestrator' || id.endsWith('AIOrchestrator')) {
    return MockOrchestrator;
  }
  return orig.call(this, id);
};

process.env.ORCHESTRATOR_MAX_TENANTS = '3';
process.env.ORCHESTRATOR_TTL_MS = '200';

delete require.cache[require.resolve('../../src/registry/OrchestratorRegistry')];
const registry = require('../../src/registry/OrchestratorRegistry');

function reset() {
  createCount = 0;
  created.length = 0;
  registry._store.clear();
  registry._creating.clear();
}

let passed = 0, failed = 0;

async function test(name, fn) {
  reset();
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

(async () => {
  console.log('\nOrchestratorRegistry — Single Instance');

  await test('get retorna mesma instance pra mesmo tenant', () => {
    const o1 = registry.get('ws-1');
    const o2 = registry.get('ws-1');
    assert.equal(o1, o2, 'mesmo tenant deveria retornar mesma instance');
    assert.equal(createCount, 1);
  });

  await test('get cria instances diferentes pra tenants diferentes', () => {
    const o1 = registry.get('ws-1');
    const o2 = registry.get('ws-2');
    assert.notEqual(o1, o2);
    assert.equal(o1.tenantId, 'ws-1');
    assert.equal(o2.tenantId, 'ws-2');
  });

  console.log('\nOrchestratorRegistry — Concurrent getAsync (Race)');

  await test('getAsync concorrente do mesmo tenant retorna mesma instance', async () => {
    const promises = [
      registry.getAsync('ws-race'),
      registry.getAsync('ws-race'),
      registry.getAsync('ws-race'),
      registry.getAsync('ws-race'),
      registry.getAsync('ws-race'),
    ];
    const results = await Promise.all(promises);
    const first = results[0];
    for (const o of results) assert.equal(o, first);
    assert.equal(createCount, 1, 'apenas 1 orchestrator criado mesmo com 5 calls concorrentes');
  });

  console.log('\nOrchestratorRegistry — LRU Eviction');

  await test('LRU evicta tenant menos usado quando excede MAX_SIZE', () => {
    registry.get('ws-1');
    registry.get('ws-2');
    registry.get('ws-3');
    assert.equal(registry._store.size, 3);

    registry.get('ws-4');
    assert.equal(registry._store.size, 3);
    assert.equal(registry._store.has('ws-1'), false);
    assert.equal(registry._store.has('ws-4'), true);
  });

  await test('Acessar tenant existente atualiza LRU order', () => {
    registry.get('ws-1');
    registry.get('ws-2');
    registry.get('ws-3');

    registry.get('ws-1');  // re-acessa → move pro fim
    registry.get('ws-4');  // adiciona → evicta ws-2 (mais antigo agora)

    assert.equal(registry._store.has('ws-1'), true);
    assert.equal(registry._store.has('ws-2'), false);
  });

  console.log('\nOrchestratorRegistry — TTL Eviction');

  await test('TTL evicta tenants inativos', async () => {
    registry.get('ws-stale');
    assert.equal(registry._store.has('ws-stale'), true);

    await new Promise(r => setTimeout(r, 250));
    registry._evictExpired();

    assert.equal(registry._store.has('ws-stale'), false);
  });

  console.log('\nOrchestratorRegistry — getStats');

  await test('getStats retorna métricas corretas', () => {
    registry.get('ws-1');
    registry.get('ws-2');
    const stats = registry.getStats();
    assert.equal(stats.activeOrchestrators, 2);
    assert.equal(stats.maxSize, 3);
    assert.equal(stats.tenants.length, 2);
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  Module.prototype.require = orig;
  registry.destroy();

  if (failed > 0) process.exit(1);
  else { console.log('✅ All tests passed'); process.exit(0); }
})();
