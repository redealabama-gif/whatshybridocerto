/** Painel: saldo/uso/pacotes em respostas, plano Business e ciclo anual. */
const { chromium } = require('playwright');
const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function criarConta(plano) {
  const email = `painel-${plano}-${Date.now()}@example.com`;
  const r = await fetch(BASE + '/api/v1/auth/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Cliente#Teste2026', name: 'Dona Teste',
                           company: 'Empresa Teste', plan: plano }),
  });
  const b = await r.json();
  if (r.status !== 201) throw new Error('signup ' + plano + ' → ' + r.status + ' ' + JSON.stringify(b));
  return { email, token: b.token || b.accessToken };
}

(async () => {
  const falhas = [];
  const ok = (c, m) => { if (!c) falhas.push(m); };

  const conta = await criarConta('business');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|config\.js/.test(m.text())) erros.push('console: ' + m.text()); });

  await page.goto(BASE + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  // js/futuristic.js:60 — api.getToken() lê localStorage['wh_jwt']
  await page.evaluate((t) => localStorage.setItem('wh_jwt', t), conta.token);
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  if (/login\.html/.test(page.url())) {
    console.log('não autenticou — url:', page.url());
    console.log('chaves de storage conhecidas:', await page.evaluate(() => Object.keys(localStorage)));
    await browser.close(); process.exit(2);
  }

  // ---- aba Respostas & Uso
  await page.locator('[data-tab="tokens"]').click();
  await page.waitForTimeout(1500);

  const abaTxt = await page.locator('#tab-tokens').innerText();
  ok(!/\btokens?\b/i.test(abaTxt), 'A) aba ainda fala em token: ' + (abaTxt.match(/.{0,40}token.{0,40}/i)||[''])[0]);
  ok((await page.locator('[data-tab="tokens"]').innerText()).includes('Respostas'), 'A) rótulo da aba');

  // A conta nasce em TRIAL, então a cota é a do teste grátis (TRIAL-01), não
  // as 10.000 do plano. A cota cheia entra quando o pagamento é aprovado —
  // isso está coberto em tests/integration/cota-de-trial.spec.js.
  const COTA_TRIAL = 50;
  const saldo = (await page.locator('#tokens-balance').innerText()).trim();
  const sub = (await page.locator('#tokens-sub').innerText()).trim();
  ok(saldo === String(COTA_TRIAL), 'B) saldo mostrado: "' + saldo + '" (esperado ' + COTA_TRIAL + ')');
  ok(sub === `de ${COTA_TRIAL} respostas neste ciclo (0% usado)`, 'B) linha do saldo: "' + sub + '"');

  // Sem este aviso, quem escolheu Business veria "50" e acharia que foi enganado.
  const aviso = page.locator('#tokens-trial-aviso');
  ok(await aviso.isVisible(), 'B) aviso do trial não apareceu');
  const txtAviso = (await aviso.innerText()).trim();
  ok(txtAviso.includes('teste grátis') && txtAviso.includes('10.000'),
     'B) texto do aviso do trial: "' + txtAviso + '"');

  const cards = await page.locator('#tokens-packages-grid .card').count();
  ok(cards === 4, 'C) pacotes exibidos: ' + cards + ' (esperado 4, sem duplicata)');
  const pacTxt = await page.locator('#tokens-packages-grid').innerText();
  for (const n of ['200', '600', '2.000', '6.000']) {
    ok(pacTxt.includes(n), 'C) pacote de ' + n + ' respostas ausente');
  }
  ok(pacTxt.includes('respostas') && !/token/i.test(pacTxt), 'C) pacotes ainda em tokens');
  ok(pacTxt.includes('R$ 0,12 por resposta'), 'C) preço por resposta do pacote 200: ' + pacTxt.replace(/\n/g,' | '));

  // ---- aba Assinatura
  await page.locator('[data-tab="billing"]').click();
  await page.waitForTimeout(800);
  const nome = (await page.locator('#billing-plan-name').innerText()).trim();
  const precoAtual = (await page.locator('#billing-plan-price').innerText()).trim();
  ok(nome === 'BUSINESS', 'D) nome do plano: "' + nome + '"');
  ok(precoAtual === 'R$ 299,90/mês · 10.000 respostas por mês', 'D) preço do plano: "' + precoAtual + '"');

  const resumoMensal = (await page.locator('#ciclo-resumo').innerText()).trim();
  ok(resumoMensal.includes('R$ 299,90') && resumoMensal.includes('10.000 respostas'),
     'E) resumo mensal: "' + resumoMensal + '"');
  ok(await page.locator('#btn-avulso-label').innerText() === 'Pagamento único (1 mês)', 'E) rótulo mensal');
  ok(await page.locator('#btn-recorrente').isDisabled() === false, 'E) recorrente deveria estar ativo no mensal');

  await page.locator('[data-act="setCiclo"][data-arg="annual"]').click();
  await page.waitForTimeout(300);
  const resumoAnual = (await page.locator('#ciclo-resumo').innerText()).trim();
  ok(resumoAnual.includes('R$ 2.999,00') && resumoAnual.includes('R$ 599,80'),
     'F) resumo anual: "' + resumoAnual + '"');
  ok(await page.locator('#btn-avulso-label').innerText() === 'Pagar 12 meses agora', 'F) rótulo anual');
  ok(await page.locator('#btn-recorrente').isDisabled() === true, 'F) recorrente deveria estar travado no anual');

  await page.locator('[data-act="setCiclo"][data-arg="monthly"]').click();
  await page.waitForTimeout(300);
  ok(await page.locator('#btn-avulso-label').innerText() === 'Pagamento único (1 mês)', 'G) não voltou pro mensal');
  ok(await page.locator('#btn-recorrente').isDisabled() === false, 'G) recorrente ficou travado');

  await page.locator('[data-tab="tokens"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: (process.argv[3] || '.') + '/painel-respostas.png', fullPage: false });
  await page.locator('[data-tab="billing"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-act="setCiclo"][data-arg="annual"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: (process.argv[3] || '.') + '/painel-anual.png', fullPage: false });

  console.log('erros de página:', erros.length ? erros.join(' | ') : 'nenhum');
  console.log(falhas.length ? 'FALHAS:\n  ' + falhas.join('\n  ') : 'TODAS AS CHECAGENS PASSARAM');
  await browser.close();
  process.exit(falhas.length || erros.length ? 1 : 0);
})();
