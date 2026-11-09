/**
 * IA-04 (extensão) — o autopilot respeita o kill switch.
 *
 *  1. Backend responde 503 KILL_SWITCH → não cai no fallback de IA local e o
 *     autopilot para (antes: gerava resposta local e seguia rodando).
 *  2. Módulo KillSwitch com "autopilot" desligado → start() recusa.
 *  3. Kill switch ligado com o autopilot já rodando → para antes de responder.
 */
const assert = require('node:assert');
const { test } = require('../_harness');
const { makeEnv, loadAutopilot, incoming, waitFor, FAST } = require('./_autopilot-env');

function killSwitchError() {
  const e = new Error('Recurso desativado temporariamente pelo administrador.');
  e.status = 503;
  e.code = 'KILL_SWITCH';
  e.body = { success: false, error: 'kill_switch', code: 'KILL_SWITCH', feature: 'ai' };
  return e;
}

test('IA-04: 503 KILL_SWITCH do backend → sem fallback local, autopilot para', async () => {
  const env = makeEnv({ process: async () => { throw killSwitchError(); } });
  let localCalls = 0;
  env.window.CopilotEngine = {
    analyzeMessage: async () => ({}),
    generateResponse: async () => { localCalls++; return { content: 'Resposta da IA local.' }; },
  };
  const AP = loadAutopilot(env);
  try {
    AP.setConfig(FAST);
    await AP.start();
    env.window.EventBus.emit('message:received', incoming('5511900000021', 'Qual o horário de vocês?'));
    await waitFor(() => env.stateRef.backendCalls.length > 0 && !AP.isRunning(), 8000);
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(env.stateRef.sendLog.length, 0, 'não pode enviar');
    assert.strictEqual(localCalls, 0, `usou a IA local ${localCalls}x com o kill switch ligado`);
    assert.strictEqual(AP.isRunning(), false, 'o autopilot deveria ter parado');
  } finally { env.restore(); }
});

test('IA-04: KillSwitch com "autopilot" desligado → start() recusa', async () => {
  const env = makeEnv({});
  env.window.KillSwitch = { isFeatureDisabled: (f) => f === 'autopilot' };
  const AP = loadAutopilot(env);
  try {
    const r = await AP.start();
    assert.strictEqual(AP.isRunning(), false, 'não deveria iniciar');
    assert.strictEqual(r && r.reason, 'kill_switch');
  } finally { env.restore(); }
});

test('IA-04: kill switch ligado com o autopilot rodando → para sem responder', async () => {
  const env = makeEnv({});
  let killed = false;
  env.window.KillSwitch = { isFeatureDisabled: (f) => killed && (f === 'autopilot' || f === 'ai') };
  const AP = loadAutopilot(env);
  try {
    AP.setConfig(FAST);
    await AP.start();
    assert.ok(AP.isRunning());
    killed = true;
    env.window.EventBus.emit('message:received', incoming('5511900000022', 'Bom dia'));
    await waitFor(() => !AP.isRunning(), 5000);
    await new Promise((r) => setTimeout(r, 500));
    assert.strictEqual(env.stateRef.sendLog.length, 0, `enviou com o kill switch ligado: ${JSON.stringify(env.stateRef.sendLog)}`);
    assert.strictEqual(env.stateRef.backendCalls.length, 0, 'nem deveria chamar o backend');
    assert.strictEqual(AP.isRunning(), false, 'o autopilot deveria ter parado');
  } finally { env.restore(); }
});

test('IA-04: módulo kill-switch.js real lê o status do backend e para o autopilot', async () => {
  const path = require('path');
  const MODULE = path.join(__dirname, '../../modules/kill-switch.js');
  delete require.cache[require.resolve(MODULE)];
  const prev = { window: global.window, document: global.document, chrome: global.chrome };
  let stopped = 0;
  const calls = [];
  global.window = {
    BackendClient: { get: async (ep) => { calls.push(ep); return { success: true, killSwitch: { autopilot: true, ai: false } }; } },
    AutopilotV2: { stop: () => { stopped++; } },
  };
  global.document = { readyState: 'complete', addEventListener: () => {} };
  global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  try {
    require(MODULE);
    await waitFor(() => stopped > 0, 3000);
    const KS = global.window.KillSwitch;
    assert.ok(KS, 'window.KillSwitch não foi definido');
    assert.deepStrictEqual(calls, ['/api/v1/admin/kill-switch/status']);
    assert.strictEqual(KS.isFeatureDisabled('autopilot'), true);
    assert.strictEqual(stopped, 1, 'deveria ter parado o autopilot');
    try { KS.stop(); } catch (_) {}
  } finally {
    global.window = prev.window; global.document = prev.document; global.chrome = prev.chrome;
  }
});
