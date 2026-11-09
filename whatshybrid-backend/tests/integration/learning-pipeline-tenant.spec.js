/**
 * Integração — IA-56: o que a IA aprende com as aprovações é salvo e usado.
 *
 * O AIOrchestrator criava o ValidatedLearningPipeline SEM o id do cliente
 * (tenantId "default"). Ao salvar um padrão, o banco recusava
 * (workspace_id "default" não existe → FOREIGN KEY constraint failed, 7 vezes
 * no log da tela real): o aprendizado ficava só na memória e sumia a cada
 * reinício. Com a fila (docker compose), a resposta sai do processo worker e o
 * feedback chega ao processo do servidor — o worker nunca via o que foi
 * aprovado. E o exemplo ia ao prompt com a pergunta do cliente trocada pela
 * chave interna ("a avalia consulta de dura o quanto tempo").
 * Prova real: audit/evidencias/fase3/62-aprendizado-tela-real.json.
 */

const { ensureDb, database, cleanupDb } = require('./helpers/app');

const WS = 'ws-ia56';
const PERGUNTA = 'Quanto tempo dura a consulta de avaliação?';
const RESPOSTA = 'A avaliação leva uns 40 minutos, com raio-x incluso.';
let AIOrchestrator;

beforeAll(async () => {
  await ensureDb();
  await require('../../src/utils/uuid-wrapper').initUUID();
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'owner', 'active', ?)`,
    ['user-ia56', 'user-ia56@example.com', 'x', 'Owner IA-56', WS]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [WS, 'Clínica IA-56', 'user-ia56']
  );
  AIOrchestrator = require('../../src/ai/AIOrchestrator');
  AIOrchestrator = AIOrchestrator.AIOrchestrator || AIOrchestrator;
});
afterAll(() => cleanupDb());

async function aprovar5x(orch) {
  for (let i = 0; i < 5; i++) {
    await orch.learningPipeline.recordInteraction({ intent: 'question', question: PERGUNTA, response: RESPOSTA, feedback: 'positive' });
  }
}

describe('IA-56 — padrões aprendidos com aprovações', () => {
  test('5 aprovações → padrão graduado salvo no banco deste cliente', async () => {
    const servidor = new AIOrchestrator({ tenantId: WS });
    await servidor.learningPipeline.init();
    await aprovar5x(servidor);
    const rows = database.all('SELECT status, positive_count FROM learning_patterns WHERE workspace_id = ?', [WS]);
    expect(rows).toEqual([expect.objectContaining({ status: 'graduated', positive_count: 5 })]);
  });

  test('o exemplo vai ao prompt com a pergunta do cliente, não com a chave interna', () => {
    const outro = new AIOrchestrator({ tenantId: WS });
    return outro.learningPipeline.init().then(() => {
      const [ex] = outro.learningPipeline.getTopGraduated('question', 3);
      expect(ex).toBeDefined();
      expect(ex.trigger).toBe(PERGUNTA);
      expect(ex.response).toBe(RESPOSTA);
    });
  });

  test('processo que já estava de pé (worker da fila) passa a usar o padrão aprovado em outro processo', async () => {
    database.run('DELETE FROM learning_patterns WHERE workspace_id = ?', [WS]);
    const worker = new AIOrchestrator({ tenantId: WS });
    await worker.learningPipeline.init(); // subiu antes das aprovações
    const servidor = new AIOrchestrator({ tenantId: WS });
    await servidor.learningPipeline.init();
    await aprovar5x(servidor);
    await worker._maybeReloadLearning(Date.now() + 61000);
    expect(worker.learningPipeline.getTopGraduated('question', 3).map((e) => e.response)).toEqual([RESPOSTA]);
  });
});
