'use strict';

/**
 * Testes do LocalKnowledgeRanker — o ranqueamento léxico local que alimenta
 * o conhecimento treinado no prompt (AIOrchestrator._loadTrainedKnowledge).
 *
 * Foco: garantir os ganhos sobre o scoring antigo (substring puro) sem
 * regressão — acento, plural/conjugação, sinônimo, termo raro decisivo, e
 * "lacuna de conhecimento" (nada relevante → vazio) — e que o score continua
 * no contrato [0,1] com piso 0.3 que o DynamicPromptBuilder consome.
 */

const ranker = require('../../src/ai/search/LocalKnowledgeRanker');

// Base de conhecimento de exemplo (formato FAQ/produto já no shape do ranker).
function kb() {
  return [
    {
      id: 'entrega',
      fields: [
        { text: 'Qual o prazo de entrega?', weight: 1 },
        { text: 'Entregamos em 3 dias úteis via correios', weight: 0.5 },
      ],
    },
    {
      id: 'preco',
      fields: [
        { text: 'Quanto custa o plano premium?', weight: 1 },
        { text: 'O valor do plano é R$99 por mês', weight: 0.5 },
      ],
    },
    {
      id: 'troca',
      fields: [
        { text: 'Como faço a troca de um produto?', weight: 1 },
        { text: 'Você pode devolver e pedir reembolso em 7 dias', weight: 0.5 },
      ],
    },
    {
      id: 'horario',
      fields: [
        { text: 'Qual o horário de funcionamento?', weight: 1 },
        { text: 'Atendemos de segunda a sexta das 9h às 18h', weight: 0.5 },
      ],
    },
    {
      id: 'cadeira',
      fields: [
        { text: 'Cadeira Gamer XPTO-2000', weight: 1.2 },
        { text: 'Cadeira ergonômica com apoio lombar e rodízios', weight: 0.5 },
      ],
    },
  ];
}

// Helper: id do top-1 resultado para uma query.
function topId(query) {
  const out = ranker.rankDocuments(query, kb());
  return out.length ? out[0].id : null;
}

describe('LocalKnowledgeRanker.normalize', () => {
  test('remove acentos e pontuação, minúscula', () => {
    expect(ranker.normalize('Qual é o PREÇO?')).toBe('qual e o preco');
    expect(ranker.normalize('Promoção/Opção, à vista!')).toBe('promocao opcao a vista');
    expect(ranker.normalize(null)).toBe('');
  });
});

describe('LocalKnowledgeRanker.tokenize', () => {
  test('descarta stopwords e tokens curtos', () => {
    expect(ranker.tokenize('qual o preço do produto')).toEqual(['preco', 'produto']);
  });
});

describe('LocalKnowledgeRanker.matchTerm', () => {
  test('igualdade exata e prefixo (plural/conjugação)', () => {
    expect(ranker.matchTerm('pix', 'pix')).toBe(true); // curto exato
    expect(ranker.matchTerm('cadeira', 'cadeiras')).toBe(true); // plural
    expect(ranker.matchTerm('entrega', 'entregamos')).toBe(true); // raiz/derivação
    expect(ranker.matchTerm('compra', 'comprar')).toBe(true); // raiz verbal
  });
  test('não casa prefixo curto demais (evita colisão de raiz)', () => {
    expect(ranker.matchTerm('co', 'comprar')).toBe(false);
    expect(ranker.matchTerm('pix', 'pizza')).toBe(false);
  });
});

describe('LocalKnowledgeRanker.rankDocuments', () => {
  test('acento na query não impede o match (preço → preco)', () => {
    expect(topId('qual o preço do premium?')).toBe('preco');
  });

  test('sinônimo casa o conceito ("quanto custa" → FAQ de preço)', () => {
    expect(topId('quanto custa?')).toBe('preco');
    expect(topId('me passa o orçamento')).toBe('preco');
  });

  test('plural/conjugação casam (regressão direta do scoring antigo)', () => {
    // "cadeiras" (plural) não dava match por substring no doc "cadeira".
    expect(topId('cadeiras disponíveis?')).toBe('cadeira');
    // "entregam" (conjugação) não casava "entregar/entrega".
    expect(topId('vocês entregam rápido?')).toBe('entrega');
  });

  test('termo raro decisivo (SKU) ranqueia o produto certo no topo', () => {
    expect(topId('tem a XPTO-2000?')).toBe('cadeira');
  });

  test('sinônimos de horário (horas/abrem) casam a FAQ de horário', () => {
    expect(topId('que horas vocês abrem?')).toBe('horario');
  });

  test('reembolso/devolução casam a FAQ de troca', () => {
    expect(topId('me fala do reembolso')).toBe('troca');
  });

  test('sem conhecimento relevante → vazio (lacuna de conhecimento)', () => {
    expect(ranker.rankDocuments('qual a capital da França?', kb())).toEqual([]);
    expect(ranker.rankDocuments('', kb())).toEqual([]);
  });

  test('todo score fica em [0,1] e relevantes passam o piso 0.3', () => {
    const out = ranker.rankDocuments('qual o preço?', kb());
    expect(out.length).toBeGreaterThan(0);
    for (const d of out) {
      expect(d.score).toBeGreaterThanOrEqual(ranker.MIN_SCORE);
      expect(d.score).toBeLessThanOrEqual(1);
    }
  });

  test('entradas inválidas não quebram', () => {
    expect(ranker.rankDocuments('preço', [])).toEqual([]);
    expect(ranker.rankDocuments('preço', null)).toEqual([]);
  });
});
