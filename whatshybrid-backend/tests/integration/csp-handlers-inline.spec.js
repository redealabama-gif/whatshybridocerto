/**
 * DASH-01 — a CSP manda `script-src-attr 'none'` (padrão do helmet), que
 * BLOQUEIA todo handler inline (onclick="..."). Resultado medido no Chromium:
 * os 17 botões do painel que usavam onclick não respondiam a nada — inclusive
 * "Sair" —, enquanto os ligados por addEventListener funcionavam normalmente.
 *
 * Não é coisa de localhost: o mesmo cabeçalho vai para produção.
 *
 * A correção é tirar os handlers inline, não afrouxar a CSP. Este teste segura
 * a regressão: nenhuma página pode voltar a usar handler inline — nem para
 * "resolver" isso liberando script-src-attr.
 *
 * Cabeçalho medido (curl http://127.0.0.1:3000/dashboard.html):
 *   Content-Security-Policy: ... ; script-src-attr 'none'
 */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../../public');
const paginas = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html'));

// on* que o navegador executa como script inline (script-src-attr).
const HANDLER_INLINE = /\son(click|change|submit|input|load|error|focus|blur|keyup|keydown|mouseover|mouseout|toggle)\s*=\s*"/gi;

describe('DASH-01: nenhuma página usa handler inline (a CSP bloqueia)', () => {
  test.each(paginas)('%s não tem on*="..." no HTML', (arquivo) => {
    const html = fs.readFileSync(path.join(PUBLIC, arquivo), 'utf8');
    const achados = [...html.matchAll(HANDLER_INLINE)].map((m) => {
      const linha = html.slice(0, m.index).split('\n').length;
      return `${arquivo}:${linha} ${html.slice(m.index, m.index + 70).trim()}`;
    });
    expect(achados).toEqual([]);
  });
});

/**
 * DASH-02 — o painel chamava GET /api/v1/users/me, que cai na rota
 * /api/v1/users/:id com id="me" e devolve 404 (medido no navegador real).
 * As duas chamadas estavam dentro de .catch(), então falhavam em silêncio:
 * o Crisp nunca recebia nome/e-mail do cliente e o detectPaymentProvider()
 * nunca lia a preferência de pagamento. O endpoint certo é /api/v1/auth/me.
 */
describe('DASH-02: nenhuma página chama /api/v1/users/me (é 404)', () => {
  test.each(paginas)('%s não usa /api/v1/users/me', (arquivo) => {
    const html = fs.readFileSync(path.join(PUBLIC, arquivo), 'utf8');
    const linhas = html.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => l.includes("'/api/v1/users/me'") || l.includes('"/api/v1/users/me"'))
      .map(([n, l]) => `${arquivo}:${n} ${l.trim().slice(0, 80)}`);
    expect(linhas).toEqual([]);
  });
});
