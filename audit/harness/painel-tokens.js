#!/usr/bin/env node
/**
 * Painel do site (pergunta f do dono): cada número da aba "Tokens & Uso" confere
 * com o banco, inclusive DEPOIS de comprar tokens e consumir.
 *
 * Abre o dashboard.html num navegador de verdade, com a sessão de uma conta
 * recém-criada, e compara o que a tela MOSTRA com o que a API/banco têm, numa
 * sequência: cadastro Pro → 2 sugestões (consome) → compra de um pacote (topup).
 *
 * Uso (na raiz, com o backend de teste no ar):
 *   node audit/harness/painel-tokens.js http://127.0.0.1:3000 <db-path> [dir-prints]
 * Sai 1 se algum número divergir.
 */
'use strict';
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));
const Database = require(path.resolve(__dirname, '../../node_modules/better-sqlite3'));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const DB = process.argv[3];
// o crédito direto do topup usa o MESMO banco do backend em execução
if (DB) { process.env.DB_PATH = DB; process.env.DATABASE_PATH = DB; }
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-jwt-key-for-pipeline-runs-not-a-real-key';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'ci-webhook-key-for-pipeline-runs';
process.env.REDIS_DISABLED = 'true';
const OUT = process.argv[4] || null;
const SENHA = 'Cliente#Teste2026';

const resultados = [];
function conf(nome, ok, detalhe) { resultados.push({ nome, ok }); console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome} — ${detalhe}`); }
async function http(m, p, b, t) {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const txt = (p, id) => p.evaluate((i) => (document.getElementById(i)?.textContent || '').trim(), id);
const soNum = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;

(async () => {
  const su = await http('POST', '/api/v1/auth/signup', { email: `painel-${Date.now()}@example.com`, password: SENHA, name: 'Cliente Teste', company: 'Loja Teste', plan: 'pro' });
  if (su.status !== 201) throw new Error('cadastro falhou: ' + su.status);
  const tk = su.json.accessToken;
  const ws = su.json.user.workspaceId || su.json.workspace?.id;

  // consome em 2 sugestões
  for (const msg of ['Quanto custa o clareamento?', 'Voces atendem no sabado?']) {
    await http('POST', '/api/v2/ai/process', { chatId: 'painel-chat', message: msg, language: 'pt-BR', history: [] }, tk);
    await new Promise((r) => setTimeout(r, 800));
  }
  // compra um pacote de tokens (confirma direto pelo serviço, sem passar por pagamento)
  const topup = 50000;
  await http('POST', '/api/v1/tokens/balance', null, tk).catch(() => {}); // no-op defensivo
  try {
    await require(path.resolve(__dirname, '../../whatshybrid-backend/src/utils/uuid-wrapper.js')).initUUID();
    const svcTopup = require(path.resolve(__dirname, '../../whatshybrid-backend/src/services/TokenService.js'));
    svcTopup.credit(ws, topup, 'topup', { invoice_id: 'painel-pack-1', description: 'pacote avulso (teste painel)' });
  } catch (e) { console.log('aviso: credit direto falhou (' + e.message + '), seguindo com o saldo atual'); }
  await new Promise((r) => setTimeout(r, 300));

  const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await br.newContext({ viewport: { width: 1366, height: 1200 }, locale: 'pt-BR' });
  await ctx.addInitScript((s) => { try { localStorage.setItem('wh_jwt', s.accessToken); localStorage.setItem('wh_user', JSON.stringify(s.user)); } catch (_) {} }, su.json);
  const p = await ctx.newPage();
  await p.goto(`${B}/dashboard.html`);
  await p.waitForTimeout(3500);
  // abre a aba Tokens & Uso
  await p.evaluate(() => { const b = document.querySelector('.tab-btn[data-tab="tokens"]'); if (b) b.click(); });
  await p.waitForTimeout(2500);
  if (OUT) await p.screenshot({ path: path.join(OUT, 'painel-tokens.png'), fullPage: true });

  // verdade: banco + API
  const bal = (await http('GET', '/api/v1/tokens/balance', null, tk)).json.balance;
  const usage = (await http('GET', '/api/v1/tokens/usage?days=30', null, tk)).json.usage;
  const db = new Database(DB, { readonly: true });
  const credits = db.prepare('SELECT tokens_total, tokens_used, tokens_purchased FROM workspace_credits WHERE workspace_id = ?').get(ws);
  const consumo = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(ABS(amount)),0) t FROM token_transactions WHERE workspace_id = ? AND type='consume'").get(ws);
  db.close();

  // 1. saldo mostrado = saldo do banco (total - usado)
  const saldoTela = soNum(await txt(p, 'tokens-balance'));
  conf('saldo na tela = saldo do banco', saldoTela === bal.balance && bal.balance === credits.tokens_total - credits.tokens_used,
    `tela=${saldoTela} api=${bal.balance} banco=${credits.tokens_total - credits.tokens_used}`);

  // 2. "de X tokens neste ciclo (Y% usado)"
  const sub = await txt(p, 'tokens-sub');
  conf('total do ciclo e % usado conferem', soNum(sub.split('tokens')[0]) === credits.tokens_total && new RegExp(`\\(${bal.utilization_pct}% usado\\)`).test(sub),
    `sub="${sub}" total_banco=${credits.tokens_total} pct=${bal.utilization_pct}`);

  // 3. tokens consumidos em 30d = soma dos consume no banco
  const usoTela = soNum(await txt(p, 'usage-tokens'));
  conf('tokens consumidos (30d) na tela = banco', usoTela === usage.total_tokens_consumed && usage.total_tokens_consumed === consumo.t,
    `tela=${usoTela} api=${usage.total_tokens_consumed} banco=${consumo.t}`);

  // 4. nº de requisições = nº de consume
  const reqTela = soNum(await txt(p, 'usage-requests'));
  conf('nº de sugestões (30d) na tela = banco', reqTela === usage.total_requests && usage.total_requests === consumo.c,
    `tela=${reqTela} api=${usage.total_requests} banco=${consumo.c}`);

  // 5. média por sugestão
  const avgTela = soNum(await txt(p, 'usage-avg'));
  const avgEsper = consumo.c > 0 ? Math.round(consumo.t / consumo.c) : 0;
  conf('média de tokens por sugestão confere', avgTela === avgEsper, `tela=${avgTela} esperado=${avgEsper}`);

  // 6. o topup comprado aparece no saldo (não some) e consta como "Compra avulsa" no histórico
  const historico = await p.evaluate(() => (document.getElementById('tokens-history-container')?.innerText || ''));
  conf('compra de pacote reflete no saldo e no histórico', credits.tokens_purchased >= 50000 && saldoTela >= 50000 && /Compra avulsa/.test(historico),
    `tokens_purchased=${credits.tokens_purchased} saldoTela=${saldoTela} historico_tem_compra=${/Compra avulsa/.test(historico)}`);

  // 7. formatação brasileira (ponto de milhar) no saldo
  const saldoBruto = await txt(p, 'tokens-balance');
  conf('saldo formatado em pt-BR (ponto de milhar)', /\d{1,3}(\.\d{3})+/.test(saldoBruto) || bal.balance < 1000,
    `mostrado="${saldoBruto}"`);

  await br.close();
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} passaram`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
