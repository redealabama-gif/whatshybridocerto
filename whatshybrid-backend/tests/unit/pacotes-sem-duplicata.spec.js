/**
 * PKG-01 — ao trocar a venda de tokens por respostas (P1), os ids antigos
 * (pack_10k, pack_50k, pack_200k, pack_1M) foram mantidos apontando pros novos
 * pra não quebrar link de checkout já emitido:
 *
 *   src/services/TokenService.js:78
 *   for (const [antigo, novo] of Object.entries(PACOTES_ANTIGOS))
 *     TOKEN_PACKAGES[antigo] = TOKEN_PACKAGES[novo];
 *
 * Só que GET /api/v1/tokens/packages lista Object.entries(TOKEN_PACKAGES)
 * inteiro (src/routes/tokens.js:58). Resultado: 8 pacotes, sendo 4 cópias — o
 * painel desenhava "200 respostas — R$ 24,00" duas vezes, e assim por diante.
 */
const tokenService = require('../../src/services/TokenService');
const { TOKEN_PACKAGES, listarPacotes, PACOTES_ANTIGOS } = tokenService;

describe('PKG-01: pacotes listados sem duplicata', () => {
  test('listarPacotes() devolve só os 4 pacotes reais', () => {
    const ids = listarPacotes().map((p) => p.id);
    expect(ids).toEqual(['pack_200', 'pack_600', 'pack_2000', 'pack_6000']);
  });

  test('nenhuma repetição de respostas/preço na lista', () => {
    const assinaturas = listarPacotes().map((p) => `${p.respostas}/${p.price_brl_cents}`);
    expect(new Set(assinaturas).size).toBe(assinaturas.length);
  });

  test('os ids antigos continuam resolvendo (link de checkout já enviado)', () => {
    for (const [antigo, novo] of Object.entries(PACOTES_ANTIGOS)) {
      expect(TOKEN_PACKAGES[antigo]).toBeDefined();
      expect(TOKEN_PACKAGES[antigo].respostas).toBe(TOKEN_PACKAGES[novo].respostas);
      expect(TOKEN_PACKAGES[antigo].price_brl_cents).toBe(TOKEN_PACKAGES[novo].price_brl_cents);
    }
  });

  test('cada pacote traz respostas, preço e o custo por resposta', () => {
    for (const p of listarPacotes()) {
      expect(p.respostas).toBeGreaterThan(0);
      expect(p.price_brl).toBeCloseTo(p.price_brl_cents / 100, 2);
      expect(Number(p.preco_por_resposta)).toBeCloseTo(p.price_brl / p.respostas, 4);
    }
  });

  test('comprar avulso nunca sai mais barato que o plano mais barato por resposta', () => {
    // Invariante comercial: se o pacote ficar abaixo do plano, ninguém assina.
    const { PLAN_RESPOSTAS } = tokenService;
    const mensal = { starter: 49.90, pro: 99.90, business: 299.90 };
    const menorDoPlano = Math.min(
      ...Object.entries(mensal).map(([p, preco]) => preco / PLAN_RESPOSTAS[p])
    );
    for (const p of listarPacotes()) {
      expect(p.price_brl / p.respostas).toBeGreaterThan(menorDoPlano);
    }
  });
});
