/**
 * PLN-01 — tokens de pacote avulso sumiam na renovação mensal.
 *
 * O site (seção de planos) promete: "compre pacotes avulsos de tokens a partir
 * de R$ 19 — eles não expiram". Na renovação do plano, resetMonthlyForPlan
 * fazia tokens_total = cota do plano e zerava o uso: o que sobrava do pacote
 * comprado desaparecia junto com a sobra do mês.
 *
 * Regra: a cota do plano vale para o mês (a sobra dela não acumula); o saldo
 * comprado que ainda não foi usado passa para o mês seguinte. O consumo usa
 * primeiro a cota do plano e só depois o que foi comprado.
 */

const request = require('supertest');
const { ensureDb, buildApp, cleanupDb } = require('./helpers/app');

let tokenService;
let ws;

beforeAll(async () => {
  await ensureDb();
  tokenService = require('../../src/services/TokenService');
  const app = buildApp({ '/api/v1/auth': require('../../src/routes/auth') });
  const r = await request(app).post('/api/v1/auth/signup').send({
    email: `tokens-${Date.now()}@example.com`, password: 'Cliente#Teste2026', name: 'Cliente', company: 'Loja', plan: 'starter',
  });
  ws = r.body.user.workspaceId || (r.body.workspace && r.body.workspace.id);
});
afterAll(() => cleanupDb());

const saldo = () => tokenService.getBalance(ws).balance;

describe('PLN-01 — pacote de tokens comprado não expira', () => {
  test('sobra do pacote passa para o mês seguinte; sobra da cota do plano não', () => {
    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-1' }); // 50.000 do plano
    tokenService.credit(ws, 10_000, 'topup', { invoice_id: 'pack-1' }); // pacote de R$ 19
    expect(saldo()).toBe(60_000);

    // usa 20.000: sai tudo da cota do plano (sobram 30.000 do plano + 10.000 comprados)
    expect(tokenService.consume(ws, 20_000).allowed).toBe(true);

    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-2' });
    // nova cota (50.000) + o pacote inteiro (10.000); a sobra do plano (30.000) não acumula
    expect(saldo()).toBe(60_000);
  });

  test('pacote usado em parte: só o que restou dele passa', () => {
    // mês 2: 50.000 do plano + 10.000 comprados. Usa 55.000 → 5.000 do pacote foram usados
    expect(tokenService.consume(ws, 55_000).allowed).toBe(true);
    expect(saldo()).toBe(5_000);

    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-3' });
    expect(saldo()).toBe(55_000);
  });

  test('renovação repetida (mesmo pagamento) não soma de novo', () => {
    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-3' });
    expect(saldo()).toBe(55_000);
  });

  test('(controle) sem pacote, a renovação dá só a cota do plano', () => {
    expect(tokenService.consume(ws, 55_000).allowed).toBe(true);
    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-4' });
    expect(saldo()).toBe(50_000);
  });
});
