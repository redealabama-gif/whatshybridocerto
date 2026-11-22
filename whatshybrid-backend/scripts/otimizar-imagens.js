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
];

function kb(p) { return Math.round(fs.statSync(p).size / 1024); }

let faltando = 0, gerados = 0, antes = 0, depois = 0;

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
      continue;
    }

    execFileSync('convert', [
      origem,
      '-resize', `${larg}x>`,       // o ">" impede ampliar além do original
      '-strip',                      // fora metadados de câmera/editor
      '-quality', String(alvo.qualidade),
      '-define', 'webp:method=6',    // mais lento para comprimir, menor no fim
      saida,
    ]);
    depois += fs.statSync(saida).size;
    gerados++;
    console.log(`  ✓ ${path.basename(saida).padEnd(34)} ${String(kb(saida)).padStart(5)} KB   (origem ${kb(origem)} KB)`);
  }
}

if (CONFERIR) {
  if (faltando) { console.error(`\n${faltando} arquivo(s) WebP faltando ou desatualizado(s). Rode: node scripts/otimizar-imagens.js`); process.exit(1); }
  console.log('Todas as versões WebP existem e estão atualizadas.');
  process.exit(0);
}

console.log(`\n${gerados} arquivo(s) gerado(s).`);
console.log(`originais: ${(antes/1048576).toFixed(1)} MB   →   WebP: ${(depois/1048576).toFixed(1)} MB   (${Math.round((1 - depois/antes) * 100)}% menor)`);
console.log('Os originais ficam no repositório: são o fallback e a fonte para regerar.');
