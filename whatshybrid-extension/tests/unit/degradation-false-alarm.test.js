/**
 * UI-01 — aviso "Alguns recursos estão temporariamente indisponíveis:
 * Analytics, Tarefas. O WhatsApp pode ter atualizado." aparecia SEMPRE.
 *
 * graceful-degradation.js dava os módulos como "desativados" procurando
 * window.Analytics e window.Tasks. O módulo de tarefas se publica como
 * window.TasksModule, e nenhum módulo "Analytics" é carregado no WhatsApp
 * Web (o pacote content não tem modules/analytics.js). Não tinha a ver com
 * atualização do WhatsApp: era alarme falso para todo cliente.
 */
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('../_harness');

const EXT = path.join(__dirname, '../..');
const anything = () => new Proxy(function () {}, { get: (t, p) => (p === 'then' ? undefined : anything()), apply: () => anything() });

function carregar() {
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
    document: { readyState: 'loading', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, createElement: () => anything(), head: anything(), body: anything() },
    chrome: anything(), localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    addEventListener() {}, MutationObserver: class { observe() {} disconnect() {} },
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  vm.createContext(sandbox);
  // mesma ordem do pacote content (build-manifest.json): degradação antes, tarefas depois
  for (const f of ['modules/graceful-degradation.js', 'modules/tasks.js']) {
    vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), sandbox, { filename: f });
  }
  return sandbox.GracefulDegradation;
}

test('UI-01: com o módulo de tarefas carregado, "Tarefas" não é dado como indisponível', () => {
  const gd = carregar();
  assert.notStrictEqual(gd.checkModule('tasks').status, 'disabled', JSON.stringify(gd.checkModule('tasks')));
});

test('UI-01: "Analytics" (módulo que não existe no WhatsApp Web) não gera aviso', () => {
  const gd = carregar();
  const r = gd.checkModule('analytics');
  assert.ok(r.status !== 'disabled', `analytics: ${JSON.stringify(r)}`);
});
