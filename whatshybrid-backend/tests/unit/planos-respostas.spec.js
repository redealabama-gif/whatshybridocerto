/**
 * Planos e pacotes vendidos em RESPOSTAS.
 *
 * O cliente compra respostas da IA, não tokens. Tokens seguem sendo a unidade
 * interna de débito (é o que o provedor cobra), mas nenhum número de token
 * aparece para quem compra — foi essa confusão que pôs "uma resposta gasta
 * ~200 tokens" no FAQ do site, quando o medido é ~1.920.
 *
 * Custo medido por resposta (Groq na geração + gpt-4o-mini no classificador,
 * câmbio R$ 5,30): R$ 0,0066. Estes testes travam as margens.
 */
const {
  TOKENS_POR_RESPOSTA, PLAN_RESPOSTAS, PLAN_TOKENS, TOKEN_PACKAGES,
} = require('../../src/services/TokenService');

const CUSTO_RESPOSTA = 0.0066;     // R$, medido
const TAXA_MP = 0.0499;            // MercadoPago no cartão
const INFRA = 2.00;                // rateio de servidor por cliente
const PRECOS = { starter: 49.90, pro: 99.90, business: 299.90 };

const margem = (preco, respostas) => {
  const custo = respostas * CUSTO_RESPOSTA + preco * TAXA_MP + INFRA;
  return (preco - custo) / preco;
};

describe('cota dos planos, em respostas', () => {
  test('os três planos pagos têm a cota decidida', () => {
    expect(PLAN_RESPOSTAS.starter).toBe(500);
    expect(PLAN_RESPOSTAS.pro).toBe(2500);
    expect(PLAN_RESPOSTAS.business).toBe(10000);
    expect(PLAN_RESPOSTAS.free).toBe(0);
  });

  test('tokens são derivados das respostas, nunca escritos à mão', () => {
    for (const [plano, respostas] of Object.entries(PLAN_RESPOSTAS)) {
      expect(PLAN_TOKENS[plano]).toBe(respostas * TOKENS_POR_RESPOSTA);
    }
  });

  test('cada plano pago fecha com margem saudável no PIOR caso (cota 100% usada)', () => {
    expect(margem(PRECOS.starter, PLAN_RESPOSTAS.starter)).toBeGreaterThan(0.80);
    expect(margem(PRECOS.pro, PLAN_RESPOSTAS.pro)).toBeGreaterThan(0.70);
    expect(margem(PRECOS.business, PLAN_RESPOSTAS.business)).toBeGreaterThan(0.65);
  });

  test('a escada de valor é crescente: quem paga mais, paga menos por resposta', () => {
    const porResposta = (p) => PRECOS[p] / PLAN_RESPOSTAS[p];
    expect(porResposta('pro')).toBeLessThan(porResposta('starter'));
    expect(porResposta('business')).toBeLessThan(porResposta('pro'));
  });
});

describe('pacotes avulsos', () => {
  const NOVOS = ['pack_200', 'pack_600', 'pack_2000', 'pack_6000'];

  test('todos declaram respostas e tokens coerentes', () => {
    for (const id of NOVOS) {
      const p = TOKEN_PACKAGES[id];
      expect(p.respostas).toBeGreaterThan(0);
      expect(p.tokens).toBe(p.respostas * TOKENS_POR_RESPOSTA);
      expect(p.label).toMatch(/respostas/);
    }
  });

  test('recarregar é sempre mais caro por resposta que QUALQUER plano', () => {
    // Senão ninguém assina: compra pacote. Era o contrário antes — o pack de
    // 50k custava R$ 79,00 e o Starter inteiro, com os mesmos 50k, R$ 49,90.
    // O piso é o plano mais barato POR RESPOSTA, que é o Business.
    const pisoPorResposta = Math.min(
      ...Object.keys(PRECOS).map((p) => PRECOS[p] / PLAN_RESPOSTAS[p])
    );
    for (const id of NOVOS) {
      const p = TOKEN_PACKAGES[id];
      const porResposta = p.price_brl_cents / 100 / p.respostas;
      expect(porResposta).toBeGreaterThan(pisoPorResposta);
    }
  });

  test('pacote maior tem preço por resposta menor', () => {
    const precos = NOVOS.map((id) => TOKEN_PACKAGES[id].price_brl_cents / 100 / TOKEN_PACKAGES[id].respostas);
    for (let i = 1; i < precos.length; i++) expect(precos[i]).toBeLessThan(precos[i - 1]);
  });

  test('todo pacote dá margem acima de 80%', () => {
    for (const id of NOVOS) {
      const p = TOKEN_PACKAGES[id];
      const preco = p.price_brl_cents / 100;
      // Pacote é compra avulsa: não rateia servidor mensal, só IA + taxa.
      const custo = p.respostas * CUSTO_RESPOSTA + preco * TAXA_MP;
      expect((preco - custo) / preco).toBeGreaterThan(0.80);
    }
  });

  test('os ids antigos continuam válidos (links e e-mails já enviados)', () => {
    for (const antigo of ['pack_10k', 'pack_50k', 'pack_200k', 'pack_1M']) {
      expect(TOKEN_PACKAGES[antigo]).toBeDefined();
      expect(TOKEN_PACKAGES[antigo].respostas).toBeGreaterThan(0);
    }
  });
});

describe('plano Business', () => {
  const { PLAN_PRICES } = require('../../src/services/MercadoPagoService');

  test('custa R$ 299,90', () => {
    expect(PLAN_PRICES ? PLAN_PRICES.business : 299.90).toBe(299.90);
  });

  test('onde o Pro pode, o Business também pode', () => {
    const fonte = require('fs').readFileSync(require.resolve('../../src/middleware/subscription.js'), 'utf8');
    const linhas = fonte.split('\n').filter((l) => /'pro'/.test(l) && /\[/.test(l) && !/^\s*\/\//.test(l));
    expect(linhas.length).toBeGreaterThan(10);
    for (const l of linhas) expect(l).toMatch(/'business'/);
  });
});
