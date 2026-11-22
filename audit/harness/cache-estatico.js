/**
 * Uma correção de CSS tem de chegar ao visitante que JÁ ESTEVE no site.
 *
 * O defeito que isto cobre aconteceu de verdade: `css/redesign.css`
 * saía com `public, max-age=86400`, e como nenhum arquivo do projeto tem
 * hash no nome, o navegador servia a versão de ontem por 24 h sem nem
 * perguntar. Uma correção de cor de botão e de alinhamento foi para
 * produção e o dono continuou vendo o estado antigo — enquanto a
 * mudança de HTML da mesma entrega chegou na hora.
 *
 * O contrato:
 *   1. HTML, CSS e JS revalidam (no-cache) — a correção vale já;
 *   2. mídia pesada (imagem, fonte, vídeo) pode ficar em cache;
 *   3. a SEGUNDA visita não rebaixa o CSS: tem de vir 304, não 200 com
 *      corpo — revalidar não pode virar "baixar tudo de novo".
 *
 * Uso (na raiz, com o backend no ar):
 *   node audit/harness/cache-estatico.js [http://127.0.0.1:3191]
 */
const http = require('http');
const { URL } = require('url');

const BASE = (process.argv[2] || 'http://127.0.0.1:3191').replace(/\/$/, '');
const falhas = [];
const conf = (nome, ok, detalhe) => {
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + nome + (detalhe ? '  —  ' + detalhe : ''));
  if (!ok) falhas.push(nome + (detalhe ? ': ' + detalhe : ''));
};

function pedir(caminho, cabecalhos) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + caminho);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET', headers: cabecalhos || {} },
      (res) => {
        let n = 0;
        res.on('data', (c) => { n += c.length; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: n }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const REVALIDAM = ['/index.html', '/css/redesign.css', '/css/futuristic.css', '/js/landing-fx.js'];
const CACHEAVEIS = ['/assets/bg-roi-1600w.webp', '/fonts/fraunces-latin-var.woff2'];

(async () => {
  console.log('── precisam revalidar (a correção vale já) ──');
  for (const c of REVALIDAM) {
    const r = await pedir(c);
    const cc = r.headers['cache-control'] || '(sem)';
    const ok = /no-cache/.test(cc);
    conf(c, ok, cc);
  }

  console.log('\n── podem ficar em cache (arquivo grande, muda pouco) ──');
  for (const c of CACHEAVEIS) {
    const r = await pedir(c);
    const cc = r.headers['cache-control'] || '(sem)';
    const m = /max-age=(\d+)/.exec(cc);
    const ok = !!m && Number(m[1]) >= 86400;
    conf(c, ok, cc);
  }

  console.log('\n── revalidar não pode virar "baixar tudo de novo" ──');
  for (const c of ['/css/redesign.css', '/js/landing-fx.js']) {
    const um = await pedir(c);
    const etag = um.headers.etag;
    if (!etag) { conf(c + ' tem ETag', false, 'sem ETag — revalidar baixaria o arquivo inteiro'); continue; }
    const dois = await pedir(c, { 'If-None-Match': etag });
    const ok = dois.status === 304 && dois.bytes === 0;
    conf('segunda visita de ' + c + ' responde 304 sem corpo', ok,
      '1ª: ' + um.status + ' ' + um.bytes + ' B   2ª: ' + dois.status + ' ' + dois.bytes + ' B');
  }

  console.log(falhas.length ? '\nFALHAS (' + falhas.length + '):\n  ' + falhas.join('\n  ') : '\nSEM FALHAS');
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('erro: ' + e.message); process.exit(1); });
