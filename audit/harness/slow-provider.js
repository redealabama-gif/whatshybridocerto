#!/usr/bin/env node
/**
 * Auditoria IA — provedor LENTO (fake-provider modo "slow": 50 s por resposta):
 * quanto tempo uma sugestão leva e quantas chamadas faz ao provedor.
 * Uso (na raiz): node audit/harness/slow-provider.js [backend] [fake] [arquivo-saida]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const B = process.argv[2] || 'http://127.0.0.1:3000';
const F = process.argv[3] || 'http://127.0.0.1:18080';
const OUTF = process.argv[4] || path.resolve(__dirname, '../evidencias/fase2/matriz/22-provedor-lento-depois.txt');
async function http(method, url, body, token) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(900000) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
(async () => {
  const su = await http('POST', `${B}/api/v1/auth/signup`, { email: `slow${Date.now()}@audit.test`, password: 'Audit#Senha2026', name: 'Loja Lenta', company: 'Loja Lenta', plan: 'pro' });
  await fetch(`${F}/__reset`); await fetch(`${F}/__mode?m=slow`);
  const t0 = Date.now();
  const r = await http('POST', `${B}/api/v2/ai/process`, { chatId: '5511977770000@c.us', message: 'Comprei semana passada e até agora não chegou, estou bem chateado', language: 'pt-BR' }, su.json.accessToken);
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  const calls = (await (await fetch(`${F}/__log`)).json()).length;
  await fetch(`${F}/__mode?m=ok`);
  const line = `duração=${secs}s chamadas_ao_provedor=${calls} status=${r.status} resposta=${JSON.stringify(r.json).slice(0, 300)}`;
  fs.mkdirSync(path.dirname(OUTF), { recursive: true });
  fs.writeFileSync(OUTF, line + '\n');
  console.log(line);
})().catch((e) => { console.error(e); process.exit(1); });
