/**
 * Compra anual dos planos: paga 10 meses, leva 12.
 *
 * Regra que estes testes protegem: a COTA CONTINUA MENSAL. Quem paga 12 meses
 * não recebe 12x a cota de uma vez — senão gastaria um ano de IA em um mês e o
 * teto de custo que sustenta a margem do plano seria furado.
 *
 * Como não há webhook mensal no anual (é uma cobrança só), quem libera a cota
 * mês a mês é o cron diário.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const mp = require('../../src/services/MercadoPagoService');
const { PLAN_RESPOSTAS } = require('../../src/services/TokenService');

const CUSTO_RESPOSTA = 0.0066;
const TAXA_MP = 0.0499;
const INFRA_MES = 2.00;

describe('preço do ciclo anual', () => {
  test('anual = 10 meses (2 grátis) para todo plano pago', () => {
    for (const plano of ['starter', 'pro', 'business']) {
      expect(mp.precoDoPlano(plano, 'annual')).toBe(
        Number((mp.precoDoPlano(plano) * 10).toFixed(2))
      );
    }
  });

  test('os valores anuais são os anunciados', () => {
    expect(mp.precoDoPlano('starter', 'annual')).toBe(499.00);
    expect(mp.precoDoPlano('pro', 'annual')).toBe(999.00);
    expect(mp.precoDoPlano('business', 'annual')).toBe(2999.00);
  });

  test('ciclo desconhecido cobra MENSAL — nunca o que o cliente não escolheu', () => {
    expect(mp.normalizarCiclo('qualquer-coisa')).toBe('monthly');
    expect(mp.normalizarCiclo(undefined)).toBe('monthly');
    expect(mp.normalizarCiclo('ANNUAL')).toBe('annual');
    expect(mp.precoDoPlano('pro', 'lixo')).toBe(99.90);
  });

  test('plano inexistente não tem preço (nem mensal nem anual)', () => {
    expect(mp.precoDoPlano('inventado')).toBeNull();
    expect(mp.precoDoPlano('inventado', 'annual')).toBeNull();
  });

  test('o desconto anual não derruba a margem abaixo de 65%', () => {
    for (const plano of ['starter', 'pro', 'business']) {
      const receita = mp.precoDoPlano(plano, 'annual');
      const respostasAno = PLAN_RESPOSTAS[plano] * 12;          // cota mensal x 12
      const custo = respostasAno * CUSTO_RESPOSTA + receita * TAXA_MP + INFRA_MES * 12;
      expect((receita - custo) / receita).toBeGreaterThan(0.65);
    }
  });
});

describe('renovação mensal de quem paga anual', () => {
  let dir; let db; let cron; let tokenService;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anual-'));
    process.env.DB_PATH = path.join(dir, 'teste.db');
    process.env.JWT_SECRET = 'x'.repeat(40);
    process.env.WEBHOOK_SECRET = 'y'.repeat(40);
    db = require('../../src/utils/database');
    db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY, plan TEXT, subscription_status TEXT,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly', annual_period_end DATETIME,
      updated_at DATETIME)`);
    db.exec(`CREATE TABLE IF NOT EXISTS workspace_credits (
      workspace_id TEXT PRIMARY KEY,
      tokens_total INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      tokens_purchased INTEGER NOT NULL DEFAULT 0,
      last_topup_at DATETIME, last_used_at DATETIME, low_balance_warned_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.exec(`CREATE TABLE IF NOT EXISTS token_transactions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, type TEXT NOT NULL,
      amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
      ai_request_id TEXT, invoice_id TEXT, model TEXT,
      prompt_tokens INTEGER, completion_tokens INTEGER, description TEXT,
      metadata TEXT DEFAULT '{}', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    tokenService = require('../../src/services/TokenService');
    cron = require('../../src/jobs/billingCron');
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });

  const criar = (id, extra = {}) => {
    db.run('DELETE FROM workspaces WHERE id = ?', [id]);
    db.run('DELETE FROM workspace_credits WHERE workspace_id = ?', [id]);
    db.run('DELETE FROM token_transactions WHERE workspace_id = ?', [id]);
    db.run(
      `INSERT INTO workspaces (id, plan, subscription_status, billing_cycle, annual_period_end)
       VALUES (?, ?, ?, ?, ?)`,
      [id, extra.plan || 'pro', extra.status || 'active', extra.cycle || 'annual', extra.fim ?? null]
    );
  };
  const saldo = (id) => tokenService.getBalance(id).balance;

  test('assinante anual recebe a cota MENSAL do plano, não 12x', () => {
    criar('ws-anual');
    cron.renovarCotaAnual();
    expect(saldo('ws-anual')).toBe(PLAN_RESPOSTAS.pro * 1920);
  });

  test('rodar o cron duas vezes no mesmo mês não dá cota dobrada', () => {
    criar('ws-idem');
    cron.renovarCotaAnual();
    const depoisDaPrimeira = saldo('ws-idem');
    cron.renovarCotaAnual();
    expect(saldo('ws-idem')).toBe(depoisDaPrimeira);
  });

  test('quem paga MENSAL não é tocado por este job', () => {
    criar('ws-mensal', { cycle: 'monthly' });
    cron.renovarCotaAnual();
    expect(saldo('ws-mensal')).toBe(0);
  });

  test('período anual vencido para de renovar', () => {
    criar('ws-vencido', { fim: new Date(Date.now() - 86400000).toISOString() });
    cron.renovarCotaAnual();
    expect(saldo('ws-vencido')).toBe(0);
  });

  test('assinatura cancelada para de renovar', () => {
    criar('ws-cancelado', { status: 'canceled' });
    cron.renovarCotaAnual();
    expect(saldo('ws-cancelado')).toBe(0);
  });

  test('plano free não recebe cota', () => {
    criar('ws-free', { plan: 'free' });
    cron.renovarCotaAnual();
    expect(saldo('ws-free')).toBe(0);
  });
});
