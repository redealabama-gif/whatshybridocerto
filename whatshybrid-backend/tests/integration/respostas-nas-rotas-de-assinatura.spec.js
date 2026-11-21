/**
 * EXT-01 — a extensão mostra um chip "N créditos" ao lado do plano
 * (modules/subscription-ui.js:102) alimentado pelo campo `credits` das rotas
 * de assinatura. Esse campo vinha de três lugares diferentes, nenhum deles
 * igual ao que o cliente comprou:
 *
 *   src/routes/subscription.js:146  credits: ws.credits        (coluna parada)
 *   src/routes/subscription.js:410  credits: ws.credits || 0   (idem)
 *   src/routes/subscription.js:504  credits: ws.credits || 0   (idem)
 *   src/routes/auth.js:541          credits = saldo em TOKENS
 *
 * workspaces.credits nasce 100 no cadastro (auth.js:323) e ninguém atualiza —
 * o comentário em auth.js:535 já diz "workspaces.credits removido". Então um
 * cliente Business que comprou 10.000 respostas via "100 créditos" por um
 * caminho e "19.200.000 créditos" pelo outro.
 *
 * Depois: todas as rotas trazem `respostas` do TokenService, e `credits`
 * carrega o mesmo número (respostas restantes) pra UI antiga não mentir.
 */
const { startRealServer } = require('./helpers/real-server');

let srv, token;

beforeAll(async () => {
  srv = await startRealServer();
  const r = await srv.request('POST', '/api/v1/auth/signup', {
    body: {
      email: `ext01-${Date.now()}@example.com`,
      password: 'Cliente#Teste2026',
      name: 'Dona Teste',
      company: 'Empresa Teste',
      plan: 'business',
    },
  });
  expect(r.status).toBe(201);
  token = r.body.token || r.body.accessToken;
}, 30000);
afterAll(async () => { if (srv) await srv.stop(); });

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('EXT-01 — rotas de assinatura falam em respostas', () => {
  test('GET /subscription traz respostas e credits coerentes', async () => {
    const r = await srv.request('GET', '/api/v1/subscription', { headers: auth() });
    expect(r.status).toBe(200);
    const sub = r.body.subscription || r.body;
    expect(sub.respostas).toBeDefined();
    expect(sub.respostas.total).toBe(10000);
    expect(sub.respostas.restantes).toBe(10000);
    expect(sub.credits).toBe(10000);
    expect(sub.credits).not.toBe(100);        // a coluna parada
    expect(sub.credits).not.toBe(19200000);   // tokens crus
  });

  test('POST /subscription/validate traz respostas e credits coerentes', async () => {
    const r = await srv.request('POST', '/api/v1/subscription/validate', {
      headers: auth(), body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body.respostas).toBeDefined();
    expect(r.body.respostas.restantes).toBe(10000);
    expect(r.body.credits).toBe(10000);
  });

  test('POST /subscription/sync traz respostas e credits coerentes', async () => {
    const r = await srv.request('POST', '/api/v1/subscription/sync', {
      headers: auth(), body: { usage: {} },
    });
    expect(r.status).toBe(200);
    expect(r.body.respostas).toBeDefined();
    expect(r.body.respostas.restantes).toBe(10000);
    expect(r.body.credits).toBe(10000);
  });

  test('GET /auth/me devolve respostas além do saldo em tokens', async () => {
    const r = await srv.request('GET', '/api/v1/auth/me', { headers: auth() });
    expect(r.status).toBe(200);
    const ws = (r.body.user && r.body.user.workspace) || r.body.workspace;
    expect(ws).toBeDefined();
    expect(ws.respostas).toBeDefined();
    expect(ws.respostas.restantes).toBe(10000);
    // balance continua em tokens (é o nome histórico do campo)
    expect(ws.balance).toBe(19200000);
    expect(ws.credits).toBe(10000);
  });
});
