/**
 * Regressão do bug "trocar de persona não muda a resposta".
 *
 * Causa-raiz: o TeamSystem cria um "Usuário Principal" com role 'admin' por
 * padrão; CopilotEngine.getActivePersona() aplicava o mapa role→persona em TODA
 * leitura e devolvia sempre 'professional', ignorando o card que o usuário
 * clicou. Suggestion E autopilot leem getActivePersona() → ambos ficavam presos.
 *
 * O fix: a escolha EXPLÍCITA do usuário (setActivePersona sem {explicit:false})
 * passa na frente da persona-padrão da role.
 *
 * Estes testes carregam o copilot-engine.js REAL (não reimplementam a lógica),
 * com window/chrome stubados e um TeamSystem fake reproduzindo o default admin.
 */
const assert = require('node:assert');
const path = require('path');
const { test } = require('../_harness');

const ENGINE = path.join(__dirname, '../../modules/copilot-engine.js');

// Mapa real (espelha modules/team-system.js:ROLE_PERSONA_MAP).
const ROLE_PERSONA_MAP = {
  admin: 'professional',
  manager: 'professional',
  agent: 'friendly',
  sales: 'sales',
  support: 'support',
};

// Carrega uma instância FRESCA do engine (cache limpo + window/chrome novos).
// Retorna window.CopilotEngine. `teamSystem` injeta o cenário do TeamSystem.
function loadFreshEngine(teamSystem) {
  delete require.cache[require.resolve(ENGINE)];
  const prevWindow = global.window;
  const prevChrome = global.chrome;

  const win = {};
  if (teamSystem) win.TeamSystem = teamSystem;
  global.window = win;
  global.chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
  };

  // Silencia os logs de boot do módulo pra não poluir a saída do runner.
  const origLog = console.log;
  console.log = () => {};
  try {
    require(ENGINE);
  } finally {
    console.log = origLog;
  }

  return {
    CE: win.CopilotEngine,
    restore() {
      global.window = prevWindow;
      global.chrome = prevChrome;
    },
  };
}

// TeamSystem fake reproduzindo o "Usuário Principal" admin criado por padrão.
function teamSystemWithRole(role) {
  return {
    getCurrentUser: () => ({ id: 'default_user', name: 'Usuário Principal', role }),
    ROLE_PERSONA_MAP,
  };
}

test('escolha explícita vence a persona-padrão da role (o bug central)', () => {
  const { CE, restore } = loadFreshEngine(teamSystemWithRole('admin'));
  try {
    // Antes de escolher: vale o default da role (admin → professional).
    assert.strictEqual(CE.getActivePersona().id, 'professional', 'default da role deveria ser professional');
    // Usuário clica num card de persona → escolha explícita.
    CE.setActivePersona('sales');
    assert.strictEqual(CE.getActivePersona().id, 'sales', 'a escolha do usuário tem que vencer a role');
    // Troca de novo, pra garantir que não fica preso.
    CE.setActivePersona('coach');
    assert.strictEqual(CE.getActivePersona().id, 'coach', 'segunda troca também tem que valer');
  } finally {
    restore();
  }
});

test('sem escolha explícita, a persona-padrão da role é preservada (feature de equipe)', () => {
  const { CE, restore } = loadFreshEngine(teamSystemWithRole('sales'));
  try {
    // role sales → persona sales, sem o usuário ter clicado em nada.
    assert.strictEqual(CE.getActivePersona().id, 'sales');
  } finally {
    restore();
  }
});

test('aplicação automática (explicit:false) NÃO trava; escolha explícita posterior vence', () => {
  const { CE, restore } = loadFreshEngine(teamSystemWithRole('admin'));
  try {
    // Como o TeamSystem aplica a persona da role: explicit:false.
    CE.setActivePersona('friendly', { explicit: false });
    // Ainda não foi escolha do usuário → role admin continua mandando.
    assert.strictEqual(CE.getActivePersona().id, 'professional', 'explicit:false não pode travar a seleção');
    // Agora o usuário escolhe de fato.
    CE.setActivePersona('concierge');
    assert.strictEqual(CE.getActivePersona().id, 'concierge');
  } finally {
    restore();
  }
});

test('sem TeamSystem, a escolha do usuário é respeitada normalmente', () => {
  const { CE, restore } = loadFreshEngine(null);
  try {
    CE.setActivePersona('support');
    assert.strictEqual(CE.getActivePersona().id, 'support');
  } finally {
    restore();
  }
});
