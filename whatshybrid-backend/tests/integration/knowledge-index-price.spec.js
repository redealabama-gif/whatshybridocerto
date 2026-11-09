/**
 * Integração — IA-47: o preço do produto treinado chega ao modelo.
 *
 * Com chave real (embeddings disponíveis) o AIOrchestrator junta dois caminhos
 * de conhecimento: o índice semântico (_indexTrainedKnowledge, nota fixa 0,5) e
 * a busca por palavra-chave (_loadTrainedKnowledge). O prompt leva só as 3
 * melhores fontes. O documento de produto do índice semântico saía SEM preço e
 * sem estoque; a cópia com preço da busca por palavra-chave (nota 0,481 no
 * teste real) ficava fora do top-3 → o modelo respondia "R$ XXX".
 * Prova real: audit/evidencias/fase3/61-treinamento-tela-real.json.
 */

const { ensureDb, database, cleanupDb } = require('./helpers/app');

const WS = 'ws-ia47';
let AIOrchestrator;

beforeAll(async () => {
  await ensureDb();
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
    ['user-ia47', 'user-ia47@example.com', 'x', 'Owner IA-47', WS]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [WS, 'Clínica IA-47', 'user-ia47']
  );
  AIOrchestrator = require('../../src/ai/AIOrchestrator');
  AIOrchestrator = AIOrchestrator.AIOrchestrator || AIOrchestrator;
});

afterAll(() => cleanupDb());

beforeEach(() => {
  for (const tbl of ['products', 'faqs', 'training_examples']) {
    try { database.run(`DELETE FROM ${tbl} WHERE workspace_id = ?`, [WS]); } catch (_) { /* tabela opcional */ }
  }
  database.run(
    `INSERT INTO products (id, workspace_id, name, description, price, currency, stock, stock_status, tags, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'BRL', ?, ?, '[]', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ['p-clareamento', WS, 'Clareamento dental', 'Clareamento no consultório, sessão de 1 hora', 650, null, 'available']
  );
  database.run(
    `INSERT INTO products (id, workspace_id, name, description, price, currency, stock, stock_status, tags, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'BRL', ?, ?, '[]', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ['p-kit', WS, 'Kit clareador caseiro', 'Moldeira + gel', 0, 0, 'out_of_stock']
  );
});

async function indexedDocs() {
  const docs = [];
  const orch = Object.create(AIOrchestrator.prototype);
  orch.tenantId = WS;
  orch.hybridSearch = { documents: new Map(), clear() { docs.length = 0; }, async addDocument(d) { docs.push(d); } };
  await orch._indexTrainedKnowledge();
  return docs;
}

describe('IA-47 — documento de produto do índice semântico', () => {
  test('leva o preço', async () => {
    const doc = (await indexedDocs()).find((d) => d.id === 'product:p-clareamento');
    expect(doc).toBeDefined();
    expect(doc.content).toMatch(/650[.,]00/);
  });

  test('leva o estoque esgotado (para a IA não oferecer o que acabou)', async () => {
    const doc = (await indexedDocs()).find((d) => d.id === 'product:p-kit');
    expect(doc).toBeDefined();
    expect(doc.content).toMatch(/ESGOTADO/);
  });
});
