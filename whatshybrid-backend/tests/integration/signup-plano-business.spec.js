/**
 * PLN-04 — o card Business da landing aponta pra signup.html?plan=business,
 * mas a validação do signup só aceitava três planos:
 *
 *   src/routes/auth.js:255   body('plan').optional().isIn(['starter','pro','free'])
 *   src/routes/auth.js:1138  (mesma lista no login/signup via Google)
 *
 * Resultado: quem clicasse em "7 dias grátis" no Business levava 400 e não
 * conseguia criar a conta. O trial de 7 dias e o evento StartTrial da Meta
 * também estavam presos a starter|pro (auth.js:390 e :1329).
 */
const { startRealServer } = require('./helpers/real-server');
const { RESPOSTAS_TRIAL, PLAN_RESPOSTAS } = require('../../src/services/TokenService');

const SENHA = 'Cliente#Teste2026';
let srv;

beforeAll(async () => { srv = await startRealServer(); }, 30000);
afterAll(async () => { if (srv) await srv.stop(); });

const signup = (plan, sufixo) => srv.request('POST', '/api/v1/auth/signup', {
  body: {
    email: `business-${sufixo}-${Date.now()}@example.com`,
    password: SENHA,
    name: 'Dono Teste',
    company: 'Empresa Teste',
    ...(plan ? { plan } : {}),
  },
});

describe('PLN-04 — cadastro no plano Business', () => {
  test('signup com plan=business cria a conta (antes: 400 "plan inválido")', async () => {
    const r = await signup('business', 'ok');
    expect({ status: r.status, erro: r.body && (r.body.message || r.body.error) })
      .toMatchObject({ status: 201 });
    expect(r.body.workspace.plan).toBe('business');
  });

  test('o Business ganha trial de 7 dias, igual aos outros planos pagos', async () => {
    const r = await signup('business', 'trial');
    expect(r.status).toBe(201);
    const fim = new Date(r.body.workspace.trial_end_at).getTime();
    const dias = Math.round((fim - Date.now()) / 86400000);
    expect(dias).toBe(7);
  });

  test('a conta nasce com a cota do teste grátis, e não com zero (que seria o Free)', async () => {
    const r = await signup('business', 'cota');
    expect(r.status).toBe(201);
    const token = r.body.token || r.body.accessToken;
    const saldo = await srv.request('GET', '/api/v1/tokens/balance', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(saldo.status).toBe(200);
    // src/routes/tokens.js:25 responde { balance: <getBalance()> }
    const corpo = saldo.body.balance || saldo.body;
    // TRIAL-01: o trial concede a cota do teste, não as 10.000 do plano — a
    // cota cheia entra quando o pagamento é aprovado. O que importa aqui é
    // que o Business foi reconhecido (não caiu no Free, que recebe zero).
    expect(corpo.respostas.total).toBe(RESPOSTAS_TRIAL);
    expect(corpo.respostas.restantes).toBe(RESPOSTAS_TRIAL);
    expect(corpo.respostas.total).toBeGreaterThan(0);
    expect(corpo.respostas.total).toBeLessThan(PLAN_RESPOSTAS.business);
  });

  test('os planos antigos continuam funcionando', async () => {
    for (const p of ['free', 'starter', 'pro']) {
      const r = await signup(p, p);
      expect({ plano: p, status: r.status }).toMatchObject({ plano: p, status: 201 });
      expect(r.body.workspace.plan).toBe(p);
    }
  });

  test('plano inexistente continua recusado (a validação não foi afrouxada)', async () => {
    const r = await signup('ilimitado_gratis', 'invalido');
    expect(r.status).toBe(400);
  });
});
