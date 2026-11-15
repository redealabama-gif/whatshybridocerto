#!/usr/bin/env node
/**
 * TRN-04 — exemplo criado na tela de Treinamento com o WhatsApp Web já aberto.
 *
 * O módulo de aprendizado (few-shot) do WhatsApp carrega a lista de exemplos uma
 * vez, quando a aba abre. A cada sugestão (🤖) ele marca o uso dos exemplos
 * escolhidos e regrava a lista que tem na memória em whl_few_shot_examples.
 * Roteiro: exemplo E1 → abre o WhatsApp → cria E2 no Treinamento → o
 * WhatsApp grava um exemplo (como fazem correção de sugestão, aprendizado
 * automático, Copiloto 👍 e contagem de uso) → E2 continua gravado? E o
 * WhatsApp já enxerga E2 sem recarregar?
 *
 * Extensão real no Chromium + backend de teste (audit/harness/start-backend.sh,
 * provedor de IA falso). Uso (na raiz):
 *   node audit/harness/exemplos-entre-abas.js http://127.0.0.1:3000
 * Sai com código 1 se alguma verificação falhar.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const SRC_EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-exemplos-abas-'));
const E1 = { in: 'Vocês abrem no sábado? Qual o horário?', out: 'Abrimos sim! Sábado das 8h às 12h.' };
const E2 = { in: 'Vocês fazem entrega no sábado?', out: 'Fazemos! Entregamos no sábado até as 12h.' };

const resultados = [];
function registrar(nome, ok, detalhe) {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome} — ${detalhe}`);
}
async function http(method, url, body, token) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

// WhatsApp Web simulado (mesmo formato de audit/harness/training-ui-real.js).
const CONV = [
  ['in', 'Boa tarde!'],
  ['out', 'Boa tarde! Como posso ajudar?'],
  ['in', 'Vocês abrem no sábado? Qual o horário? E fazem entrega?'],
];
const bubble = ([dir, text], i) => `<div role="row"><div data-id="3EB0AB${String(i).padStart(14, '0')}">${i === 0 ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[14:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const waHtml = `<html><head></head><body><div id="main"><header><span title="Cliente">Cliente</span></header>
<div data-testid="conversation-panel-messages">${CONV.map(bubble).join('')}</div>
<footer><div contenteditable="true" role="textbox" data-testid="conversation-compose-box-input"></div></footer></div></body></html>`;

(async () => {
  const su = await http('POST', `${B}/api/v1/auth/signup`, { email: `abas-${Date.now()}@example.com`, password: 'Audit#Senha2026', name: 'Loja', company: 'Loja', plan: 'pro' });
  if (su.status !== 201) throw new Error(`cadastro de teste falhou: ${su.status}`);
  const token = su.json.accessToken;

  const extDir = path.join(SCRATCH, 'ext');
  fs.cpSync(SRC_EXT, extDir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  const ctx = await chromium.launchPersistentContext(path.join(SCRATCH, 'profile'), {
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
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
  const gravados = () => sw.evaluate(async () => {
    const r = await chrome.storage.local.get('whl_few_shot_examples');
    let v = r.whl_few_shot_examples; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = []; } }
    return (Array.isArray(v) ? v : []).map((e) => e.input || e.user || '');
  });

  // 1) E1 pela tela de Treinamento
  const tr = await ctx.newPage();
  tr.on('dialog', (d) => d.accept().catch(() => {}));
  await tr.goto(`chrome-extension://${extId}/training/training.html`);
  await tr.waitForFunction(() => typeof app !== 'undefined' && app, null, { timeout: 15000 });
  await tr.waitForTimeout(1500);
  const novoExemplo = async (e) => {
    await tr.bringToFront();
    await tr.click('[data-tab="examples"]'); await tr.click('#btnAddExample');
    await tr.fill('#exampleInput', e.in); await tr.fill('#exampleOutput', e.out); await tr.click('#btnSaveExample');
    await tr.waitForTimeout(800);
  };
  await novoExemplo(E1);

  // 2) WhatsApp Web aberto (o aprendizado do WhatsApp carrega E1)
  const wa = await ctx.newPage();
  await wa.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: waHtml }));
  await wa.goto('https://web.whatsapp.com/');
  const btn = await wa.waitForSelector('#whl-ai-btn-fixed', { timeout: 30000 }).catch(() => null);
  if (!btn) throw new Error('botão 🤖 não apareceu no WhatsApp simulado');
  await wa.waitForTimeout(3000);

  // 3) E2 no Treinamento, com o WhatsApp aberto
  await novoExemplo(E2);
  const antesDaGravacao = await gravados();

  // 4) Uma gravação do aprendizado feita no WhatsApp. Quatro pontos gravam por
  //    window.fewShotLearning na aba do WhatsApp (correção de sugestão,
  //    aprendizado automático, Copiloto 👍 e contagem de uso dos exemplos);
  //    o teste chama addExample no mundo isolado da extensão nessa aba (CDP),
  //    exatamente o que esses pontos fazem.
  const cdp = await ctx.newCDPSession(wa);
  const contextos = [];
  cdp.on('Runtime.executionContextCreated', (e) => contextos.push(e.context));
  await cdp.send('Runtime.enable');
  await wa.waitForTimeout(500);
  const mundoExt = contextos.find((c) => c.auxData && c.auxData.type === 'isolated' && String(c.origin || '').includes(extId))
    || contextos.find((c) => c.auxData && c.auxData.type === 'isolated');
  if (!mundoExt) throw new Error('contexto da extensão na aba do WhatsApp não encontrado');
  const noWhatsApp = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { contextId: mundoExt.id, expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const memoriaAntes = await noWhatsApp('(window.fewShotLearning?.examples || []).map((e) => e.input)');
  await noWhatsApp(`window.fewShotLearning.addExample({ input: 'Qual o prazo de entrega?', output: 'Entregamos em até 2 dias úteis.', category: 'Geral' }).then(() => true)`);
  await wa.waitForTimeout(1500);
  const depois = await gravados();
  registrar('gravação do aprendizado no WhatsApp não apaga o exemplo criado depois no Treinamento',
    depois.includes(E2.in) && depois.includes(E1.in) && depois.includes('Qual o prazo de entrega?'),
    `memória do WhatsApp antes=${JSON.stringify(memoriaAntes)}; gravados antes=${JSON.stringify(antesDaGravacao)} depois=${JSON.stringify(depois)}`);
  registrar('o WhatsApp já enxerga o exemplo criado no Treinamento (sem recarregar)', memoriaAntes.includes(E2.in),
    `memória do WhatsApp=${JSON.stringify(memoriaAntes)}`);

  // 5) Sentido inverso: a tela de Treinamento (aberta o tempo todo) salva outro
  //    exemplo — não pode regravar a lista dela sem o que o WhatsApp gravou.
  await novoExemplo({ in: 'Aceitam PIX?', out: 'Aceitamos sim, PIX e cartão.' });
  const final = await gravados();
  registrar('salvar no Treinamento não apaga o exemplo gravado pelo WhatsApp',
    final.includes('Qual o prazo de entrega?') && final.includes('Aceitam PIX?') && final.includes(E2.in),
    `gravados=${JSON.stringify(final)}`);

  await ctx.close();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} passaram`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
