#!/usr/bin/env node
/**
 * Verificação de aceitação — TREINAMENTO pela tela real, com IA real.
 *
 * Extensão REAL no Chromium + backend real + modelo real. Roteiro de uso:
 *   1. WhatsApp Web (simulado) aberto; na tela de treinamento cadastra pela
 *      interface FAQ, produto, exemplo e dados do negócio; importa CSV de FAQs,
 *      XLSX de produtos (cabeçalho "Preço" com acento, célula em R$) e TXT com
 *      uma política (parágrafo de conhecimento).
 *   2. Sugestão REAL (botão 🤖) sobre preço e parcelamento → o que chegou ao
 *      modelo (log de log-fetch.js) e o que ele respondeu.
 *   3. Apaga uma FAQ pela interface → some da base local e do banco, e não volta.
 *   4. Fecha o WhatsApp, cadastra outra FAQ (WhatsApp fechado), reabre o
 *      WhatsApp → a base local continua inteira (sem apagar, sem reverter).
 *   5. Sugestão REAL sobre o TXT (remarcação) e o sábado.
 *   6. Reabre a tela de treinamento → mostra tudo.
 * Em cada fase: base local (o que o Autopilot usa), tabelas do banco (o que a
 * IA do servidor usa) e uma linha do tempo de quem gravou a base local.
 *
 * Uso: node audit/harness/training-ui-real.js <backend> <db-path> <provider-log> [saida.json]
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const B = process.argv[2] || 'http://127.0.0.1:3000';
const DB_PATH = process.argv[3];
const PROVIDER_LOG = process.argv[4];
const OUT = process.argv[5] || path.resolve(__dirname, '../evidencias/fase3/61-treinamento-tela-real.json');
const SRC_EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const XLSX = require(path.join(SRC_EXT, 'lib/xlsx.mini.min.js'));
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-treino-'));

const TELA = {
  faq: { q: 'Qual o horário de funcionamento?', a: 'Atendemos de segunda a sexta, das 8h às 18h, e aos sábados das 8h às 12h.' },
  produto: { nome: 'Limpeza (profilaxia)', preco: '180', descricao: 'Limpeza completa com raspagem e polimento.' },
  exemplo: { in: 'Tem horário no sábado?', out: 'Tem sim! Sábado das 8h às 12h. Quer que eu já reserve um horário?' },
  negocio: { nome: 'Clínica Sorriso Fácil', segmento: 'Odontologia', descricao: 'Clínica odontológica no Centro', horario: 'Seg a sex 8h–18h; sáb 8h–12h' },
  faqWhatsFechado: { q: 'Vocês fazem atendimento de urgência?', a: 'Sim, urgências no mesmo dia, de segunda a sábado.' },
};
const CSV = 'pergunta,resposta\n"Vocês parcelam no cartão?","Sim, parcelamos em até 6x sem juros no cartão."\n"Vocês aceitam convênio?","Aceitamos Amil Dental, OdontoPrev e SulAmérica Odonto."\n';
const TXT = 'Política de remarcação da Clínica Sorriso Fácil\n\nRemarcações são gratuitas quando avisadas com pelo menos 24 horas de antecedência. Faltas sem aviso ou remarcações em cima da hora pagam uma taxa de R$ 50,00, descontada na próxima consulta.\n';
function xlsxBuffer() {
  // Como uma planilha brasileira chega: cabeçalho com acento e preço em R$.
  const ws = XLSX.utils.aoa_to_sheet([['Nome', 'Preço', 'Descrição'], ['Clareamento dental', 650, 'Clareamento no consultório, sessão de 1 hora']]);
  ws.B2.z = '"R$" #,##0.00';
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Conversas no WhatsApp simulado (formato atual da página).
const CONV1 = [
  ['in', 'Boa tarde! Vi o perfil de vocês no Instagram'],
  ['out', 'Boa tarde! Que bom que chamou 😊 Como posso ajudar?'],
  ['in', 'Quanto custa o clareamento dental? E vocês parcelam no cartão?'],
];
const CONV2 = [
  ['in', 'Oi, marquei uma limpeza pra quinta'],
  ['out', 'Oi! Isso, quinta às 10h 😊'],
  ['in', 'Se eu precisar remarcar, tem algum custo? E vocês atendem no sábado?'],
];
const bubble = ([dir, text], i) => `<div role="row"><div data-id="3EB0TR${String(i).padStart(14, '0')}">${i === 0 ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[14:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const waHtml = (conv, nome) => `<html><head></head><body><div id="main"><header><span title="${nome}">${nome}</span></header>
<div data-testid="conversation-panel-messages">${conv.map(bubble).join('')}</div>
<footer><div contenteditable="true" role="textbox" data-testid="conversation-compose-box-input"></div></footer></div></body></html>`;

async function http(method, url, body, token) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const logLines = () => (PROVIDER_LOG && fs.existsSync(PROVIDER_LOG) ? fs.readFileSync(PROVIDER_LOG, 'utf8').split('\n').filter(Boolean) : []);

(async () => {
  const su = await http('POST', `${B}/api/v1/auth/signup`, { email: `treino-${Date.now()}@example.com`, password: 'Audit#Senha2026', name: 'Clinica Sorriso Facil', company: 'Clinica Sorriso Facil', plan: 'pro' });
  const token = su.json.accessToken;
  const ws = su.json.user.workspaceId || (su.json.workspace && su.json.workspace.id);

  const extDir = path.join(SCRATCH, 'ext');
  fs.cpSync(SRC_EXT, extDir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  const ctx = await chromium.launchPersistentContext(path.join(SCRATCH, 'profile'), {
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  // Registra TODA gravação de whl_knowledge_base (formato e conteúdo).
  await sw.evaluate(() => {
    self.__kbWrites = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.whl_knowledge_base) return;
      let v = changes.whl_knowledge_base.newValue; const tipo = typeof v; if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = {}; } }
      const ks = v && typeof v === 'object' ? Object.keys(v) : [];
      self.__kbWrites.push({ t: Date.now(), tipo, faq: (v && v.faq || []).length, products: (v && v.products || []).length, business: !!(v && v.business && v.business.name), nChaves: ks.length, numericas: ks.filter((k) => /^\d+$/.test(k)).length });
    });
  });
  const marks = [];
  const mark = (m) => marks.push({ t: Date.now(), m });
  await sw.evaluate(async ({ base, token, user, workspace }) => {
    await chrome.storage.local.set({
      whl_backend_client: JSON.stringify({ baseUrl: base, accessToken: token, refreshToken: null, user, workspace }),
      whl_backend_url: base,
      whl_subscription: { planId: 'pro', status: 'active' },
    });
  }, { base: B, token, user: su.json.user, workspace: su.json.workspace });

  let waBody = waHtml(CONV1, 'Cliente Clínica');
  const abreWhatsApp = async () => {
    const p = await ctx.newPage();
    await p.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: waBody }));
    await p.goto('https://web.whatsapp.com/');
    return p;
  };
  const passos = [];
  const passo = async (nome, fn) => { try { await fn(); passos.push({ passo: nome, ok: true }); } catch (e) { passos.push({ passo: nome, ok: false, erro: e.message.split('\n')[0].slice(0, 200) }); } };

  // Fotografia: base local (Autopilot) + banco (IA do servidor).
  const foto = async (rotulo) => {
    const local = await sw.evaluate(async () => {
      const r = await chrome.storage.local.get('whl_knowledge_base');
      let kb = r.whl_knowledge_base; const tipo = typeof kb;
      if (typeof kb === 'string') { try { kb = JSON.parse(kb); } catch (_) { kb = {}; } }
      const ks = kb && typeof kb === 'object' ? Object.keys(kb) : [];
      const faqs = (kb && Array.isArray(kb.faq) ? kb.faq : []);
      return { tipo, nChaves: ks.length, numericas: ks.filter((k) => /^\d+$/.test(k)).length,
        faq: faqs.map((f) => f.question || f.q),
        faqUsavelPeloAutopilot: faqs.filter((f) => f && (f.question || f.q) && (f.answer || f.a)).length,
        produtos: (kb && Array.isArray(kb.products) ? kb.products : []).map((p) => `${p.name} = ${p.price}`) };
    });
    let banco = null;
    if (DB_PATH) {
      const Database = require(path.resolve(__dirname, '../../node_modules/better-sqlite3'));
      const db = new Database(DB_PATH, { readonly: true });
      const row = db.prepare('SELECT data FROM workspace_knowledge WHERE workspace_id = ?').get(ws);
      let blob = null; try { blob = row && JSON.parse(row.data); } catch (_) { blob = 'inválido'; }
      banco = { faqs: db.prepare('SELECT question FROM faqs WHERE workspace_id = ? ORDER BY question').all(ws).map((r) => r.question),
        produtos: db.prepare('SELECT name, price FROM products WHERE workspace_id = ? ORDER BY name').all(ws).map((r) => `${r.name} = ${r.price}`),
        exemplos: db.prepare('SELECT input FROM training_examples WHERE workspace_id = ?').all(ws).map((r) => r.input),
        negocio: blob && typeof blob === 'object' ? { nome: blob.name || null, temTextoDoTxt: /remarca/i.test(String(blob.extraNotes || '')) } : blob };
      db.close();
    }
    mark(`foto: ${rotulo}`);
    return { rotulo, local, banco };
  };

  // Sugestão real: clica 🤖 e lê o que chegou ao modelo.
  const sugestao = async (page, checks) => {
    await page.bringToFront();
    const logStart = logLines().length;
    const btn = await page.waitForSelector('#whl-ai-btn-fixed', { timeout: 30000 }).catch(() => null);
    if (!btn) return { erro: 'botão 🤖 não apareceu' };
    mark('clica 🤖');
    // Os avisos de integração da extensão (página simulada, sem a Store do WhatsApp) ficam por cima do botão.
    await btn.dispatchEvent('click');
    await page.waitForTimeout(20000);
    const painel = await page.evaluate(() => document.getElementById('whl-ai-panel-fixed')?.innerText?.slice(0, 600) || null);
    const gen = logLines().slice(logStart).map((l) => JSON.parse(l)).filter((e) => (e.messages || []).some((m) => m.role === 'system'));
    const c = gen[gen.length - 1];
    if (!c) return { painel, erro: 'nenhuma chamada ao modelo registrada' };
    const sys = ((c.messages || []).find((m) => m.role === 'system') || {}).content || '';
    const ini = sys.indexOf('# Relevant Knowledge');
    const fim = ini >= 0 ? sys.indexOf('\n---', ini) : -1;
    const conhecimento = ini >= 0 ? sys.slice(ini, fim > 0 ? fim : ini + 1500) : null;
    return { painel, model: c.model, status: c.status, resposta: c.reply,
      noPrompt: Object.fromEntries(Object.entries(checks).map(([k, re]) => [k, re.test(sys)])), conhecimento };
  };

  // ── 1) WhatsApp aberto; cadastro pela tela de treinamento ──────────────────
  mark('abre WhatsApp');
  let wa = await abreWhatsApp();
  await wa.waitForTimeout(3000);
  mark('abre treinamento');
  const tr = await ctx.newPage();
  const trLogs = [];
  tr.on('console', (m) => trLogs.push(m.text().slice(0, 200)));
  tr.on('pageerror', (e) => trLogs.push('PAGEERROR ' + e.message.slice(0, 160)));
  tr.on('dialog', (d) => d.accept().catch(() => {}));
  await tr.goto(`chrome-extension://${extId}/training/training.html`);
  await tr.waitForFunction(() => typeof app !== 'undefined' && app, null, { timeout: 15000 });

  await passo('FAQ pela interface', async () => {
    await tr.click('[data-tab="faqs"]'); await tr.click('#btnAddFaq');
    await tr.fill('#faqQuestion', TELA.faq.q); await tr.fill('#faqAnswer', TELA.faq.a); await tr.click('#btnSaveFaq');
  });
  await passo('produto pela interface', async () => {
    await tr.click('[data-tab="products"]'); await tr.click('#btnAddProduct');
    await tr.fill('#productName', TELA.produto.nome); await tr.fill('#productPrice', TELA.produto.preco); await tr.fill('#productDescription', TELA.produto.descricao);
    await tr.click('#btnSaveProduct');
  });
  await passo('exemplo pela interface', async () => {
    await tr.click('[data-tab="examples"]'); await tr.click('#btnAddExample');
    await tr.fill('#exampleInput', TELA.exemplo.in); await tr.fill('#exampleOutput', TELA.exemplo.out); await tr.click('#btnSaveExample');
  });
  await passo('dados do negócio pela interface', async () => {
    await tr.click('[data-tab="business"]');
    await tr.fill('#businessName', TELA.negocio.nome); await tr.fill('#businessSegment', TELA.negocio.segmento);
    await tr.fill('#businessDescription', TELA.negocio.descricao); await tr.fill('#businessHours', TELA.negocio.horario);
    await tr.click('#btnSaveBusiness');
  });
  await passo('importar CSV de FAQs', async () => {
    await tr.click('[data-tab="import"]');
    await tr.setInputFiles('#fileInput', { name: 'faqs.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
    await tr.waitForTimeout(2500);
  });
  await passo('importar XLSX de produtos ("Preço" com acento, célula em R$)', async () => {
    const xf = path.join(SCRATCH, 'produtos.xlsx'); fs.writeFileSync(xf, xlsxBuffer());
    await tr.setInputFiles('#fileInput', xf);
    await tr.waitForTimeout(2500);
  });
  await passo('importar TXT (política de remarcação)', async () => {
    const tf = path.join(SCRATCH, 'politica.txt'); fs.writeFileSync(tf, TXT);
    await tr.setInputFiles('#fileInput', tf);
    await tr.waitForTimeout(2500);
  });
  mark('fim do cadastro');
  await tr.waitForTimeout(4000); // auto-sync do treino (2 s) + resposta do backend
  const fotos = [await foto('depois do cadastro')];

  // ── 2) Sugestão real: preço + parcelamento ─────────────────────────────────
  const sugestao1 = await sugestao(wa, { preco650: /650/, parcela6x: /6x/, limpeza180: /180/, negocio: /Sorriso Fácil/ });
  fotos.push(await foto('depois da sugestão 1'));

  // ── 3) Apagar uma FAQ pela interface ───────────────────────────────────────
  await passo('abrir a FAQ "convênio" para editar (aparece o botão Excluir)', async () => {
    await tr.bringToFront();
    await tr.click('[data-tab="faqs"]');
    await tr.click('.faq-card:has-text("convênio")');
    await tr.waitForSelector('#btnDeleteFaq', { state: 'visible', timeout: 5000 });
  });
  await passo('excluir a FAQ "convênio"', async () => { await tr.click('#btnDeleteFaq', { timeout: 5000 }); });
  mark('apagou FAQ');
  await tr.waitForTimeout(15000); // sync do treino (2 s) + envio do WhatsApp (10 s)
  fotos.push(await foto('15 s depois de apagar a FAQ'));

  // ── 4) Fecha o WhatsApp, treina mais, reabre o WhatsApp ────────────────────
  await wa.close();
  mark('fechou WhatsApp');
  await passo('FAQ nova com o WhatsApp fechado', async () => {
    await tr.bringToFront();
    await tr.click('[data-tab="faqs"]'); await tr.click('#btnAddFaq');
    await tr.fill('#faqQuestion', TELA.faqWhatsFechado.q); await tr.fill('#faqAnswer', TELA.faqWhatsFechado.a); await tr.click('#btnSaveFaq');
  });
  await tr.waitForTimeout(5000);
  fotos.push(await foto('WhatsApp fechado, FAQ nova salva'));
  waBody = waHtml(CONV2, 'Paciente Quinta');
  mark('reabre WhatsApp');
  wa = await abreWhatsApp();
  await wa.waitForTimeout(16000); // pulls de +2/+3 s e envio (10 s)
  fotos.push(await foto('16 s depois de reabrir o WhatsApp'));

  // ── 5) Sugestão real: TXT (remarcação) + sábado ────────────────────────────
  const sugestao2 = await sugestao(wa, { txtRemarcacao24h: /24 horas/, txtTaxa50: /50,00|R\$ ?50/, sabado: /s[áa]b(ado)?\.? ?(das )?8h/i });
  fotos.push(await foto('depois da sugestão 2'));

  // ── 6) Reabre a tela de treinamento ────────────────────────────────────────
  mark('reabre treinamento');
  const tr2 = await ctx.newPage();
  await tr2.goto(`chrome-extension://${extId}/training/training.html`);
  await tr2.waitForFunction(() => typeof app !== 'undefined' && app && app.faqs, null, { timeout: 15000 }).catch(() => {});
  await tr2.waitForTimeout(6000);
  const telaReaberta = await tr2.evaluate(() => ({ faqs: (app.faqs || []).map((f) => f.question || f.q), produtos: (app.products || []).map((p) => `${p.name} = ${p.price}`), exemplos: (app.examples || []).length })).catch((e) => `erro: ${e.message}`);
  fotos.push(await foto('treinamento reaberto (+6 s)'));

  const kbWrites = await sw.evaluate(() => self.__kbWrites || []);
  await ctx.close();
  const t0 = marks.length ? marks[0].t : 0;
  const linhaDoTempo = [...marks.map((m) => ({ t: m.t - t0, evento: m.m })), ...kbWrites.map((w) => ({ t: w.t - t0, evento: `storage whl_knowledge_base ← (${w.tipo}) faq=${w.faq} produtos=${w.products} negócio=${w.business} chaves=${w.nChaves}${w.numericas ? ` (${w.numericas} de caractere!)` : ''}` }))].sort((a, b) => a.t - b.t);

  const out = { generatedAt: new Date().toISOString(), passos, sugestao1, sugestao2, fotos, telaReaberta, linhaDoTempo,
    logsTreino: trLogs.filter((l) => /erro|error|falh|PAGEERROR/i.test(l)).slice(-15) };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
