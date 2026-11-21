/**
 * TRIAL-01 — o trial de 7 dias dava a cota CHEIA do plano escolhido.
 *
 *   src/routes/auth.js:379  tokenService.resetMonthlyForPlan(workspaceId, plan)
 *
 * Quem se cadastrava no Business recebia 10.000 respostas sem cartão: R$ 66 de
 * custo nosso por cadastro (R$ 0,0066 por resposta, medido na fase ECON-01),
 * sem nada limitando quantas contas poderiam ser abertas. Medido no servidor
 * real antes da correção: trial em starter/pro/business → POST
 * /api/v2/ai/process devolvia HTTP 200, 2 chamadas ao provedor e débito de 1
 * resposta. Só o Free era barrado (402 FEATURE_NOT_AVAILABLE).
 *
 * A proteção que já existia — `trialAICredits: 50` em
 * whatshybrid-extension/modules/subscription-manager.js:253 — vale só para o
 * trial LOCAL da extensão (startTrial()), não para o trial criado pelo
 * cadastro no site. Agora os dois usam o mesmo número.
 *
 * Quem paga não é afetado: os webhooks de aprovação concedem a cota cheia por
 * conta própria (webhooks-payment-saas.js:531, :588, :791, :853 e
 * webhooks-stripe.js:159, :247).
 */
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { ensureDb, buildApp, cleanupDb } = require('./helpers/app');

let tokenService, app;

beforeAll(async () => {
  await ensureDb();
  tokenService = require('../../src/services/TokenService');
  app = buildApp({ '/api/v1/auth': require('../../src/routes/auth') });
});
afterAll(() => cleanupDb());

async function cadastrar(plan) {
  const r = await request(app).post('/api/v1/auth/signup').send({
    email: `trial-${plan}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`,
    password: 'Cliente#Teste2026',
    name: 'Dona Teste',
    company: 'Empresa Teste',
    plan,
  });
  expect(r.status).toBe(201);
  const ws = r.body.user.workspaceId || (r.body.workspace && r.body.workspace.id);
  return { ws, body: r.body };
}

const respostas = (ws) => tokenService.getBalance(ws).respostas;

describe('TRIAL-01 — o trial não entrega a cota cheia do plano', () => {
  test('o trial de qualquer plano pago concede só a cota de trial', async () => {
    for (const plano of ['starter', 'pro', 'business']) {
      const { ws } = await cadastrar(plano);
      expect({ plano, total: respostas(ws).total })
        .toEqual({ plano, total: tokenService.RESPOSTAS_TRIAL });
    }
  });

  test('o Business em trial não recebe mais as 10.000 respostas', async () => {
    const { ws } = await cadastrar('business');
    expect(respostas(ws).total).toBeLessThan(tokenService.PLAN_RESPOSTAS.business);
    expect(respostas(ws).total).toBe(50);
  });

  test('o Free continua sem nenhuma resposta', async () => {
    const { ws } = await cadastrar('free');
    expect(respostas(ws).total).toBe(0);
  });

  test('quando o pagamento é aprovado, a cota cheia do plano entra', async () => {
    const { ws } = await cadastrar('business');
    expect(respostas(ws).total).toBe(50);
    // É exatamente o que webhooks-payment-saas.js:791 faz ao aprovar.
    tokenService.resetMonthlyForPlan(ws, 'business', { invoice_id: `pag:${ws}` });
    expect(respostas(ws).total).toBe(tokenService.PLAN_RESPOSTAS.business);
    expect(respostas(ws).total).toBe(10000);
  });

  test('a cota de trial é a mesma nos dois lados (backend e extensão)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../whatshybrid-extension/modules/subscription-manager.js'),
      'utf8'
    );
    const m = src.match(/trialAICredits:\s*(\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m[1])).toBe(tokenService.RESPOSTAS_TRIAL);
  });

  test('o custo máximo de um cadastro de trial fica abaixo de R$ 1', () => {
    const CUSTO_POR_RESPOSTA = 0.0066; // medido na fase ECON-01
    expect(tokenService.RESPOSTAS_TRIAL * CUSTO_POR_RESPOSTA).toBeLessThan(1);
  });
});

describe('TRIAL-01 — nenhum caminho de cadastro escapa', () => {
  test('auth.js não concede mais a cota do plano em lugar nenhum', () => {
    // O cadastro por e-mail e o cadastro via Google tinham a MESMA linha
    // (resetMonthlyForPlan). Corrigir só um deixaria o Google como caminho
    // curto pras 10.000 respostas de graça.
    const src = fs.readFileSync(path.join(__dirname, '../../src/routes/auth.js'), 'utf8');
    const chamadas = src.split('\n')
      .map((l, i) => ({ n: i + 1, l }))
      .filter((x) => /tokenService\.resetMonthlyForPlan\(/.test(x.l) && !/^\s*\/\//.test(x.l));
    expect(chamadas.map((c) => `auth.js:${c.n}`)).toEqual([]);
  });

  test('os webhooks de pagamento continuam concedendo a cota cheia', () => {
    // A cota de trial só é defensável porque quem paga recebe o plano inteiro.
    for (const arq of ['src/routes/webhooks-payment-saas.js', 'src/routes/webhooks-stripe.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../../', arq), 'utf8');
      const n = (src.match(/resetMonthlyForPlan\(/g) || []).length;
      expect({ arq, n: n > 0 }).toEqual({ arq, n: true });
    }
  });
});
