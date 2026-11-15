#!/usr/bin/env node
/**
 * F2 — site inteiro: links, conteúdo, formulários de senha e versão celular.
 *
 * Com o backend de teste no ar:
 *  - varre TODOS os links internos de cada página (nenhum 404);
 *  - páginas de conteúdo (termos, privacidade, ajuda) têm conteúdo de verdade;
 *  - "esqueci minha senha" envia e mostra confirmação; token inválido no
 *    redefinir mostra erro claro (sem travar);
 *  - celular (390px): sem rolagem horizontal nas páginas principais e o
 *    cadastro funciona de ponta a ponta no celular;
 *  - nenhuma página com erro de console (fora os conhecidos: swagger via CDN).
 *
 * Uso (na raiz): node audit/harness/site-paginas.js http://127.0.0.1:3000 [dir-prints]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [process.cwd(), path.join(__dirname, '../..')] }));

const B = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const OUT = process.argv[3] || null;
const PAGINAS = ['index.html', 'signup.html', 'login.html', 'forgot-password.html', 'reset-password.html', 'privacy.html', 'terms.html', 'help.html', 'api-docs.html', 'dashboard.html'];

const resultados = [];
const conf = (nome, ok, detalhe) => { resultados.push({ nome, ok }); console.log(`${ok ? 'PASSOU ' : 'FALHOU '} ${nome} — ${detalhe}`); };

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const su = await (await fetch(`${B}/api/v1/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `site2-${Date.now()}@example.com`, password: 'Cliente#Teste2026', name: 'Cliente Teste', company: 'Loja Teste' }) })).json();

  const br = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

  // ── 1. Links internos de todas as páginas ─────────────────────────────────
  {
    const ctx = await br.newContext({ locale: 'pt-BR' });
    const p = await ctx.newPage();
    const vistos = new Map(); // url → status
    const origem = {};
    for (const pg of PAGINAS) {
      await p.goto(`${B}/${pg}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const links = await p.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
      for (const h of links) {
        if (!h || h.startsWith('#') || /^(mailto:|tel:|javascript:|https?:\/\/(?!127\.0\.0\.1|localhost))/.test(h)) continue;
        const url = new URL(h, `${B}/${pg}`).href.split('#')[0];
        if (!url.startsWith(B)) continue;
        if (!vistos.has(url)) { vistos.set(url, null); origem[url] = pg; }
      }
    }
    const quebrados = [];
    for (const [url] of vistos) {
      const st = await fetch(url, { redirect: 'follow' }).then((r) => r.status).catch(() => 0);
      vistos.set(url, st);
      if (st >= 400 || st === 0) quebrados.push(`${url.replace(B, '')} → ${st} (em ${origem[url]})`);
    }
    conf(`links internos das ${PAGINAS.length} páginas (${vistos.size} únicos) sem 404`, quebrados.length === 0, quebrados.length ? JSON.stringify(quebrados) : 'todos respondem');
    await ctx.close();
  }

  // ── 2. Páginas de conteúdo têm conteúdo ───────────────────────────────────
  {
    const ctx = await br.newContext({ locale: 'pt-BR' });
    const p = await ctx.newPage();
    const vazias = [];
    for (const pg of ['privacy.html', 'terms.html']) {
      await p.goto(`${B}/${pg}`, { waitUntil: 'domcontentloaded' });
      const n = await p.evaluate(() => (document.body.innerText || '').trim().length);
      if (n < 1500) vazias.push(`${pg}: ${n} caracteres`);
    }
    conf('termos e privacidade têm conteúdo de verdade', vazias.length === 0, vazias.length ? JSON.stringify(vazias) : 'ok (>1500 caracteres cada)');

    // Central de Ajuda: cada cartão "Ler guia" abre um guia com conteúdo
    await p.goto(`${B}/help.html`, { waitUntil: 'domcontentloaded' });
    const guias = await p.evaluate(() => {
      const slugs = [...document.querySelectorAll('[data-show]')].map((a) => a.dataset.show);
      const art = document.getElementById('article-content');
      const mortos = [];
      for (const slug of slugs) {
        const a = document.querySelector(`[data-show="${slug}"]`);
        a.click();
        const visivel = art && art.style.display !== 'none' && (art.innerText || '').trim().length > 120;
        if (!visivel) mortos.push(slug);
      }
      return { total: slugs.length, mortos };
    });
    conf('ajuda: todos os cartões "Ler guia" abrem um guia com conteúdo', guias.total >= 9 && guias.mortos.length === 0, JSON.stringify(guias));
    const tokensCerto = await p.evaluate(() => { document.querySelector('[data-show="tokens"]').click(); const t = document.getElementById('article-content').innerText; return { certo: /1\.800|1800/.test(t) && /25 sugest/i.test(t), errado750: /750 tokens/.test(t) }; });
    conf('ajuda: guia de tokens diz o consumo REAL (~1.800/sugestão, não 750)', tokensCerto.certo && !tokensCerto.errado750, JSON.stringify(tokensCerto));
    await ctx.close();
  }

  // ── 3. Esqueci minha senha → confirmação; token inválido → erro claro ────
  {
    const ctx = await br.newContext({ locale: 'pt-BR' });
    const p = await ctx.newPage();
    await p.goto(`${B}/forgot-password.html`);
    await p.fill('#email', su.user.email);
    await p.evaluate(() => document.querySelector('#forgot-form button[type="submit"]')?.click());
    await p.waitForTimeout(2500);
    const msg = await p.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
    conf('"esqueci minha senha" confirma o envio', /enviado|enviamos|verifique|caixa|e-?mail/i.test(msg) && !/erro/i.test(msg.slice(0, 400)), `tela="${msg.slice(0, 140)}"`);

    await p.goto(`${B}/reset-password.html?token=token-invalido-123`);
    await p.fill('#password', 'NovaSenha#2026').catch(() => {});
    await p.fill('#password2', 'NovaSenha#2026').catch(() => {});
    await p.evaluate(() => document.querySelector('#reset-form button[type="submit"]')?.click());
    await p.waitForTimeout(2500);
    const msg2 = await p.evaluate(() => [...document.querySelectorAll('.toast, [class*="toast"], [class*="error"], [role="alert"]')].map((t) => t.innerText.trim()).filter(Boolean).join(' | ') || (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
    conf('redefinir com token inválido mostra erro claro', /inválido|expirado|erro|não/i.test(msg2), `tela="${String(msg2).slice(0, 140)}"`);
    await ctx.close();
  }

  // ── 4. Celular 390px: sem rolagem horizontal + cadastro completo ─────────
  {
    const mob = { locale: 'pt-BR', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
    const ctx = await br.newContext(mob); // SEM sessão (senão o cadastro redireciona ao painel)
    const p = await ctx.newPage();
    const overflow = [];
    for (const pg of ['index.html', 'signup.html', 'login.html']) {
      await p.goto(`${B}/${pg}`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(1500);
      const extra = await p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
      if (extra > 12) overflow.push(`${pg}: +${extra}px`);
      if (OUT) await p.screenshot({ path: path.join(OUT, `mob-${pg.replace('.html', '')}.png`) }).catch(() => {});
    }
    { // painel precisa de sessão → contexto próprio
      const ctxB = await br.newContext(mob);
      await ctxB.addInitScript((s) => { try { localStorage.setItem('wh_jwt', s.accessToken); localStorage.setItem('wh_user', JSON.stringify(s.user)); } catch (_) {} }, su);
      const pb = await ctxB.newPage();
      await pb.goto(`${B}/dashboard.html`, { waitUntil: 'domcontentloaded' });
      await pb.waitForTimeout(2000);
      const extra = await pb.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
      if (extra > 12) overflow.push(`dashboard.html: +${extra}px`);
      if (OUT) await pb.screenshot({ path: path.join(OUT, 'mob-dashboard.png') }).catch(() => {});
      await ctxB.close();
    }
    conf('celular 390px: sem rolagem horizontal (início, cadastro, login, painel)', overflow.length === 0, overflow.length ? JSON.stringify(overflow) : 'ok');

    // cadastro ponta a ponta no celular
    const email = `mob-${Date.now()}@example.com`;
    await p.goto(`${B}/signup.html?plan=starter`);
    await p.waitForTimeout(1200);
    await p.fill('#company', 'Loja Celular');
    await p.fill('#name', 'Cliente Celular');
    await p.fill('#email', email);
    await p.fill('#password', 'Cliente#Teste2026');
    await p.evaluate(() => { const t = document.getElementById('terms'); if (t && !t.checked) t.click(); });
    await p.evaluate(() => document.querySelector('#form-step-1 button[type="submit"]')?.click());
    await p.waitForTimeout(700);
    await p.evaluate(() => document.querySelector('#form-step-2 button[type="submit"]')?.click());
    await p.waitForTimeout(700);
    await p.evaluate(() => document.getElementById('signup-submit')?.click());
    await p.waitForTimeout(3500);
    conf('celular: cadastro completo chega ao painel', /dashboard\.html/.test(p.url()), `url=${p.url().replace(B, '')}`);
    await ctx.close();
  }

  // ── 5. Console limpo em todas as páginas (fora conhecidos) ───────────────
  {
    const ctx = await br.newContext({ locale: 'pt-BR' });
    await ctx.addInitScript((s) => { try { localStorage.setItem('wh_jwt', s.accessToken); localStorage.setItem('wh_user', JSON.stringify(s.user)); } catch (_) {} }, su);
    const p = await ctx.newPage();
    const porPagina = {};
    let atual = null;
    p.on('console', (m) => { if (m.type() === 'error' && atual) porPagina[atual].push('console: ' + m.text().slice(0, 100)); });
    p.on('pageerror', (e) => { if (atual) porPagina[atual].push('pageerror: ' + e.message.slice(0, 100)); });
    p.on('response', (r) => { if (r.status() >= 400 && atual && r.url().startsWith(B)) porPagina[atual].push(`HTTP ${r.status()} ${r.url().replace(B, '')}`); });
    for (const pg of PAGINAS) {
      atual = pg; porPagina[pg] = [];
      await p.goto(`${B}/${pg}`, { waitUntil: 'load' }).catch(() => {});
      await p.waitForTimeout(2000);
    }
    atual = null;
    // cobe.js e robot-scene: sondagem local-primeiro documentada (Docker baixa no build; sem o arquivo cai na CDN)
    const conhecidos = /SwaggerUIBundle|swagger-ui|cdn\.jsdelivr|unpkg|esm\.sh|accounts\.google|sentry|crisp|googletagmanager|Failed to load resource|vendor\/cobe\.js|robot-scene\.splinecode/;
    const problemas = Object.entries(porPagina).map(([pg, errs]) => [pg, [...new Set(errs)].filter((e) => !conhecidos.test(e))]).filter(([, errs]) => errs.length);
    conf('nenhuma página com erro de console (fora CDNs bloqueadas aqui)', problemas.length === 0, problemas.length ? JSON.stringify(problemas).slice(0, 400) : 'ok');
    await ctx.close();
  }

  await br.close();
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length} de ${resultados.length} verificações do site passaram`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
