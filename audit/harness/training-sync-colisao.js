#!/usr/bin/env node
/**
 * Auditoria IA — POST /api/v1/training/sync quando um 2º workspace sincroniza
 * um item com o MESMO id local de outro workspace (ex.: troca de conta no mesmo
 * navegador: os ids Date.now() do chrome.storage são reaproveitados).
 * Mede: status HTTP, success, e quantas FAQs o workspace B tem antes/depois.
 * Uso (na raiz): node audit/harness/training-sync-colisao.js <db> [backend] [arquivo-saida]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Database = require(path.resolve(__dirname, '../../node_modules/better-sqlite3'));
const DB = process.argv[2];
const B = process.argv[3] || 'http://127.0.0.1:3000';
async function http(method, url, body, token) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ok: r.ok, json: await r.json().catch(() => null) };
}
(async () => {
  const t = Date.now();
  const su = async (n) => (await http('POST', `${B}/api/v1/auth/signup`, { email: `sync${n}${t}@audit.test`, password: 'Audit#Senha2026', name: `Loja Colisao ${n}`, company: `Loja Colisao ${n}`, plan: 'pro' })).json;
  const A = await su('A'); const Bw = await su('B');
  const db = new Database(DB, { readonly: true });
  const faqsOf = (ws) => db.prepare('SELECT id, question FROM faqs WHERE workspace_id = ?').all(ws);
  const out = ['# training/sync — colisão de id entre workspaces', ''];
  const r1 = await http('POST', `${B}/api/v1/training/sync`, { faqs: [{ id: `b-propria-${t}`, question: 'Qual o horário?', answer: 'Seg a Sex 9h–18h.' }] }, Bw.accessToken);
  out.push(`1. B sincroniza a própria FAQ → HTTP ${r1.status} ${JSON.stringify(r1.json)} · FAQs de B no banco: ${faqsOf(Bw.user.workspaceId).length}`);
  const r2 = await http('POST', `${B}/api/v1/training/sync`, { faqs: [{ id: String(t), question: 'Quanto custa?', answer: 'R$ 189/mês.' }] }, A.accessToken);
  out.push(`2. A sincroniza FAQ id=${t} → HTTP ${r2.status} ${JSON.stringify(r2.json)}`);
  const before = faqsOf(Bw.user.workspaceId).length;
  const r3 = await http('POST', `${B}/api/v1/training/sync`, { faqs: [{ id: `b-propria-${t}`, question: 'Qual o horário?', answer: 'Seg a Sex 9h–18h.' }, { id: String(t), question: 'Quanto custa?', answer: 'R$ 189/mês.' }] }, Bw.accessToken);
  const after = faqsOf(Bw.user.workspaceId).length;
  out.push(`3. B sincroniza [a própria FAQ + FAQ com o mesmo id local de A] → HTTP ${r3.status} (response.ok=${r3.ok}) ${JSON.stringify(r3.json)}`);
  out.push(`   FAQs de B no banco: antes=${before} → depois=**${after}**`);
  // troca de conta no mesmo navegador: B envia exatamente o conjunto local que A já sincronizou
  const before5 = faqsOf(Bw.user.workspaceId).length;
  const r5 = await http('POST', `${B}/api/v1/training/sync`, { faqs: [{ id: String(t), question: 'Quanto custa?', answer: 'R$ 189/mês.' }] }, Bw.accessToken);
  const after5 = faqsOf(Bw.user.workspaceId).length;
  out.push(`3b. B envia só o conjunto local de A (todos os ids colidem) → HTTP ${r5.status} (response.ok=${r5.ok}) ${JSON.stringify(r5.json)} · FAQs de B: antes=${before5} → depois=**${after5}**`);
  out.push(`4. Resposta do passo 3 vista pelo service worker: response.ok=${r3.ok}, success=${r3.json && r3.json.success} (o código original decidia "sincronizado" só por response.ok).`);
  db.close();
  const outFile = process.argv[4] || path.resolve(__dirname, '../evidencias/24-treinamento-sync-colisao.md');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out.join('\n') + '\n');
  console.log(out.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
