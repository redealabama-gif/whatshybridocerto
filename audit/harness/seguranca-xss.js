#!/usr/bin/env node
/**
 * F6 — XSS: nome/empresa com script malicioso NÃO executa no painel do site.
 *
 * Cadastra uma conta cujo nome e empresa carregam payloads de XSS, abre o
 * dashboard num navegador real e confere que:
 *  - nenhum alert/script do atacante disparou;
 *  - o texto aparece como TEXTO (escapado), não como HTML vivo;
 *  - nenhum elemento injetado pelo payload existe no DOM.
 *
 * Uso (na raiz): node audit/harness/seguranca-xss.js http://127.0.0.1:3000 [dir-prints]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.argv[3] || null;

const PAYLOADS = {
  nome: '<img src=x onerror="window.__xss_nome=1">Zé',
  empresa: '<script>window.__xss_empresa=1</script><b id="xss-empresa">Loja</b>',
};

const resultados = [];
const conf = (nome, ok, detalhe) => { resultados.push({ nome, ok }); console.log(`${ok ? 'PASSOU ' : 'FALHOU '} ${nome} — ${detalhe}`); };

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const email = `xss-${Date.now()}@example.com`;
  const r = await fetch(`${B}/api/v1/auth/signup`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Cliente#Teste2026', name: PAYLOADS.nome, company: PAYLOADS.empresa, plan: 'pro' }),
  });
  const su = await r.json();
  conf('cadastro com nome/empresa maliciosos é aceito ou recusado sem erro de servidor', r.status === 201 || (r.status >= 400 && r.status < 500), `status=${r.status}`);
  if (r.status !== 201) { console.log('   (servidor recusou o payload — também é defesa válida)'); }

  const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await br.newContext({ locale: 'pt-BR' });
  const alertas = [];
  if (su.accessToken) await ctx.addInitScript((s) => { try { localStorage.setItem('wh_jwt', s.accessToken); localStorage.setItem('wh_user', JSON.stringify(s.user)); } catch (_) {} }, su);
  const p = await ctx.newPage();
  p.on('dialog', (d) => { alertas.push(d.message()); d.dismiss().catch(() => {}); });

  await p.goto(`${B}/dashboard.html`);
  await p.waitForTimeout(3500);
  if (OUT) await p.screenshot({ path: path.join(OUT, 'xss-dashboard.png') }).catch(() => {});

  const estado = await p.evaluate(() => ({
    xssNome: !!window.__xss_nome,
    xssEmpresa: !!window.__xss_empresa,
    elementoInjetado: !!document.getElementById('xss-empresa'),
    imgInjetada: [...document.querySelectorAll('img')].some((i) => i.getAttribute('src') === 'x'),
    nomeMostrado: (document.getElementById('user-name')?.textContent || '').slice(0, 60),
    empresaMostrada: (document.getElementById('company-name')?.textContent || '').slice(0, 60),
  }));

  conf('nenhum script do atacante executou no painel', !estado.xssNome && !estado.xssEmpresa && alertas.length === 0,
    `xssNome=${estado.xssNome} xssEmpresa=${estado.xssEmpresa} alertas=${JSON.stringify(alertas)}`);
  conf('payload não vira elemento vivo no DOM (fica como texto)', !estado.elementoInjetado && !estado.imgInjetada,
    `elementoInjetado=${estado.elementoInjetado} imgInjetada=${estado.imgInjetada} nome="${estado.nomeMostrado}" empresa="${estado.empresaMostrada}"`);

  // entrar pelo login (sessão limpa: com sessão o login redireciona ao painel)
  const ctx2 = await br.newContext({ locale: 'pt-BR' });
  const p2 = await ctx2.newPage();
  const alertas2 = [];
  p2.on('dialog', (d) => { alertas2.push(d.message()); d.dismiss().catch(() => {}); });
  await p2.goto(`${B}/login.html`);
  await p2.waitForTimeout(1000);
  await p2.fill('#email', email);
  await p2.fill('#password', 'Cliente#Teste2026');
  await p2.evaluate(() => document.querySelector('#login-form button[type="submit"]')?.click());
  await p2.waitForTimeout(3500);
  const depoisLogin = await p2.evaluate(() => ({
    xss: !!window.__xss_nome || !!window.__xss_empresa,
    injetado: !!document.getElementById('xss-empresa'),
    url: location.pathname,
  }));
  conf('entrar pelo login com esses dados também não executa script', !depoisLogin.xss && !depoisLogin.injetado && alertas2.length === 0, JSON.stringify(depoisLogin) + ` alertas=${JSON.stringify(alertas2)}`);
  await ctx2.close();

  await br.close();
  const falhas = resultados.filter((x) => !x.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} verificações de XSS passaram`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
