'use strict';

/**
 * IA-51 — a fusão das buscas enterrava o 1º colocado semântico.
 *
 * HybridSearch funde palavra-chave (BM25) e semântica (embeddings) por RRF,
 * somando 1/(k+posição) de cada lista. Num catálogo pequeno (o caso típico:
 * dezenas de itens) TODO documento entra na lista semântica; qualquer um que
 * também acerte uma palavra ganha a segunda parcela e passa à frente do 1º
 * colocado semântico que não repete a palavra — justamente a pergunta feita com
 * outras palavras, que o índice semântico existe para cobrir. O prompt leva só
 * 3 fontes (uma é sempre o negócio).
 *
 * Números REAIS da sonda (OpenAI embeddings, tela real, conversa 2:
 * "Se eu precisar remarcar, tem algum custo? E vocês atendem no sábado?"):
 * a política de remarcação (TXT) era a 1ª da busca semântica e a 5ª da fusão;
 * o modelo respondeu "Não tem custo para remarcar" (a política diz R$ 50,00).
 */

const AIOrchestrator = require('../../src/ai/AIOrchestrator');
const DynamicPromptBuilder = require('../../src/ai/prompts/DynamicPromptBuilder');

const Klass = AIOrchestrator.AIOrchestrator || AIOrchestrator;
const Builder = DynamicPromptBuilder.DynamicPromptBuilder || DynamicPromptBuilder;

const doc = (type, content, source) => ({ content, metadata: { type, source } });
// Ordem da fusão RRF devolvida por HybridSearch.search (alpha 0,7, k 60).
const FUSAO = [
  { docId: 'example:1', score: 0.0162, bm25Rank: 1, semanticRank: 2, document: doc('example', 'Cliente: Tem horário no sábado?\nResposta ideal: Tem sim! Sábado das 8h às 12h.', 'Exemplo treinado') },
  { docId: 'faq:urg', score: 0.0159, bm25Rank: 2, semanticRank: 3, document: doc('faq', 'Pergunta: Vocês fazem atendimento de urgência?\nResposta: Sim, urgências no mesmo dia, de segunda a sábado.', 'FAQ') },
  { docId: 'product:clar', score: 0.0155, bm25Rank: 4, semanticRank: 5, document: doc('product', 'Produto: Clareamento dental — BRL 650.00', 'Catálogo') },
  { docId: 'faq:parc', score: 0.0154, bm25Rank: 3, semanticRank: 6, document: doc('faq', 'Pergunta: Vocês parcelam no cartão?\nResposta: Sim, em até 6x sem juros.', 'FAQ') },
  { docId: 'note:0', score: 0.0115, bm25Rank: null, semanticRank: 1, document: doc('note', 'Remarcações são gratuitas quando avisadas com pelo menos 24 horas de antecedência. Faltas sem aviso pagam uma taxa de R$ 50,00.', 'Documento importado') },
  { docId: 'faq:hor', score: 0.0109, bm25Rank: null, semanticRank: 4, document: doc('faq', 'Pergunta: Qual o horário de funcionamento?\nResposta: Seg a sex 8h–18h; sáb 8h–12h.', 'FAQ') },
  { docId: 'product:limp', score: 0.0104, bm25Rank: null, semanticRank: 7, document: doc('product', 'Produto: Limpeza (profilaxia) — BRL 180.00', 'Catálogo') },
].map((r) => ({ ...r, method: 'rrf', metadata: r.document.metadata }));

function orchestratorCom(resultados) {
  const o = Object.create(Klass.prototype);
  o.tenantId = 'ws-ia51';
  o._ensureIndexed = async () => {};
  o.hybridSearch = { async search(_q, topK = 5) { return { results: resultados.slice(0, topK), method: 'hybrid' }; } };
  return o;
}

const NEGOCIO = { content: 'Empresa: Clínica Sorriso Fácil\nHorário de atendimento: Seg a sex 8h–18h; sáb 8h–12h', source: 'Informações do Negócio', score: 0.95 };

describe('IA-51 — fontes que chegam ao prompt', () => {
  test('o 1º colocado semântico (política do TXT) entra no prompt junto com o 1º por palavra-chave', async () => {
    const semantico = await orchestratorCom(FUSAO)._searchKnowledge('Se eu precisar remarcar, tem algum custo? E vocês atendem no sábado?');
    const secao = new Builder().buildKnowledgeSection([...semantico, NEGOCIO]);
    expect(secao).toMatch(/R\$ 50,00/);     // a política (semântico #1)
    expect(secao).toMatch(/Sábado das 8h/); // o exemplo (palavra-chave #1)
  });

  test('sem embeddings (só palavra-chave) a ordem continua a da busca', async () => {
    // Formato real de _searchBM25: { docId, score, method:'bm25' }, em ordem de nota, sem posições.
    const soBm25 = FUSAO.filter((r) => r.bm25Rank).sort((a, b) => a.bm25Rank - b.bm25Rank)
      .map((r, i) => ({ docId: r.docId, score: 10 - i, method: 'bm25', document: r.document, metadata: r.metadata }));
    const out = await orchestratorCom(soBm25)._searchKnowledge('x');
    expect(out.map((k) => k.content.slice(0, 20))).toEqual(soBm25.slice(0, 5).map((r) => r.document.content.slice(0, 20)));
  });
});
