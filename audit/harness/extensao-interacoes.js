#!/usr/bin/env node
/**
 * F1 — varredura das telas da extensão (passada 2: os controles principais
 * de cada tela FAZEM o que dizem?).
 *
 * Extensão real + WhatsApp simulado + backend de teste. Em cada tela do painel
 * exercita os controles-chave e confere o EFEITO (fila montada, dado salvo no
 * storage, modal aberto, download gerado, resposta do content script) — não só
 * a ausência de erro.
 *
 * Uso (na raiz): node audit/harness/extensao-interacoes.js http://127.0.0.1:3000 [dir-prints]
 * Sai 1 se alguma interação falhar.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.argv[3] || null;
const SRC_EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-interacoes-'));

const resultados = [];
const conf = (nome, ok, detalhe) => { resultados.push({ nome, ok }); console.log(`${ok ? 'PASSOU ' : 'FALHOU '} ${nome} — ${detalhe}`); };
async function http(m, p, b, t) {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const CONV = [['in', 'Boa tarde!'], ['out', 'Boa tarde! Como posso ajudar?'], ['in', 'Quanto custa o plano?']];
const bubble = ([dir, text], i) => `<div role="row"><div data-id="3EB0IT${String(i).padStart(14, '0')}">${i === 0 ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[14:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const waHtml = `<html><head></head><body><div id="main"><header><span title="Cliente Teste">Cliente Teste</span></header>
<div data-testid="conversation-panel-messages">${CONV.map(bubble).join('')}</div>
<footer><div contenteditable="true" role="textbox" data-testid="conversation-compose-box-input"></div></footer></div></body></html>`;

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const su = await http('POST', '/api/v1/auth/signup', { email: `inter-${Date.now()}@example.com`, password: 'Audit#Senha2026', name: 'Cliente Teste', company: 'Loja Teste', plan: 'pro' });
  if (su.status !== 201) throw new Error('cadastro falhou: ' + su.status);

  const extDir = path.join(SCRATCH, 'ext');
  fs.cpSync(SRC_EXT, extDir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  const ctx = await chromium.launchPersistentContext(path.join(SCRATCH, 'profile'), {
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    viewport: { width: 480, height: 960 },
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
  }, { base: B, token: su.json.accessToken, user: su.json.user, workspace: su.json.workspace });

  const wa = await ctx.newPage();
  await wa.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: waHtml }));
  await wa.goto('https://web.whatsapp.com/');
  await wa.waitForTimeout(2500);

  const sp = await ctx.newPage();
  sp.on('dialog', (d) => d.accept().catch(() => {}));
  await sp.goto(`chrome-extension://${extId}/sidepanel.html`);
  await sp.waitForTimeout(3500);
  const view = async (v) => { await sp.evaluate((x) => showView(x), v); await sp.waitForTimeout(1200); };
  const clickId = (id) => sp.evaluate((i) => { const el = document.getElementById(i); if (!el) return false; el.click(); return true; }, id);
  const shot = async (n) => { if (OUT) await sp.screenshot({ path: path.join(OUT, n + '.png') }).catch(() => {}); };
  const storage = (k) => sw.evaluate(async (key) => (await chrome.storage.local.get(key))[key], k);

  // ── principal (disparo) ────────────────────────────────────────────────────
  await view('principal');
  await sp.fill('#sp_numbers', '5511999998888\n5511988887777');
  await sp.fill('#sp_message', 'Olá {nome}, tudo bem? Promoção da semana!');
  await clickId('sp_build_queue');
  await sp.waitForTimeout(800);
  const meta = await sp.evaluate(() => document.getElementById('sp_queue_meta')?.textContent || '');
  const linhas = await sp.evaluate(() => document.querySelectorAll('#sp_queue_table tr').length);
  conf('disparo: "Gerar tabela" monta a fila com os 2 números', /2/.test(meta) && linhas >= 2, `meta="${meta}" linhas=${linhas}`);
  await shot('i-principal');
  await clickId('sp_clear_fields');
  await sp.waitForTimeout(400);
  const aposLimpar = await sp.evaluate(() => document.getElementById('sp_numbers')?.value || '');
  conf('disparo: "Limpar" esvazia os campos', aposLimpar === '', `numeros depois="${aposLimpar}"`);

  // ── extrator ───────────────────────────────────────────────────────────────
  await view('extrator');
  const extAntes = await sp.evaluate(() => document.getElementById('sp_extract_status')?.textContent || '');
  await clickId('sp_extract_contacts');
  await sp.waitForTimeout(2500);
  const extDepois = await sp.evaluate(() => document.getElementById('sp_extract_status')?.textContent || '');
  conf('extrator: comando chega ao WhatsApp mesmo sem a aba em foco (VAR-03)', extDepois !== '' && !/abra o whatsapp/i.test(extDepois), `antes="${extAntes}" depois="${extDepois.slice(0, 80)}"`);
  await shot('i-extrator');

  // ── recover: controles de privacidade chegam ao WhatsApp ──────────────────
  await view('recover');
  const temToggle = await sp.evaluate(() => !!document.getElementById('whl_toggle_hide_online'));
  if (!temToggle) conf('recover: controle de privacidade existe', false, 'checkbox não encontrado');
  else {
    await clickId('whl_toggle_hide_online');
    await sp.waitForTimeout(1200);
    const noWa = await wa.evaluate(() => localStorage.getItem('whl_privacy_hide_online'));
    conf('recover: "ocultar online" chega à aba do WhatsApp (VAR-01)', noWa === 'true', `localStorage do WhatsApp=${JSON.stringify(noWa)}`);
  }
  await shot('i-recover');

  // ── config: salvar persiste ────────────────────────────────────────────────
  await view('config');
  const mudou = await sp.evaluate(() => {
    const campo = document.querySelector('#whlViewConfig input[type="number"], #whlViewConfig input[type="text"]');
    if (!campo) return null;
    campo.value = campo.type === 'number' ? '7' : 'teste-config';
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    campo.dispatchEvent(new Event('change', { bubbles: true }));
    return { id: campo.id, valor: campo.value };
  });
  await clickId('sp_save_settings');
  await sp.waitForTimeout(900);
  const cfgSalva = await sw.evaluate(async () => { const all = await chrome.storage.local.get(null); return Object.keys(all).filter((k) => /config|settings/i.test(k)).slice(0, 8); });
  conf('config: salvar grava em storage (chaves de config existem)', !!mudou && cfgSalva.length > 0, `campo=${JSON.stringify(mudou)} chaves=${JSON.stringify(cfgSalva)}`);

  // ── backup: exportar gera arquivo ─────────────────────────────────────────
  await view('backup');
  const btnExport = await sp.evaluate(() => {
    const b = [...document.querySelectorAll('#whlViewBackup button')].find((x) => /exportar|export|baixar/i.test(x.textContent));
    if (b) { b.setAttribute('data-probe-export', '1'); return b.textContent.trim(); }
    return null;
  });
  if (!btnExport) conf('backup: botão de exportar existe', false, 'não encontrado');
  else {
    const dl = sp.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await sp.evaluate(() => document.querySelector('[data-probe-export="1"]')?.click());
    const download = await dl;
    const bkStatus = await sp.evaluate(() => ((document.getElementById('bk_status_text')?.textContent || '') + ' | ' + (document.getElementById('bk_hint')?.textContent || '') + ' | ' + (document.getElementById('bk_wrong_page')?.textContent || '')).trim());
    conf('backup: exportar responde (arquivo ou status claro ao usuário)', !!download || /conversa|chat|exporta|selecione|abra/i.test(bkStatus), download ? `arquivo=${download.suggestedFilename()}` : `status="${bkStatus.slice(0, 110)}" (botão "${btnExport}")`);
  }

  // ── crm: novo contato de verdade ──────────────────────────────────────────
  await view('crm');
  await clickId('crm_new_contact');
  await sp.waitForTimeout(900);
  const modalCrm = await sp.evaluate(() => {
    const vis = [...document.querySelectorAll('input, textarea')].filter((x) => x.offsetParent !== null && /nome|name|telefone|phone/i.test(x.placeholder + x.id + x.name));
    return vis.map((x) => x.id || x.placeholder).slice(0, 4);
  });
  let crmOk = false, crmDet = `campos visíveis=${JSON.stringify(modalCrm)}`;
  if (modalCrm.length) {
    await sp.evaluate(() => {
      const vis = (sel) => [...document.querySelectorAll(sel)].filter((x) => x.offsetParent !== null);
      const nome = vis('input').find((x) => /nome|name/i.test(x.placeholder + x.id + x.name));
      const fone = vis('input').find((x) => /telefone|phone|numero|número/i.test(x.placeholder + x.id + x.name));
      if (nome) { nome.value = 'Cliente Varredura'; nome.dispatchEvent(new Event('input', { bubbles: true })); }
      if (fone) { fone.value = '5511977776666'; fone.dispatchEvent(new Event('input', { bubbles: true })); }
      const salvar = vis('button').find((x) => /salvar|adicionar|criar|save/i.test(x.textContent));
      if (salvar) salvar.click();
    });
    await sp.waitForTimeout(1500);
    const noKanban = await sp.evaluate(() => (document.getElementById('crm_kanban_container')?.innerText || '').includes('Cliente Varredura'));
    const noStorage = await sw.evaluate(async () => { const all = await chrome.storage.local.get(null); return JSON.stringify(Object.entries(all).filter(([k]) => /crm/i.test(k)).map(([, v]) => v)).includes('Cliente Varredura'); });
    crmOk = noKanban || noStorage;
    crmDet += ` noKanban=${noKanban} noStorage=${noStorage}`;
  }
  conf('crm: novo contato abre formulário e salva', crmOk, crmDet);
  await shot('i-crm');
  // fecha o modal de sucesso (fica por cima das telas seguintes)
  await sp.evaluate(() => { const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /^fechar$/i.test(x.textContent.trim())); if (b) b.click(); });
  await sp.waitForTimeout(500);

  // ── tasks: criar tarefa ────────────────────────────────────────────────────
  await view('tasks');
  await sp.waitForTimeout(800);
  const taskUi = await sp.evaluate(() => {
    const vis = (sel) => [...document.querySelectorAll('#whlViewTasks ' + sel)].filter((x) => x.offsetParent !== null);
    const add = vis('button').find((x) => /nova|adicionar|\+|criar/i.test(x.textContent));
    if (add) { add.click(); return add.textContent.trim(); }
    return null;
  });
  await sp.waitForTimeout(900);
  const taskForm = await sp.evaluate(() => {
    const vis = [...document.querySelectorAll('input, textarea')].filter((x) => x.offsetParent !== null);
    const titulo = vis.find((x) => /t[íi]tulo|title|tarefa|descri/i.test(x.placeholder + x.id + x.name)) || vis[0];
    if (!titulo) return null;
    titulo.value = 'Tarefa da varredura';
    titulo.dispatchEvent(new Event('input', { bubbles: true }));
    const salvar = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /salvar|adicionar|criar|save/i.test(x.textContent));
    if (salvar) { salvar.click(); return true; }
    return false;
  });
  await sp.waitForTimeout(1500);
  await view('tasks'); // reentra: a lista recarrega da fonte
  await sp.waitForTimeout(800);
  const taskCriada = await sp.evaluate(() => ({
    naLista: (document.getElementById('tasks_container')?.innerText || '').includes('Tarefa da varredura'),
    total: document.getElementById('stat_total')?.textContent?.trim(),
  }));
  conf('tarefas: criar pela tela funciona e aparece na lista', !!taskUi && taskForm === true && taskCriada.naLista, `botao="${taskUi}" form=${taskForm} ${JSON.stringify(taskCriada)}`);
  await shot('i-tasks');

  // ── quickreplies: criar resposta rápida ───────────────────────────────────
  await view('quickreplies');
  await sp.waitForTimeout(800);
  const qrAdd = await sp.evaluate(() => {
    const vis = (sel) => [...document.querySelectorAll('#whlViewQuickReplies ' + sel)].filter((x) => x.offsetParent !== null);
    const add = vis('button').find((x) => /nova|adicionar|\+|criar/i.test(x.textContent)) || vis('button')[0];
    if (add) { add.click(); return add.textContent.trim(); }
    return null;
  });
  await sp.waitForTimeout(900);
  const qrForm = await sp.evaluate(() => {
    const raiz = document.getElementById('whlViewQuickReplies') || document;
    const vis = (sel) => [...raiz.querySelectorAll(sel)].filter((x) => x.offsetParent !== null);
    const atalho = vis('input')[0];
    const texto = vis('textarea')[0] || vis('input')[1];
    if (!atalho || !texto) return null;
    const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    set(atalho, 'oi');
    set(texto, 'Olá! Como posso ajudar?');
    const salvar = vis('button').find((x) => /salvar|save/i.test(x.textContent));
    if (salvar) { salvar.click(); return true; }
    return false;
  });
  await sp.waitForTimeout(1200);
  const qrSalva = await sw.evaluate(async () => { const all = await chrome.storage.local.get(null); return JSON.stringify(Object.entries(all).filter(([k]) => /quick|replies|canned/i.test(k)).map(([, v]) => v)).includes('Como posso ajudar'); });
  const qrNaTela = await sp.evaluate(() => ((document.getElementById('whlViewQuickReplies')?.innerText) || '').includes('Como posso ajudar'));
  conf('respostas rápidas: criar pela tela salva', qrForm === true && (qrSalva || qrNaTela), `botao="${qrAdd}" form=${qrForm} salvaNoStorage=${qrSalva} naTela=${qrNaTela}`);
  await shot('i-quickreplies');

  // ── ai / autopilot: salvar configurações persiste ─────────────────────────
  await view('autopilot');
  const apAntes = await storage('whl_autopilot_config');
  await sp.evaluate(() => {
    const vis = [...document.querySelectorAll('#whlViewAutoPilot input')].filter((x) => x.offsetParent !== null);
    const num = vis.find((x) => x.type === 'number');
    if (num) { num.value = '9'; num.dispatchEvent(new Event('input', { bubbles: true })); num.dispatchEvent(new Event('change', { bubbles: true })); }
    const salvar = [...document.querySelectorAll('#whlViewAutoPilot button')].filter((x) => x.offsetParent !== null).find((x) => /salvar|aplicar|save/i.test(x.textContent));
    if (salvar) salvar.click();
  });
  await sp.waitForTimeout(1500);
  const apStatus = await sp.evaluate(() => ({
    texto: document.getElementById('autopilot_status_text')?.textContent?.trim() || '',
    detalhe: (document.getElementById('autopilot_status_detail')?.textContent || '').trim().slice(0, 60),
    botoes: [...document.querySelectorAll('#whlViewAutoPilot button')].filter((x) => x.offsetParent !== null).map((b) => b.textContent.trim()).slice(0, 5),
  }));
  conf('autopilot: cartão de status mostra o estado real (não fica vazio)', apStatus.texto.length > 0 && apStatus.botoes.length > 0, JSON.stringify(apStatus) + ` storageAntes=${apAntes ? 'tinha' : 'vazio'}`);

  // ── backend: estado de conexão verdadeiro ─────────────────────────────────
  await view('backend');
  await sp.waitForTimeout(1500);
  const backendTxt = await sp.evaluate(() => (document.getElementById('whlViewBackend')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
  conf('servidor: tela mostra sessão conectada', /conectado|online|ativo|logado|sincroniza/i.test(backendTxt) && !/desconectado|offline/i.test(backendTxt.split('Sincronizar')[0] || backendTxt), `texto="${backendTxt.slice(0, 120)}"`);
  await shot('i-backend');

  // ── popup: plano e estado ─────────────────────────────────────────────────
  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 400, height: 600 });
  await pop.goto(`chrome-extension://${extId}/popup/popup.html`);
  await pop.waitForTimeout(2500);
  const popTxt = await pop.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const popBtns = await pop.evaluate(() => [...document.querySelectorAll('button, a, [role="button"]')].filter((x) => x.offsetParent !== null).length);
  conf('popup: renderiza versão, status e ações', /v\d+\.\d+/.test(popTxt) && /status/i.test(popTxt) && popBtns >= 3, `botoes=${popBtns} texto="${popTxt.slice(0, 120)}"`);
  if (OUT) await pop.screenshot({ path: path.join(OUT, 'i-popup.png') }).catch(() => {});

  await ctx.close();
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} interações passaram`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
