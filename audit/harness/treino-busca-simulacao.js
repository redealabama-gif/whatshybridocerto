#!/usr/bin/env node
/**
 * Tela de TREINAMENTO da extensão — campo de busca e simulação (aprovar resposta).
 *
 * Extensão real no Chromium + backend de teste (audit/harness/start-backend.sh,
 * provedor de IA falso). Cadastra pela tela 2 FAQs, 2 produtos e 2 exemplos e:
 *  - busca digitada na aba que abre primeiro (Simulação), sem acento;
 *  - busca na aba FAQs; troca de aba e volta (a busca continua valendo?);
 *  - limpa a busca (tudo volta);
 *  - simulação: envia uma mensagem, aprova a resposta da IA e confere se ela
 *    vira exemplo na lista "Exemplos" e no servidor (o que a IA usa), sem
 *    precisar de outro botão.
 * Uso (na raiz): node audit/harness/treino-busca-simulacao.js http://127.0.0.1:3000 [dir-prints]
 * Sai com código 1 se alguma verificação falhar.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.argv[3] || null;
const SRC_EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-treino-busca-'));

const FAQS = [
  { q: 'Qual o horário de funcionamento?', a: 'Segunda a sexta, das 8h às 18h.' },
  { q: 'Vocês aceitam cartão?', a: 'Aceitamos cartão de crédito em até 6x.' },
];
const PRODUTOS = [
  { nome: 'Clareamento dental', preco: '650', descricao: 'Sessão de 1 hora no consultório.' },
  { nome: 'Limpeza', preco: '180', descricao: 'Limpeza completa com polimento.' },
];
const EXEMPLOS = [
  { in: 'Tem horário no sábado?', out: 'Tem sim! Sábado das 8h às 12h.' },
  { in: 'Qual o endereço?', out: 'Ficamos na Rua das Flores, 100, Centro.' },
];

const resultados = [];
function registrar(nome, ok, detalhe) {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome} — ${detalhe}`);
}
async function http(method, url, body, token) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const su = await http('POST', `${B}/api/v1/auth/signup`, { email: `treino-busca-${Date.now()}@example.com`, password: 'Audit#Senha2026', name: 'Clinica', company: 'Clinica Sorriso', plan: 'pro' });
  if (su.status !== 201) throw new Error(`cadastro de teste falhou: ${su.status} ${JSON.stringify(su.json)}`);
  const token = su.json.accessToken;

  const extDir = path.join(SCRATCH, 'ext');
  fs.cpSync(SRC_EXT, extDir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  const ctx = await chromium.launchPersistentContext(path.join(SCRATCH, 'profile'), {
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    viewport: { width: 1366, height: 900 },
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  await sw.evaluate(async ({ base, token, user, workspace }) => {
    await chrome.storage.local.set({
      whl_backend_client: JSON.stringify({ baseUrl: base, accessToken: token, refreshToken: null, user, workspace }),
      whl_backend_url: base,
      whl_subscription: { planId: 'pro', status: 'active' },
    });
  }, { base: B, token, user: su.json.user, workspace: su.json.workspace });

  const tr = await ctx.newPage();
  const erros = [];
  tr.on('pageerror', (e) => erros.push(e.message.slice(0, 200)));
  tr.on('dialog', (d) => d.accept().catch(() => {}));
  await tr.goto(`chrome-extension://${extId}/training/training.html`);
  await tr.waitForFunction(() => typeof app !== 'undefined' && app, null, { timeout: 15000 });
  await tr.waitForTimeout(1500);

  // ── Cadastro pela tela ─────────────────────────────────────────────────────
  for (const f of FAQS) {
    await tr.click('[data-tab="faqs"]'); await tr.click('#btnAddFaq');
    await tr.fill('#faqQuestion', f.q); await tr.fill('#faqAnswer', f.a); await tr.click('#btnSaveFaq');
    await tr.waitForTimeout(300);
  }
  for (const p of PRODUTOS) {
    await tr.click('[data-tab="products"]'); await tr.click('#btnAddProduct');
    await tr.fill('#productName', p.nome); await tr.fill('#productPrice', p.preco); await tr.fill('#productDescription', p.descricao);
    await tr.click('#btnSaveProduct');
    await tr.waitForTimeout(300);
  }
  for (const e of EXEMPLOS) {
    await tr.click('[data-tab="examples"]'); await tr.click('#btnAddExample');
    await tr.fill('#exampleInput', e.in); await tr.fill('#exampleOutput', e.out); await tr.click('#btnSaveExample');
    await tr.waitForTimeout(300);
  }
  // volta para a aba que abre primeiro
  await tr.click('[data-tab="simulation"]');
  await tr.waitForTimeout(300);

  const visiveis = (sel) => tr.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.offsetParent !== null).map((el) => el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80)), sel);
  const abaAtiva = () => tr.evaluate(() => document.querySelector('.tab-btn.active')?.dataset.tab || null);
  const buscar = async (texto) => { await tr.fill('#searchInput', texto); await tr.waitForTimeout(500); };

  // ── 1) Busca digitada na aba Simulação (a que abre primeiro), sem acento ──
  await buscar('horario');
  {
    const aba = await abaAtiva();
    const faqs = await visiveis('.faq-card');
    const exemplos = await visiveis('.example-card');
    if (OUT) await tr.screenshot({ path: path.join(OUT, '1-busca-na-simulacao.png') });
    const achou = faqs.some((t) => /horário de funcionamento/i.test(t)) || exemplos.some((t) => /sábado/i.test(t));
    registrar('busca "horario" digitada na aba Simulação mostra resultado', achou,
      `aba=${aba} FAQs visíveis=${JSON.stringify(faqs)} exemplos visíveis=${JSON.stringify(exemplos)}`);
  }

  // ── 2) Busca na aba FAQs ──────────────────────────────────────────────────
  await buscar('');
  await tr.click('[data-tab="faqs"]');
  await buscar('cartão');
  {
    const faqs = await visiveis('.faq-card');
    registrar('busca "cartão" na aba FAQs filtra', faqs.length === 1 && /cartão/.test(faqs[0]), JSON.stringify(faqs));
  }
  // ── 3) Sem acento na aba FAQs ─────────────────────────────────────────────
  await buscar('cartao');
  {
    const faqs = await visiveis('.faq-card');
    registrar('busca sem acento ("cartao") acha "cartão"', faqs.length === 1 && /cartão/.test(faqs[0]), JSON.stringify(faqs));
  }
  // ── 4) Troca de aba com a busca preenchida ────────────────────────────────
  await buscar('cartão');
  await tr.click('[data-tab="products"]');
  await tr.waitForTimeout(300);
  const produtosComBusca = await visiveis('.product-card');
  await tr.click('[data-tab="faqs"]');
  await tr.waitForTimeout(300);
  {
    const faqs = await visiveis('.faq-card');
    registrar('ao voltar para FAQs a busca continua valendo', faqs.length === 1, `busca="${await tr.inputValue('#searchInput')}" FAQs visíveis=${JSON.stringify(faqs)}`);
    registrar('produtos sem "cartão" ficam de fora enquanto a busca está preenchida', produtosComBusca.length === 0, `produtos visíveis=${JSON.stringify(produtosComBusca)}`);
  }
  // ── 5) Busca por produto e por preço de exemplo ───────────────────────────
  await tr.click('[data-tab="products"]');
  await buscar('limpeza');
  {
    const produtos = await visiveis('.product-card');
    registrar('busca "limpeza" na aba Produtos filtra', produtos.length === 1 && /Limpeza/.test(produtos[0]), JSON.stringify(produtos));
  }
  // ── 6) Limpar a busca devolve tudo ────────────────────────────────────────
  await buscar('');
  {
    const produtos = await visiveis('.product-card');
    await tr.click('[data-tab="faqs"]'); await tr.waitForTimeout(300);
    const faqs = await visiveis('.faq-card');
    registrar('limpar a busca mostra tudo de novo', produtos.length === 2 && faqs.length === 2, `produtos=${produtos.length} FAQs=${faqs.length}`);
  }

  // ── 7) Simulação: aprovar a resposta já basta ─────────────────────────────
  await tr.click('[data-tab="simulation"]');
  const exemplosAntes = await tr.evaluate(() => app.examples.length);
  const botaoExtra = await tr.evaluate(() => {
    const b = document.getElementById('btnSaveApproved');
    return b ? { existe: true, desabilitado: b.disabled, visivel: b.offsetParent !== null } : { existe: false };
  });
  await tr.fill('#simUserInput', 'Vocês atendem aos domingos?');
  await tr.click('#btnSendUserMsg');
  const temResposta = await tr.waitForSelector('#simChatMessages .btn-approve-msg', { timeout: 30000 }).then(() => true).catch(() => false);
  let detalheSim = `botão "Sincronizar respostas aprovadas": ${JSON.stringify(botaoExtra)}`;
  if (!temResposta) {
    registrar('simulação: a IA respondeu', false, 'sem resposta em 30 s');
  } else {
    await tr.click('#simChatMessages .btn-approve-msg');
    await tr.waitForTimeout(5000); // aprovação + sincronização do treino (2 s) + servidor
    const exemplosDepois = await tr.evaluate(() => app.examples.length);
    await tr.click('[data-tab="examples"]'); await tr.waitForTimeout(300);
    const naLista = (await visiveis('.example-card')).some((t) => /domingo/i.test(t));
    const servidor = await http('GET', `${B}/api/v1/training/sync`, null, token);
    const noServidor = (servidor.json?.examples || []).some((e) => /domingo/i.test(e.input || ''));
    if (OUT) await tr.screenshot({ path: path.join(OUT, '7-exemplos-apos-aprovar.png') });
    registrar('aprovar a resposta na simulação já vira exemplo (lista e servidor), sem outro botão',
      exemplosDepois === exemplosAntes + 1 && naLista && noServidor,
      `exemplos ${exemplosAntes}→${exemplosDepois}, na lista=${naLista}, no servidor=${noServidor}; ${detalheSim}`);
    registrar('não existe botão duplicado de sincronizar na simulação', !botaoExtra.existe || !botaoExtra.visivel, detalheSim);
    // Nada pode sumir: os exemplos cadastrados antes continuam gravados (é o que o Autopilot lê).
    const gravados = await sw.evaluate(async () => {
      const r = await chrome.storage.local.get('whl_few_shot_examples');
      let v = r.whl_few_shot_examples; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = []; } }
      return (Array.isArray(v) ? v : []).map((e) => e.input || e.user || '');
    });
    const perdidos = EXEMPLOS.filter((e) => !gravados.includes(e.in)).map((e) => e.in);
    registrar('aprovar na simulação não apaga os exemplos já cadastrados', perdidos.length === 0 && gravados.some((t) => /domingo/i.test(t)),
      `gravados no navegador=${JSON.stringify(gravados)} perdidos=${JSON.stringify(perdidos)}`);
    // Informativo (versão antiga): o que o botão "Sincronizar respostas aprovadas" faz quando clicado.
    if (botaoExtra.existe) {
      await tr.click('[data-tab="simulation"]'); await tr.waitForTimeout(300);
      const estado = await tr.evaluate(() => { const b = document.getElementById('btnSaveApproved'); const cs = getComputedStyle(b); return { desabilitado: b.disabled, opacidade: cs.opacity, cursor: cs.cursor }; });
      const avisos = [];
      tr.on('console', (m) => { if (/TrainingApp|Simulation/.test(m.text())) avisos.push(m.text().slice(0, 120)); });
      if (!estado.desabilitado) await tr.click('#btnSaveApproved');
      await tr.waitForTimeout(5000);
      const toast = await tr.evaluate(() => [...document.querySelectorAll('.toast, [class*="toast"]')].map((t) => t.innerText.trim()).filter(Boolean).slice(-2).join(' | '));
      const ex = await tr.evaluate(() => app.examples.length);
      const srv = await http('GET', `${B}/api/v1/training/sync`, null, token);
      console.log(`INFO    botão "Sincronizar respostas aprovadas" depois de aprovar: ${JSON.stringify(estado)}; clicado → aviso=${JSON.stringify(toast)}, exemplos na tela=${ex}, exemplo no servidor=${(srv.json?.examples || []).some((e) => /domingo/i.test(e.input || ''))}`);
    }
  }

  registrar('nenhum erro de script na página', erros.length === 0, JSON.stringify(erros));
  await ctx.close();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} passaram`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
