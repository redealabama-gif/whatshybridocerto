/**
 * Integração — IA-50: texto importado de TXT na tela de treinamento chega à IA.
 *
 * A tela importa o TXT como "parágrafos anexados ao conhecimento" e guarda em
 * businessInfo.extraNotes (workspace_knowledge.data). O AIOrchestrator só
 * montava campos fixos do negócio (nome, horário, políticas…): os parágrafos
 * nunca entravam no prompt. Na tela real (gpt-4o-mini), com a política "taxa
 * de R$ 50,00 sem aviso de 24 horas" importada, a IA respondeu "Se precisar
 * remarcar, não tem custo" — inventou a política.
 * Prova real: audit/evidencias/fase3/61-treinamento-tela-real.json (sugestao2).
 */

const { ensureDb, database, cleanupDb } = require('./helpers/app');

const WS = 'ws-ia50';
const NOTAS = '--- politica.txt ---\nRemarcações são gratuitas quando avisadas com pelo menos 24 horas de antecedência. Faltas sem aviso ou remarcações em cima da hora pagam uma taxa de R$ 50,00, descontada na próxima consulta.';
let AIOrchestrator;

function setNegocio(data, updatedAt) {
  database.run('DELETE FROM workspace_knowledge WHERE workspace_id = ?', [WS]);
  database.run(
    'INSERT INTO workspace_knowledge (id, workspace_id, data, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
    [`wk-${WS}`, WS, JSON.stringify(data), updatedAt, updatedAt]
  );
}
function orch() {
  const o = Object.create(AIOrchestrator.prototype);
  o.tenantId = WS;
  return o;
}

beforeAll(async () => {
  await ensureDb();
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
    ['user-ia50', 'user-ia50@example.com', 'x', 'Owner IA-50', WS]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [WS, 'Clínica IA-50', 'user-ia50']
  );
  database.run(
    `INSERT INTO faqs (id, workspace_id, question, answer, category, keywords, is_active, created_at, updated_at)
     VALUES ('f-ia50', ?, 'Qual o horário?', 'Seg a sex 8h–18h.', 'general', '[]', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [WS]
  );
  AIOrchestrator = require('../../src/ai/AIOrchestrator');
  AIOrchestrator = AIOrchestrator.AIOrchestrator || AIOrchestrator;
});

afterAll(() => cleanupDb());

beforeEach(() => setNegocio({ name: 'Clínica Sorriso Fácil', extraNotes: NOTAS }, 1000));

describe('IA-50 — parágrafos importados de TXT', () => {
  test('entram no índice semântico', async () => {
    const docs = [];
    const o = orch();
    o.hybridSearch = { documents: new Map(), clear() { docs.length = 0; }, async addDocument(d) { docs.push(d); } };
    await o._indexTrainedKnowledge();
    const nota = docs.find((d) => /24 horas/.test(d.content));
    expect(nota).toBeDefined();
    expect(nota.content).not.toMatch(/^---/); // sem o cabeçalho "--- arquivo ---"
  });

  test('são encontrados pela busca por palavra-chave', () => {
    const out = orch()._loadTrainedKnowledge('Qual a taxa para remarcar a consulta?', 6);
    expect(out.some((k) => /R\$ 50,00/.test(k.content))).toBe(true);
  });

  test('trocar o TXT reindexa (a assinatura do conhecimento muda)', () => {
    const antes = orch()._computeKnowledgeSignature();
    setNegocio({ name: 'Clínica Sorriso Fácil', extraNotes: `${NOTAS}\n\nNovo parágrafo sobre estacionamento conveniado na rua de trás.` }, 2000);
    expect(orch()._computeKnowledgeSignature()).not.toBe(antes);
  });
});
