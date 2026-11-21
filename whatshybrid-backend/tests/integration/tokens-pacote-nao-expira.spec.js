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

// A cota vem da constante, não de um número escrito à mão: este teste é sobre
// "o pacote comprado não expira na renovação", não sobre o tamanho da cota.
// Antes estava fixo em 50.000 e quebrou quando os planos passaram a ser
// medidos em respostas (Starter 500 respostas = 960.000 tokens).
const COTA = require('../../src/services/TokenService').PLAN_TOKENS.starter;
const PACOTE = 10_000;

describe('PLN-01 — pacote de tokens comprado não expira', () => {
  test('sobra do pacote passa para o mês seguinte; sobra da cota do plano não', () => {
    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-1' }); // cota do plano
    tokenService.credit(ws, PACOTE, 'topup', { invoice_id: 'pack-1' }); // pacote avulso
    expect(saldo()).toBe(COTA + PACOTE);

    // gasta um pedaço que sai só da cota do plano; o pacote fica intacto
    expect(tokenService.consume(ws, 20_000).allowed).toBe(true);

    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-2' });
    // nova cota + o pacote inteiro; a sobra da cota do plano não acumula
    expect(saldo()).toBe(COTA + PACOTE);
  });

  test('pacote usado em parte: só o que restou dele passa', () => {
    // gasta toda a cota do plano e metade do pacote
    expect(tokenService.consume(ws, COTA + PACOTE / 2).allowed).toBe(true);
    expect(saldo()).toBe(PACOTE / 2);

    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-3' });
    expect(saldo()).toBe(COTA + PACOTE / 2);
  });

  test('renovação repetida (mesmo pagamento) não soma de novo', () => {
    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-3' });
    expect(saldo()).toBe(COTA + PACOTE / 2);
  });

  test('(controle) sem pacote, a renovação dá só a cota do plano', () => {
    expect(tokenService.consume(ws, COTA + PACOTE / 2).allowed).toBe(true);
    tokenService.resetMonthlyForPlan(ws, 'starter', { invoice_id: 'mes-4' });
    expect(saldo()).toBe(COTA);
  });
});
