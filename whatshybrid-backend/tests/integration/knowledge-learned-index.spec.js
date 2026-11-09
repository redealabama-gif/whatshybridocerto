/**
 * Integração — IA-57: a correção do operador vale para a mesma dúvida dita de
 * outro jeito.
 *
 * Editar + Aprovar uma sugestão grava a correção (learned_examples), que voltava
 * ao prompt só pela busca por palavra-chave. O índice semântico — que existe
 * para cobrir perguntas com outras palavras — indexava FAQs, produtos, exemplos
 * e TXT, mas não as correções. Na tela real: corrigido "Vocês têm
 * estacionamento?" → "Rua das Flores, 120"; depois "Tem onde deixar o carro aí
 * perto?" → a correção não chegou ao prompt e o modelo inventou "tem um
 * estacionamento bem próximo, é só seguir reto".
 * Prova real: audit/evidencias/fase3/62-aprendizado-tela-real.json.
 */

const { ensureDb, database, cleanupDb } = require('./helpers/app');

const WS = 'ws-ia57';
let AIOrchestrator; let Store;

beforeAll(async () => {
  await ensureDb();
  await require('../../src/utils/uuid-wrapper').initUUID();
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
    ['user-ia57', 'user-ia57@example.com', 'x', 'Owner IA-57', WS]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [WS, 'Clínica IA-57', 'user-ia57']
  );
  database.run(
    `INSERT INTO faqs (id, workspace_id, question, answer, category, keywords, is_active, created_at, updated_at)
     VALUES ('f-ia57', ?, 'Qual o horário?', 'Seg a sex 8h–18h.', 'general', '[]', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [WS]
  );
  AIOrchestrator = require('../../src/ai/AIOrchestrator');
  AIOrchestrator = AIOrchestrator.AIOrchestrator || AIOrchestrator;
  Store = require('../../src/ai/learning/LearnedExamplesStore');
});
afterAll(() => cleanupDb());

const orch = () => { const o = Object.create(AIOrchestrator.prototype); o.tenantId = WS; return o; };

describe('IA-57 — correção do operador no índice semântico', () => {
  test('a correção entra no índice semântico', async () => {
    Store.captureFromEdit({ workspaceId: WS, question: 'Vocês têm estacionamento?', originalResponse: 'Temos sim, gratuito.', correctedResponse: 'Temos estacionamento conveniado na Rua das Flores, 120.' });
    const docs = [];
    const o = orch();
    o.hybridSearch = { documents: new Map(), clear() { docs.length = 0; }, async addDocument(d) { docs.push(d); } };
    await o._indexTrainedKnowledge();
    expect(docs.some((d) => /Rua das Flores/.test(d.content))).toBe(true);
  });

  test('nova correção reindexa (a assinatura do conhecimento muda)', () => {
    const antes = orch()._computeKnowledgeSignature();
    Store.captureFromEdit({ workspaceId: WS, question: 'Aceitam pix?', originalResponse: 'Não.', correctedResponse: 'Aceitamos pix, cartão e dinheiro.' });
    expect(orch()._computeKnowledgeSignature()).not.toBe(antes);
  });
});
