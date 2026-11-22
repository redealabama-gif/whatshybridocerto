/**
 * SITE-03c — todas as páginas contra o backend REAL: as fontes aplicam vindo
 * da cópia local, a CSP não registra violação e nenhuma delas pede nada para
 * fora.
 *
 * Roda o backend antes (na raiz):
 *   bash audit/harness/start-backend.sh /tmp/x 3177 18177 &
 *   node audit/harness/paginas-fontes-csp.js [http://127.0.0.1:3177]
 */
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:3177').replace(/\/$/, '');
const PAGINAS = ['index.html','login.html','signup.html','help.html','privacy.html',
                 'terms.html','forgot-password.html','reset-password.html','dashboard.html','admin/'];
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const falhas = [];
  for (const pg of PAGINAS) {
    const page = await ctx.newPage();
    const violacoes = [], externos = [];
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) =>
        window.__csp.push(e.violatedDirective + ' → ' + e.blockedURI));
    });
    page.on('request', (r) => {
      const u = r.url();
      // accounts.google.com é o SDK do "Entrar com Google" — recurso de
      // propósito, que por natureza tem de vir do Google. Não é fonte.
      if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')
          && !u.startsWith('https://accounts.google.com/')) externos.push(u);
    });
    await page.goto(BASE + '/' + pg, { waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(1800);
    const r = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        fontes: [...new Set([...document.fonts].map((f) => f.family.replace(/['"]/g, '')))],
        csp: window.__csp || [],
        url: location.pathname,
      };
    }).catch((e) => ({ erro: e.message }));
    const v = (r.csp || []).concat(violacoes);
    const ext = [...new Set(externos.map((u) => new URL(u).host))];
    const ok = (r.fontes || []).length > 0 && v.length === 0 && ext.length === 0;
    console.log(`${ok ? '✓' : '✗'} ${pg.padEnd(22)} fontes=${JSON.stringify(r.fontes||[])} csp=${v.length} externos=${JSON.stringify(ext)}`);
    if (!ok) falhas.push(pg + ': ' + JSON.stringify({ fontes: r.fontes, csp: v, ext }));
    await page.close();
  }
  console.log(falhas.length ? '\nFALHAS:\n  ' + falhas.join('\n  ') : '\nTODAS AS PÁGINAS: fontes locais, zero violação de CSP, zero pedido externo');
  await b.close();
  process.exit(falhas.length ? 1 : 0);
})();
