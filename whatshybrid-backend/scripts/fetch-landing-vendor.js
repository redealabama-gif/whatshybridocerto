#!/usr/bin/env node
/**
 * WhatsHybrid Pro — auto-hospedagem dos assets externos da landing.
 *
 * Baixa para dentro de public/ as dependências que hoje vêm de CDN, deixando a
 * landing IMUNE a quedas do prod.spline.design / jsdelivr / esm.sh:
 *
 *   - cobe (lib do globo)   → public/js/vendor/cobe.js          (ESM self-contained)
 *   - cena 3D do robô       → public/assets/robot-scene.splinecode
 *
 * USO (num ambiente COM acesso à internet):
 *   cd whatshybrid-backend
 *   npm run vendor:landing
 *
 * Depois faça commit dos arquivos gerados. O front já prefere essas cópias
 * locais (index.html / js/globe.js) e só cai pros CDNs se elas não existirem.
 *
 * Sem dependências: usa só o módulo `https` nativo (Node >= 18).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const PUBLIC = path.join(__dirname, '..', 'public');

const TARGETS = [
  {
    name: 'cobe (lib do globo)',
    out: path.join(PUBLIC, 'js', 'vendor', 'cobe.js'),
    // IMPORTANTE: precisa ser um bundle ESM self-contained (deps inlined), senão
    // o arquivo local ainda importaria de CDN. jsdelivr /+esm e esm.sh ?bundle
    // entregam um único arquivo sem imports externos. unpkg ?module NÃO serve
    // aqui (ele reescreve os imports pra URLs do unpkg).
    sources: [
      'https://cdn.jsdelivr.net/npm/cobe@0.6.3/+esm',
      'https://esm.sh/cobe@0.6.3?bundle',
    ],
    validate(buf) {
      const head = buf.slice(0, 4096).toString('utf8');
      if (/<!doctype html|<html/i.test(head)) throw new Error('veio HTML (provável erro do CDN)');
      // não pode sobrar import absoluto pra CDN (deixaria de ser self-contained)
      if (/from\s*["']https?:\/\//.test(buf.toString('utf8'))) {
        throw new Error('bundle não é self-contained (ainda importa de URL externa)');
      }
    },
  },
  {
    name: 'cena 3D do robô (Spline)',
    out: path.join(PUBLIC, 'assets', 'robot-scene.splinecode'),
    sources: [
      'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode',
    ],
    validate(buf) {
      const head = buf.slice(0, 512).toString('utf8');
      if (/<!doctype html|<html|host_not_allowed|access denied/i.test(head)) {
        throw new Error('veio HTML/erro em vez do binário da cena');
      }
      if (buf.length < 1024) throw new Error('arquivo suspeito de tão pequeno (' + buf.length + ' bytes)');
    },
  },
];

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('redirecionamentos demais'));
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'whatshybrid-vendor/1.0', Accept: '*/*' } },
      (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(get(next, redirects + 1));
        }
        if (code !== 200) {
          res.resume();
          return reject(new Error('HTTP ' + code));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error('timeout (30s)')));
    req.on('error', reject);
  });
}

async function fetchFirst(target) {
  let lastErr;
  for (const url of target.sources) {
    try {
      process.stdout.write('  • ' + url + ' … ');
      const buf = await get(url);
      if (!buf || buf.length === 0) throw new Error('resposta vazia');
      if (target.validate) target.validate(buf);
      console.log('ok (' + buf.length.toLocaleString('pt-BR') + ' bytes)');
      return { buf, url };
    } catch (e) {
      console.log('falhou (' + e.message + ')');
      lastErr = e;
    }
  }
  throw lastErr || new Error('nenhuma fonte respondeu');
}

(async () => {
  console.log('Auto-hospedando assets da landing em public/ …');
  let failures = 0;

  for (const t of TARGETS) {
    console.log('\n▶ ' + t.name);
    try {
      const { buf, url } = await fetchFirst(t);
      fs.mkdirSync(path.dirname(t.out), { recursive: true });
      fs.writeFileSync(t.out, buf);
      console.log('  ✓ salvo: ' + path.relative(process.cwd(), t.out) + '  (origem: ' + new URL(url).host + ')');
    } catch (e) {
      failures += 1;
      console.error('  ✗ ' + t.name + ': ' + e.message);
    }
  }

  console.log('');
  if (failures) {
    console.error(
      failures + ' asset(s) não baixaram. Rode num ambiente com internet liberada\n' +
      '(ou baixe manualmente pelo navegador e salve nos caminhos acima) e tente de novo.'
    );
    process.exit(1);
  }
  console.log('Pronto! Faça commit de:');
  console.log('  - public/js/vendor/cobe.js');
  console.log('  - public/assets/robot-scene.splinecode');
  console.log('A landing passa a usar as cópias locais automaticamente.');
})();
