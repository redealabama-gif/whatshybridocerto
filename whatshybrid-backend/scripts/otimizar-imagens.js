#!/usr/bin/env node
/**
 * Gera as versões WebP das imagens de public/assets/.
 *
 * POR QUE ISTO EXISTE. A home transferia 21,5 MB, dos quais 17,9 MB eram dez
 * JPEG de fundo de seção — cada um com cerca de 2 MB em 1376x768. Pesados
 * demais para o que entregam e, ao mesmo tempo, PEQUENOS demais: esticados
 * para preencher a tela num monitor de 1440 px ou mais, borram. O pior dos
 * dois mundos.
 *
 * O WebP a 1600 px resolve as duas pontas: fica maior que o original e pesa
 * cerca de 7% dele. Os originais FICAM no repositório — são o fallback para
 * navegador sem WebP (hoje raríssimo) e a fonte para regerar.
 *
 * Uso (na raiz do backend):   node scripts/otimizar-imagens.js
 *                             node scripts/otimizar-imagens.js --conferir
 *
 * --conferir não grava nada: só diz se algum WebP está faltando ou mais
 * velho que o original. É o que a CI pode rodar.
 *
 * ATENÇÃO — O `-quality` DO IMAGEMAGICK NÃO VALE PARA WEBP.
 * Medido nesta máquina (ImageMagick 6.9.12-98, libwebp 1.3.2): converter o
 * mesmo PNG com -quality 30, 82 e 95 produz arquivos BYTE A BYTE IDÊNTICOS
 * (mesmo md5). Só o 100 muda alguma coisa, e aí vira lossless (1,5 MB).
 * Em JPEG o mesmo -quality funciona normalmente (22 KB contra 124 KB), então
 * não é erro de uso: o codificador WebP desta build ignora o parâmetro e usa
 * o padrão da libwebp, que é 75.
 *
 * Consequência: o campo `qualidade` abaixo NUNCA teve efeito nos WebP. Tudo
 * está em 75. Para fundos atrás de um véu escuro isso é indiferente, mas numa
 * captura de tela cheia de texto de 11 px o 75 empastela as letras.
 *
 * Por isso os alvos marcados com `nitido: true` são codificados pelo Chromium
 * (canvas.toDataURL('image/webp', q)), que respeita a qualidade de verdade.
 * O Chromium já está nesta máquina por causa do Playwright do audit/harness —
 * nenhuma dependência nova. Se o Playwright não estiver instalado o script
 * avisa e cai no ImageMagick, com a perda de nitidez que isso implica.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ASSETS = path.join(__dirname, '..', 'public', 'assets');
const CONFERIR = process.argv.includes('--conferir');

/**
 * larguras: cada entrada vira <nome>-<larg>w.webp. Uma só largura quando a
 * imagem nunca é exibida grande.
 * qualidade: fundos atrás de um véu escuro aguentam compressão mais dura que
 * uma maquete de produto, que o visitante encara de perto.
 */
const ALVOS = [
  // fundos de seção: ficam atrás de .pfx-veil com 0,14 de opacidade
  ...['brain','contrast','dialogue','faq','growth','network','rays','roi','steps','toolkit']
      .map((n) => ({ arquivo: `bg-${n}.jpg`, larguras: [1600, 900], qualidade: 68 })),
  // heróis das telas de conta: ocupam meia tela, olhados de perto
  { arquivo: 'login-hero.png',  larguras: [1100, 700], qualidade: 78 },
  { arquivo: 'signup-hero.png', larguras: [1100, 700], qualidade: 78 },
  // maquetes dentro do hero
  { arquivo: 'iphone-screen.jpeg', larguras: [860], qualidade: 82 },
  { arquivo: 'mockup-render.png',  larguras: [1400], qualidade: 82 },
  { arquivo: 'neural-core-crystal.jpg', larguras: [1140], qualidade: 82 },
  // A marca aparece em TODAS as páginas, exibida em 89x34 — e o arquivo
  // tinha 1105x422 e 235 KB. 240w cobre até 2,7x de densidade de tela.
  { arquivo: 'vortex-pro-wordmark.png', larguras: [240], qualidade: 90 },
  /* A captura da extensao dentro do WhatsApp Web: uma tela inteira de
     app, com nomes de conversa e baloes de mensagem em 11 px. E o unico
     alvo desta lista em que a compressao se ve a olho nu, por isso
     `nitido`. Em 75 (o que o ImageMagick entregava) as letras ficam
     empasteladas e o fundo quadriculado blocado; em 92 ficam limpas.
     Custo: 126 KB -> 247 KB no arquivo de 2048, que e lazy e so carrega
     quando a secao entra na tela.
     O painel final mede de 719 a 1178 CSS px conforme a janela; para
     ficar nitido tambem em tela Retina sem esticar seriam precisos
     2356 px de origem, e o arquivo que o dono enviou tem 2048. */
  { arquivo: 'tela-extensao.png', larguras: [2048, 1600, 1000], qualidade: 92, nitido: true,
    /* Piso de tamanho por largura. Serve de alarme: se alguem regerar
       sem o Playwright, o ImageMagick entrega o mesmo arquivo em 75 e
       ele fica bem menor (126/79/38 KB contra 247/165/77). O
       --conferir acusa em vez de a perda passar despercebida. */
    kbMinimo: { 2048: 200, 1600: 130, 1000: 60 } },
];

function kb(p) { return Math.round(fs.statSync(p).size / 1024); }

/**
 * Codificador WebP do Chromium, para os alvos `nitido`. Existe porque o
 * -quality do ImageMagick nao vale para WebP (ver o cabecalho).
 * Abre UM navegador e reaproveita para todas as larguras.
 */
async function abrirChromium() {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { return null; }
  const CAMINHOS = ['/opt/pw-browsers/chromium', undefined];
  for (const executablePath of CAMINHOS) {
    try {
      return await chromium.launch({ executablePath, args: ['--no-sandbox'] });
    } catch { /* tenta o proximo */ }
  }
  return null;
}

async function webpNitido(navegador, origem, saida, largura, qualidade) {
  const pagina = await navegador.newPage();
  try {
    await pagina.goto('file://' + origem, { waitUntil: 'load' });
    const b64 = await pagina.evaluate(async ([larg, q]) => {
      const img = document.querySelector('img');
      await img.decode();
      // o ">" do ImageMagick: nunca ampliar alem do original
      const escala = Math.min(1, larg / img.naturalWidth);
      const lona = document.createElement('canvas');
      lona.width = Math.round(img.naturalWidth * escala);
      lona.height = Math.round(img.naturalHeight * escala);
      const ctx = lona.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, lona.width, lona.height);
      return lona.toDataURL('image/webp', q).split(',')[1];
    }, [largura, qualidade / 100]);
    fs.writeFileSync(saida, Buffer.from(b64, 'base64'));
  } finally {
    await pagina.close();
  }
}

(async () => {

let faltando = 0, gerados = 0, antes = 0, depois = 0;
let navegador = null;

if (!CONFERIR && ALVOS.some((a) => a.nitido)) {
  navegador = await abrirChromium();
  if (!navegador) {
    console.error('  ! Playwright/Chromium indisponivel: os alvos "nitido" vao');
    console.error('    sair pelo ImageMagick, que ignora a qualidade e usa 75.');
    console.error('    Instale com: npm install  (na raiz do repositorio)');
  }
}

for (const alvo of ALVOS) {
  const origem = path.join(ASSETS, alvo.arquivo);
  if (!fs.existsSync(origem)) { console.error('  ✗ não existe: ' + alvo.arquivo); faltando++; continue; }
  const base = alvo.arquivo.replace(/\.(jpe?g|png)$/i, '');
  antes += fs.statSync(origem).size;

  for (const larg of alvo.larguras) {
    const saida = path.join(ASSETS, `${base}-${larg}w.webp`);

    if (CONFERIR) {
      if (!fs.existsSync(saida)) { console.error(`  ✗ falta ${path.basename(saida)}`); faltando++; }
      else if (fs.statSync(saida).mtimeMs < fs.statSync(origem).mtimeMs) {
        console.error(`  ✗ ${path.basename(saida)} é mais velho que o original`); faltando++;
      }
      else if (alvo.kbMinimo && alvo.kbMinimo[larg] && kb(saida) < alvo.kbMinimo[larg]) {
        console.error(`  ✗ ${path.basename(saida)} tem ${kb(saida)} KB, menos que os ` +
                      `${alvo.kbMinimo[larg]} KB esperados em qualidade ${alvo.qualidade}. ` +
                      `Provavelmente foi gerado pelo ImageMagick, que ignora a qualidade e usa 75.`);
        faltando++;
      }
      continue;
    }

    const porChromium = alvo.nitido && navegador;
    if (porChromium) {
      await webpNitido(navegador, origem, saida, larg, alvo.qualidade);
    } else {
      execFileSync('convert', [
        origem,
        '-resize', `${larg}x>`,       // o ">" impede ampliar além do original
        '-strip',                      // fora metadados de câmera/editor
        '-quality', String(alvo.qualidade),
        '-define', 'webp:method=6',    // mais lento para comprimir, menor no fim
        saida,
      ]);
    }
    depois += fs.statSync(saida).size;
    gerados++;
    console.log(`  ✓ ${path.basename(saida).padEnd(34)} ${String(kb(saida)).padStart(5)} KB` +
                `   (origem ${kb(origem)} KB${porChromium ? ', q' + alvo.qualidade + ' pelo Chromium' : ''})`);
  }
}

if (CONFERIR) {
  if (faltando) { console.error(`\n${faltando} arquivo(s) WebP faltando ou desatualizado(s). Rode: node scripts/otimizar-imagens.js`); process.exit(1); }
  console.log('Todas as versões WebP existem e estão atualizadas.');
  process.exit(0);
}

if (navegador) await navegador.close();

console.log(`\n${gerados} arquivo(s) gerado(s).`);
console.log(`originais: ${(antes/1048576).toFixed(1)} MB   →   WebP: ${(depois/1048576).toFixed(1)} MB   (${Math.round((1 - depois/antes) * 100)}% menor)`);
console.log('Os originais ficam no repositório: são o fallback e a fonte para regerar.');

})();
