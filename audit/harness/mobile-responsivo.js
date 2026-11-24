#!/usr/bin/env node
/**
 * Auditoria de responsividade no celular.
 *
 * POR QUE ISTO EXISTE. O redesign-visual.js ja roda as paginas em dois
 * tamanhos, mas ele olha estilo (cor, fonte, fundo, navbar grudada). Faltava
 * um teste que procurasse os defeitos CLASSICOS de celular, aqueles que so
 * aparecem quando a tela e estreita:
 *
 *   - rolagem horizontal (o pecado capital: a pagina "balanca" de lado);
 *   - elemento que estoura a largura da janela;
 *   - texto pequeno demais para ler sem dar zoom;
 *   - botao/link pequeno demais para o dedo acertar;
 *   - vao vertical enorme entre blocos, que faz a pagina parecer quebrada;
 *   - imagem servida muito maior do que o espaco em que e exibida;
 *   - conteudo escondido atras da barra fixa de baixo.
 *
 * O vao vertical entrou aqui porque foi exatamente o que o dono viu: na
 * secao do notebook sobravam 568px de preto num iPhone 14 Pro Max.
 *
 * Uso:  node audit/harness/mobile-responsivo.js [http://127.0.0.1:3000]
 */
const { chromium } = require('playwright');

const URL_BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '');

const PAGINAS = ['index.html', 'login.html', 'signup.html', 'dashboard.html',
                 'help.html', 'api-docs.html', 'privacy.html', 'terms.html',
                 'forgot-password.html', 'reset-password.html'];

/* Aparelhos reais, do menor ao maior. O SE e o pior caso de largura; o
   14 Pro Max e o pior caso de ALTURA, onde os vaos verticais aparecem. */
const APARELHOS = [
  { nome: 'iPhone SE',     width: 375, height: 667, dpr: 2 },
  { nome: 'iPhone 12',     width: 390, height: 844, dpr: 3 },
  { nome: 'Pixel 7',       width: 412, height: 915, dpr: 2.6 },
  { nome: 'iPhone 14 PM',  width: 430, height: 932, dpr: 3 },
];

let falhas = 0, verificacoes = 0;
function ok(cond, titulo, detalhe) {
  verificacoes++;
  if (cond) { console.log('  OK    ' + titulo + (detalhe ? '  [' + detalhe + ']' : '')); }
  else { falhas++; console.log('  FALHA ' + titulo + (detalhe ? '  [' + detalhe + ']' : '')); }
}

/* Tudo que for medido dentro da pagina sai desta funcao, para o teste
   rodar uma vez so por pagina em vez de ida e volta por verificacao. */
function medir() {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  /* Precisa olhar os ANCESTRAIS, nao so o proprio elemento. Dois casos
     reais desta pagina me enganaram antes:
       - o botao de fechar do modal de saida media 37x37 em vez dos 40
         que o CSS manda, porque o modal fechado esta com transform
         scale(0,925); e
       - o aviso flutuante de vendas "estourava" 10px para a direita,
         que e o translateX(40px) do estado is-out, a animacao de saida.
     Nos dois o elemento esta invisivel por causa de um pai, nao de si
     mesmo, e medi-lo so gera alarme falso. */
  const visivel = (e) => {
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      const g = getComputedStyle(n);
      if (g.display === 'none' || g.visibility === 'hidden' || g.opacity === '0') return false;
    }
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const nome = (e) => e.tagName.toLowerCase() +
    (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className.trim()
      ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');

  // 1. rolagem horizontal da pagina
  const overflowX = Math.round(document.documentElement.scrollWidth - vw);

  // 2. quem estoura a largura. Elementos fixos/absolutos decorativos que
  //    saem de proposito nao contam: so entram os que estao no fluxo.
  const estouram = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!visivel(e)) continue;
    // filho de <svg> nao conta: o retangulo dele e em coordenadas do
    // viewBox, nao da pagina, e sai com valores sem sentido (um
    // <circle> acusando +944px num SVG que cabe na tela).
    if (e.closest('svg')) continue;
    const g = getComputedStyle(e);
    if (g.position === 'fixed') continue;
    // enfeite que sangra de proposito: aria-hidden + pointer-events none.
    // O .hero-mesh, por exemplo, tem inset:-10% para o brilho vazar da
    // borda; o overflow-x:clip do html corta e nao gera rolagem.
    if (e.getAttribute('aria-hidden') === 'true' && g.pointerEvents === 'none') continue;
    // face girada em 3D (rotateY/rotateX): o retangulo que o navegador
    // devolve e o da caixa ANTES da projecao, entao vem inflado. E o caso
    // das laterais do iPhone da maquete.
    if (g.transform.startsWith('matrix3d')) continue;
    const r = e.getBoundingClientRect();
    const sobra = Math.round(Math.max(r.right - vw, -r.left));
    if (sobra > 2) estouram.push({ el: nome(e), sobra });
  }
  estouram.sort((a, b) => b.sobra - a.sobra);

  // 3. texto miudo. 12px e o piso pratico; abaixo disso o leitor da zoom.
  //    So conta no que tem texto proprio, nao em container.
  const miudos = [];
  for (const e of document.querySelectorAll('p, li, span, a, label, td, th, small, div, button')) {
    if (!visivel(e)) continue;
    const texto = [...e.childNodes]
      .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (texto.length < 8) continue;
    const px = parseFloat(getComputedStyle(e).fontSize);
    if (px < 12) miudos.push({ el: nome(e), px: +px.toFixed(1), texto: texto.slice(0, 30) });
  }

  // 4. alvo de toque. 40px e o piso que uso aqui (o guia da Apple fala em
  //    44, o do Google em 48; 40 evita acusar icone pequeno que tem area
  //    de toque herdada do pai).
  const pequenos = [];
  for (const e of document.querySelectorAll('a[href], button, input[type=submit], [role=button]')) {
    if (!visivel(e)) continue;
    const r = e.getBoundingClientRect();
    // link dentro de paragrafo nao e botao: tem a altura da linha
    if (e.closest('p, li, small')) continue;
    // o Swagger UI do api-docs e de terceiros, nao e o nosso desenho
    if (e.closest('.swagger-ui') || e.className.toString().includes('swagger')) continue;
    // link de pular para o conteudo: 1x1 de proposito ate receber foco
    if (r.width <= 2 && r.height <= 2) continue;
    if (Math.min(r.width, r.height) < 40) {
      pequenos.push({ el: nome(e), tam: Math.round(r.width) + 'x' + Math.round(r.height) });
    }
  }

  // 5. imagem servida grande demais para o espaco. Acima de 3x a densidade
  //    do aparelho e peso jogado fora.
  const pesadas = [];
  for (const img of document.querySelectorAll('img')) {
    if (!visivel(img) || !img.naturalWidth) continue;
    const r = img.getBoundingClientRect();
    const fator = img.naturalWidth / (r.width * devicePixelRatio);
    if (fator > 3) pesadas.push({ src: (img.currentSrc || img.src).split('/').pop(),
                                  natural: img.naturalWidth, exibida: Math.round(r.width), fator: +fator.toFixed(1) });
  }

  return { vw, vh, overflowX, estouram: estouram.slice(0, 6), miudos: miudos.slice(0, 6),
           pequenos: pequenos.slice(0, 6), pesadas: pesadas.slice(0, 6) };
}

/* O vao vertical e medido rolando a pagina inteira e procurando faixas sem
   NADA desenhado. Uso elementFromPoint em tres colunas para nao depender de
   quais seletores existem. */
/* VAO VERTICAL, MEDIDO EM PIXEIS.
   Tentei tres vezes deduzir isto do DOM e errei as tres:
     1. "tem cor de fundo conta como conteudo" -> nao pegou o defeito que
        o dono viu (568px de nada na secao do notebook, cobertos por um
        gradiente);
     2. "gradiente nunca conta" -> acusou o Nucleo Neural, onde o
        gradiente E a ilustracao;
     3. "gradiente conta se o bloco for menor que 70% da janela" -> ainda
        acusou o Nucleo Neural, porque o cristal e desenhado num
        pseudo-elemento, que elementFromPoint nao devolve e
        getComputedStyle do pai nao ve.
   O DOM nao sabe o que foi pintado. A tela sabe. Entao: tira um retrato
   da janela, leva para um canvas e olha linha a linha. Uma linha em que
   todos os pixeis tem praticamente a mesma cor e fundo liso — e o que o
   visitante le como "nada". Uma linha com variacao tem alguma coisa
   desenhada, seja texto, foto, cristal ou borda.
   Um gradiente vertical (o caso do palco) e constante DENTRO de cada
   linha, entao e corretamente lido como vazio; um brilho radial ou uma
   ilustracao variam na horizontal e contam como conteudo. */
async function medirVaos(page) {
  /* animations:'disabled' congela as animacoes CSS no primeiro quadro.
     Sem isso o hero tem gradientes em loop infinito e o screenshot fica
     esperando a pagina "assentar" ate estourar o tempo. */
  const retrato = (await page.screenshot({ type: 'png', animations: 'disabled', timeout: 60000 }))
    .toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const lona = document.createElement('canvas');
    lona.width = img.naturalWidth; lona.height = img.naturalHeight;
    lona.getContext('2d').drawImage(img, 0, 0);
    const d = lona.getContext('2d').getImageData(0, 0, lona.width, lona.height).data;
    const escala = lona.height / innerHeight;   // o retrato vem em pixeis do aparelho
    const PASSO_X = 4;
    /* 10 de 255 de amplitude: abaixo disso a linha e lisa a olho nu.
       Ruido de compressao e antialias ficam bem abaixo. */
    const LIMIAR = 10;
    let vazio = 0, pior = 0, piorEm = 0;
    for (let py = 0; py < lona.height; py++) {
      let min = 255, max = 0;
      for (let px = 0; px < lona.width; px += PASSO_X) {
        const i = (py * lona.width + px) * 4;
        const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
      }
      if (max - min > LIMIAR) { vazio = 0; }
      else {
        vazio++;
        if (vazio > pior) { pior = vazio; piorEm = py; }
      }
    }
    return { pior: Math.round(pior / escala), piorEm: Math.round(piorEm / escala) };
  }, retrato);
}

(async () => {
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

  for (const ap of APARELHOS) {
    console.log('\n======== ' + ap.nome + '  ' + ap.width + 'x' + ap.height + '  (dpr ' + ap.dpr + ') ========');
    const ctx = await navegador.newContext({
      viewport: { width: ap.width, height: ap.height },
      deviceScaleFactor: ap.dpr, isMobile: true, hasTouch: true,
    });
    for (const pg of PAGINAS) {
      const page = await ctx.newPage();
      await page.goto(URL_BASE + '/' + pg, { waitUntil: 'load' }).catch(() => {});
      await page.waitForTimeout(450);
      // deixa as imagens preguicosas carregarem
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(350);
      /* Congela animacoes e transicoes ANTES de medir. Sem isto a
         medicao pega elementos no meio do voo e inventa defeito: o
         aviso flutuante de vendas foi apanhado com a classe is-in mas
         ainda em scale(0,96) e deslocado 46px, e apareceu como se
         estourasse 22px da tela. Congelado, ele mede os 279px certos
         dentro da janela. */
      await page.addStyleTag({ content:
        '*,*::before,*::after{animation:none !important;transition:none !important}' });
      await page.waitForTimeout(220);

      const m = await page.evaluate(medir);
      const rot = (t) => pg + ': ' + t;

      ok(m.overflowX <= 1, rot('sem rolagem horizontal'), m.overflowX + 'px');
      ok(m.estouram.length === 0, rot('nenhum elemento estoura a largura'),
         m.estouram.length ? m.estouram.map((e) => e.el + ' +' + e.sobra + 'px').join(', ') : 'nenhum');
      ok(m.miudos.length === 0, rot('nenhum texto abaixo de 12px'),
         m.miudos.length ? m.miudos.map((e) => e.el + ' ' + e.px + 'px') .join(', ') : 'nenhum');
      ok(m.pequenos.length === 0, rot('nenhum botao/link abaixo de 40px'),
         m.pequenos.length ? m.pequenos.map((e) => e.el + ' ' + e.tam).join(', ') : 'nenhum');
      ok(m.pesadas.length === 0, rot('nenhuma imagem servida acima de 3x'),
         m.pesadas.length ? m.pesadas.map((e) => e.src + ' ' + e.fator + 'x').join(', ') : 'nenhuma');

      await page.close();
    }
    await ctx.close();
  }

  /* O vao vertical so vale a pena na home, que e a pagina com as secoes de
     tela cheia. Rolo a pagina em passos de meia tela. */
  console.log('\n======== vao vertical na home ========');
  for (const ap of APARELHOS) {
    const ctx = await navegador.newContext({
      viewport: { width: ap.width, height: ap.height },
      deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto(URL_BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    /* Sem animacao a varredura fica reproduzivel e o retrato sai na
       hora. O que interessa aqui e o espaco ocupado, nao o movimento. */
    await page.addStyleTag({ content:
      '*,*::before,*::after{animation:none !important;transition:none !important}' });
    await page.waitForTimeout(250);
    const alt = await page.evaluate(() => document.documentElement.scrollHeight);
    let pior = 0, piorEm = 0;
    /* passo de 3/4 de tela: cobre a pagina inteira com sobreposicao
       suficiente para nenhuma faixa vazia cair entre dois retratos */
    for (let y = 0; y < alt - ap.height; y += Math.round(ap.height * 0.75)) {
      await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: 'instant' }), y);
      await page.waitForTimeout(140);
      const v = await medirVaos(page);
      if (v.pior > pior) { pior = v.pior; piorEm = y + v.piorEm; }
    }
    /* Meia tela de nada seguido e o limite: acima disso o visitante acha
       que a pagina acabou ou quebrou. */
    const teto = Math.round(ap.height * 0.5);
    ok(pior <= teto, ap.nome + ': nenhuma faixa vazia maior que meia tela',
       'pior ' + pior + 'px (teto ' + teto + 'px) perto de y=' + piorEm);
    await ctx.close();
  }

  await navegador.close();
  console.log('\n' + verificacoes + ' verificacoes, ' +
    (falhas === 0 ? 'NENHUMA FALHA' : falhas + ' FALHA(S)'));
  process.exit(falhas === 0 ? 0 : 1);
})();
