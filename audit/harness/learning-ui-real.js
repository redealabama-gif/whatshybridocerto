#!/usr/bin/env node
/**
 * Verificação de aceitação — APRENDIZADO com 👍/👎 pela tela real, com IA real.
 *
 * Extensão REAL no Chromium + backend real + modelo real, WhatsApp simulado.
 *   1. Pergunta sem treino ("Vocês têm estacionamento?") → 🤖 → ✏️ Editar com a
 *      resposta certa → ✅ Aprovar. Confere o que o backend respondeu ao feedback
 *      e o que ficou gravado (ai_feedback, learned_examples).
 *   2. Outro contato pergunta o mesmo com outras palavras → 🤖 → a correção chegou
 *      ao prompt? O modelo a usou?
 *   3. ✅ Aprovar sem editar, 5 vezes, a mesma pergunta em contatos diferentes →
 *      o padrão gradua (learning_patterns) e aparece no prompt seguinte (few-shot)?
 *   4. ❌ Reprovar → o feedback negativo é gravado?
 *
 * Uso: node audit/harness/learning-ui-real.js <backend> <db-path> <provider-log> <server-log> [saida.json]
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const B = process.argv[2] || 'http://127.0.0.1:3000';
const DB_PATH = process.argv[3];
const PROVIDER_LOG = process.argv[4];
const SERVER_LOG = process.argv[5];
const OUT = process.argv[6] || path.resolve(__dirname, '../evidencias/fase3/62-aprendizado-tela-real.json');
const SRC_EXT = path.resolve(__dirname, '../../whatshybrid-extension');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-aprende-'));

const CORRECAO = 'Temos sim! Estacionamento conveniado na Rua das Flores, 120 — 2 horas grátis com o tíquete da recepção.';
const PERGUNTA_APROVAR = 'Quanto tempo dura a consulta de avaliação?';

const bubble = ([dir, text], i) => `<div role="row"><div data-id="3EB0LR${String(i).padStart(14, '0')}">${i === 0 ? '<div data-testid="msg-container">' : '<div>'}
  <div class="copyable-text" data-pre-plain-text="[15:0${i}] X: "><span class="selectable-text copyable-text"><span>${text}</span></span></div>
  ${dir === 'out' ? '<span data-icon="msg-dblcheck"></span>' : ''}</div></div></div>`;
const waHtml = (conv, nome) => `<html><head></head><body><div id="main"><header><span title="${nome}">${nome}</span></header>
<div data-testid="conversation-panel-messages">${conv.map(bubble).join('')}</div>
<footer><div contenteditable="true" role="textbox" data-testid="conversation-compose-box-input"></div></footer></div></body></html>`;

const logLines = (f) => (f && fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
const feedbackHttp = (desde) => logLines(SERVER_LOG).slice(desde).filter((l) => /\/api\/v1\/ai\/learn\/feedback/.test(l))
  .map((l) => (l.match(/"POST \/api\/v1\/ai\/learn\/feedback HTTP\/1\.1" (\d{3})/) || [])[1]).filter(Boolean);

(async () => {
  const su = await (await fetch(`${B}/api/v1/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `aprende-${Date.now()}@example.com`, password: 'Audit#Senha2026', name: 'Clinica Sorriso Facil', company: 'Clinica Sorriso Facil', plan: 'pro' }) })).json();
  const ws = su.user.workspaceId || (su.workspace && su.workspace.id);
  const extDir = path.join(SCRATCH, 'ext');
  fs.cpSync(SRC_EXT, extDir, { recursive: true, filter: (s) => !s.includes('node_modules') });
  const ctx = await chromium.launchPersistentContext(path.join(SCRATCH, 'profile'), {
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium', headless: true,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  await sw.evaluate(async ({ base, s }) => chrome.storage.local.set({
    whl_backend_client: JSON.stringify({ baseUrl: base, accessToken: s.accessToken, refreshToken: null, user: s.user, workspace: s.workspace }),
    whl_backend_url: base, whl_subscription: { planId: 'pro', status: 'active' },
  }), { base: B, s: su });

  const db = () => {
    const Database = require(path.resolve(__dirname, '../../node_modules/better-sqlite3'));
    const d = new Database(DB_PATH, { readonly: true });
    const q = (sql) => { try { return d.prepare(sql).all(ws); } catch (e) { return `erro: ${e.message}`; } };
    const out = {
      ai_feedback: q('SELECT rating, feedback_type, chat_id, substr(corrected_response,1,40) AS corrigida FROM ai_feedback WHERE workspace_id = ?'),
      learned_examples: q('SELECT substr(input,1,50) AS input, substr(output,1,50) AS output FROM learned_examples WHERE workspace_id = ?'),
      learning_patterns: q('SELECT pattern_key, positive_count, negative_count, total_count, status FROM learning_patterns WHERE workspace_id = ?'),
    };
    d.close();
    return out;
  };

  // Abre uma conversa nova (página nova) e pede a sugestão.
  const pedir = async (conv, nome) => {
    const p = await ctx.newPage();
    await p.route('https://web.whatsapp.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: waHtml(conv, nome) }));
    await p.goto('https://web.whatsapp.com/');
    const btn = await p.waitForSelector('#whl-ai-btn-fixed', { timeout: 30000 });
    const ini = logLines(PROVIDER_LOG).length;
    await btn.dispatchEvent('click'); // os avisos de integração (página sem a Store) cobrem o botão
    await p.waitForSelector('#whl-ai-sug-approve', { timeout: 45000 }).catch(() => null);
    await p.waitForTimeout(500);
    const gen = logLines(PROVIDER_LOG).slice(ini).map((l) => JSON.parse(l)).filter((e) => (e.messages || []).some((m) => m.role === 'system'));
    const c = gen[gen.length - 1] || {};
    const sys = ((c.messages || []).find((m) => m.role === 'system') || {}).content || '';
    return { p, sugestao: c.reply || null, sys };
  };
  const clicar = async (p, sel) => {
    await p.$eval(sel, (b) => b.click());
    // Aprovar digita o texto no campo "como humano" e só depois envia o feedback:
    // espera o painel fechar e mais um pouco para a requisição sair.
    if (sel !== '#whl-ai-sug-edit') await p.waitForFunction(() => !document.getElementById('whl-ai-sug-approve'), null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(2500);
  };

  const out = { generatedAt: new Date().toISOString() };

  // 1) Editar + Aprovar
  let l0 = logLines(SERVER_LOG).length;
  const a = await pedir([['in', 'Oi! Vou na avaliação amanhã'], ['out', 'Oi! Combinado, te espero 😊'], ['in', 'Vocês têm estacionamento?']], 'Paciente A');
  await clicar(a.p, '#whl-ai-sug-edit');
  await a.p.fill('#whl-ai-sug-edit-area', CORRECAO);
  await clicar(a.p, '#whl-ai-sug-approve');
  out.editarAprovar = { sugestaoOriginal: a.sugestao, feedbackHttp: feedbackHttp(l0), banco: db() };

  // 2) Mesma dúvida com outras palavras, outro contato
  const b = await pedir([['in', 'Boa tarde, tenho horário às 15h'], ['out', 'Boa tarde! Isso, às 15h'], ['in', 'Tem onde deixar o carro aí perto?']], 'Paciente B');
  out.depoisDaCorrecao = { correcaoNoPrompt: /Rua das Flores/.test(b.sys), resposta: b.sugestao };
  await b.p.close();

  // 3) Aprovar 5× a mesma pergunta
  l0 = logLines(SERVER_LOG).length;
  const aprovacoes = [];
  for (let i = 1; i <= 5; i++) {
    const r = await pedir([['in', 'Olá, quero marcar uma avaliação'], ['out', 'Olá! Claro, posso te ajudar'], ['in', PERGUNTA_APROVAR]], `Paciente C${i}`);
    await clicar(r.p, '#whl-ai-sug-approve');
    aprovacoes.push(r.sugestao);
    await r.p.close();
  }
  await new Promise((res) => setTimeout(res, 3000));
  const seis = await pedir([['in', 'Oi, tudo bem?'], ['out', 'Oi! Tudo ótimo'], ['in', PERGUNTA_APROVAR]], 'Paciente C6');
  out.aprovarCincoVezes = { feedbackHttp: feedbackHttp(l0), sugestoes: aprovacoes, banco: db(),
    sextaVez: { fewShotNoPrompt: /Few-Shot|Exemplos aprovados|exemplos de respostas|Example/i.test(seis.sys), trechoFewShot: (seis.sys.match(/#[^\n]*(?:Few|Exemplo|Example)[^\n]*\n[\s\S]{0,400}/i) || [null])[0], resposta: seis.sugestao } };

  // 4) Reprovar
  l0 = logLines(SERVER_LOG).length;
  await clicar(seis.p, '#whl-ai-sug-reject');
  out.reprovar = { feedbackHttp: feedbackHttp(l0), banco: db().ai_feedback };

  await ctx.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
