'use strict';

/**
 * LocalKnowledgeRanker — ranqueamento léxico local (sem IA, sem rede) do
 * conhecimento treinado (FAQs, produtos, exemplos) que o
 * AIOrchestrator._loadTrainedKnowledge injeta no prompt.
 *
 * POR QUE EXISTE
 * --------------
 * O scoring anterior era overlap de substring puro (`hits / tokens.length`):
 *   - não normalizava acento  → "preço" não casava com "preco";
 *   - não tratava plural/conjugação → "entrega" não casava com "entregar";
 *   - não pesava termo raro   → um SKU valia o mesmo que a palavra "para";
 *   - corte fixo em 0.3       → derrubava a FAQ certa quando só o token
 *                               DECISIVO (raro) casava, junto de comuns.
 *
 * COMO FUNCIONA
 * -------------
 *   1. Normalização: minúscula + remoção de acento/diacrítico + pontuação→espaço.
 *   2. Match por prefixo: stemming leve e seguro ("entrega"~"entregar"~"entregas",
 *      "produto"~"produtos") sem tabela de sufixos frágil.
 *   3. Conceitos: a query vira uma lista de CONCEITOS. Sinônimos de comércio
 *      (preço/valor/quanto custa…) colapsam num único conceito — senão cada
 *      sinônimo viraria um termo "exigido" e afundaria o score de qualquer doc.
 *   4. Cobertura ponderada por IDF: score = (Σ idf dos conceitos cobertos) /
 *      (Σ idf de todos os conceitos). Termo raro pesa mais; favorece RECALL
 *      (melhor incluir um doc relevante do que perdê-lo — o LLM filtra ruído).
 *   5. Pequeno bônus de densidade (tf) só para desempatar o ranking.
 *   6. Score em [0,1] — MANTÉM o contrato do pipeline (filtro `>= 0.3` do
 *      DynamicPromptBuilder e exibição "X%").
 *
 * 100% determinístico e isolado → testável em tests/unit/local-knowledge-ranker.spec.js.
 *
 * Contrato de documento (entrada de rankDocuments):
 *   { ...props livres, fields: [ { text: string, weight?: number } ] }
 * Saída: os MESMOS objetos com `.score` (0..1) anexado, ordenados desc.
 */

const BM25_K1 = 1.5; // saturação de term-frequency (usada só no bônus de densidade)
const BM25_B = 0.75; // normalização por tamanho do documento
const MIN_PREFIX_LEN = 4; // prefixo só casa entre termos com >= 4 chars

// Alinhado ao filtro do DynamicPromptBuilder.buildKnowledgeSection (minScore 0.3).
// Emitir abaixo disso seria inútil — o builder descartaria silenciosamente.
const MIN_SCORE = 0.3;

// Stopwords em forma JÁ normalizada (sem acento). Curtas demais (< 3) caem
// pelo filtro de tamanho, então aqui ficam só as de 3+ que poluem o match.
const STOPWORDS = new Set([
  'para',
  'como',
  'quando',
  'onde',
  'qual',
  'quais',
  'quanto',
  'quantos',
  'aquele',
  'aquela',
  'isso',
  'esse',
  'essa',
  'este',
  'esta',
  'muito',
  'pouco',
  'tambem',
  'minha',
  'meu',
  'seus',
  'suas',
  'voces',
  'voce',
  'tudo',
  'nada',
  'quem',
  'porque',
  'mais',
  'pelo',
  'pela',
  'dos',
  'das',
  'uma',
  'umas',
  'uns',
  'sem',
  'sob',
  'sobre',
  'entre',
  'que',
  'com',
  'por',
  'nao',
  'sim',
  'tem',
  'the',
  'and',
  'for',
]);

// Grupos de sinônimos pt-BR (comércio/atendimento). Termos JÁ normalizados.
// Membros multipalavra (ex.: "quanto custa") são detectados na string crua da
// query; só os termos de uma palavra entram como termos de match (docs são
// tokenizados em palavras isoladas).
const SYNONYM_GROUPS = [
  ['preco', 'valor', 'custa', 'custo', 'orcamento', 'quanto custa', 'tabela de precos'],
  [
    'entrega',
    'frete',
    'envio',
    'enviar',
    'entregar',
    'chega',
    'prazo',
    'correios',
    'transportadora',
  ],
  ['pagamento', 'pagar', 'pix', 'boleto', 'cartao', 'parcelar', 'parcela', 'parcelas', 'parcelado'],
  ['troca', 'trocar', 'devolver', 'devolucao', 'reembolso', 'estorno', 'garantia'],
  [
    'horario',
    'hora',
    'funcionamento',
    'aberto',
    'abre',
    'abrir',
    'fecha',
    'fechar',
    'atendimento',
    'expediente',
  ],
  ['estoque', 'disponivel', 'disponibilidade', 'esgotado', 'acabou', 'reposicao'],
  ['desconto', 'promocao', 'cupom', 'oferta', 'liquidacao'],
];

/**
 * Normaliza texto: minúscula, remove acento/diacrítico (NFD), troca pontuação
 * por espaço e colapsa espaços. "Qual é o PREÇO?" → "qual e o preco".
 */
function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacríticos (inclui cedilha → ç vira c)
    .replace(/[^a-z0-9\s]/g, ' ') // pontuação/símbolo → espaço
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokeniza um texto normalizado.
 * @param {object} [opts]
 * @param {number} [opts.minLen=3]      tamanho mínimo do token
 * @param {boolean} [opts.unique=false] dedupe (use true p/ query, false p/ doc tf)
 * @param {boolean} [opts.dropStopwords=true]
 */
function tokenize(text, opts = {}) {
  const { minLen = 3, unique = false, dropStopwords = true } = opts;
  const out = [];
  const seen = unique ? new Set() : null;
  for (const tok of normalize(text).split(' ')) {
    if (!tok || tok.length < minLen) continue;
    if (dropStopwords && STOPWORDS.has(tok)) continue;
    if (seen) {
      if (seen.has(tok)) continue;
      seen.add(tok);
    }
    out.push(tok);
  }
  return out;
}

/**
 * Casa um termo `q` com um termo `t`.
 * - Igualdade exata sempre vale (cobre termos curtos como "pix", "cep").
 * - Prefixo (stemming leve) só vale entre termos com >= MIN_PREFIX_LEN chars,
 *   evitando colisões de raiz curta.
 */
function matchTerm(q, t) {
  if (q === t) return true;
  if (q.length < MIN_PREFIX_LEN || t.length < MIN_PREFIX_LEN) return false;
  return q.startsWith(t) || t.startsWith(q);
}

/**
 * Transforma a query numa lista de CONCEITOS.
 * Cada conceito = { weight, surfaces:[termos] }. Um grupo de sinônimo disparado
 * vira UM conceito (todos os sinônimos são formas de superfície alternativas);
 * tokens fora de qualquer grupo viram conceitos próprios de 1 termo.
 * @returns {Array<{weight:number, surfaces:string[]}>}
 */
function buildConcepts(queryText) {
  const norm = normalize(queryText);
  const baseTokens = tokenize(queryText, { minLen: 3, unique: true });

  const triggeredGroups = [];
  SYNONYM_GROUPS.forEach((group, gi) => {
    const triggered = group.some((g) =>
      g.includes(' ') ? norm.includes(g) : baseTokens.some((bt) => matchTerm(bt, g))
    );
    if (triggered) triggeredGroups.push(gi);
  });

  const concepts = [];
  for (const gi of triggeredGroups) {
    const surfaces = SYNONYM_GROUPS[gi].filter((g) => !g.includes(' ') && g.length >= 3);
    if (surfaces.length) concepts.push({ weight: 1.0, surfaces });
  }
  for (const bt of baseTokens) {
    const belongs = triggeredGroups.some((gi) =>
      SYNONYM_GROUPS[gi].some((g) => !g.includes(' ') && matchTerm(bt, g))
    );
    if (!belongs) concepts.push({ weight: 1.0, surfaces: [bt] });
  }
  return concepts;
}

/**
 * Ranqueia documentos por relevância léxica à query.
 *
 * @param {string} queryText  mensagem do cliente
 * @param {Array<{fields: Array<{text:string,weight?:number}>}>} docs
 * @param {object} [opts] { k1, b, minScore }
 * @returns {Array} docs com `.score` (0..1) anexado, ordenados desc e já
 *                  filtrados por minScore (default MIN_SCORE).
 */
function rankDocuments(queryText, docs, opts = {}) {
  const k1 = opts.k1 ?? BM25_K1;
  const b = opts.b ?? BM25_B;
  const minScore = opts.minScore ?? MIN_SCORE;

  if (!Array.isArray(docs) || docs.length === 0) return [];
  const concepts = buildConcepts(queryText);
  if (concepts.length === 0) return [];

  // Pré-tokeniza docs com term-frequency ponderada por campo.
  const prepared = docs.map((doc) => {
    const tfw = new Map(); // termo → tf ponderado (soma dos pesos de campo)
    let length = 0;
    for (const field of doc.fields || []) {
      const w = Number.isFinite(field.weight) ? field.weight : 1;
      const toks = tokenize(field.text, { minLen: 3, unique: false });
      length += toks.length;
      for (const tk of toks) tfw.set(tk, (tfw.get(tk) || 0) + w);
    }
    return { doc, tfw, terms: Array.from(tfw.keys()), length };
  });

  const N = prepared.length;
  const avgdl = prepared.reduce((s, p) => s + p.length, 0) / N || 1;

  // IDF de Robertson "suavizado" (sempre > 0), por SURFACE term. Termo raro →
  // IDF alto. Teto (df=1) impede que um termo ausente da base (df=0, ex.: nome
  // próprio/typo) infle a importância do conceito de forma desproporcional.
  const idfMax = Math.log(1 + (N - 1 + 0.5) / (1 + 0.5));
  const surfaceIdf = new Map();
  const allSurfaces = new Set();
  for (const c of concepts) for (const s of c.surfaces) allSurfaces.add(s);
  for (const s of allSurfaces) {
    let dfq = 0;
    for (const p of prepared) {
      if (p.terms.some((t) => matchTerm(s, t))) dfq++;
    }
    let val = Math.log(1 + (N - dfq + 0.5) / (dfq + 0.5));
    if (dfq === 0) val = Math.min(val, idfMax);
    surfaceIdf.set(s, val);
  }

  // IDF do conceito = maior IDF entre seus surfaces (rarity/importância). Fixo
  // por conceito (independe do doc) → denominador comparável entre docs.
  const conceptIdf = concepts.map((c) =>
    Math.max(0, ...c.surfaces.map((s) => surfaceIdf.get(s) || 0))
  );
  const denom = concepts.reduce((sum, c, i) => sum + c.weight * conceptIdf[i], 0);
  if (denom <= 0) return [];

  const scored = [];
  for (const p of prepared) {
    const K = k1 * (1 - b + b * (p.length / avgdl));
    let covered = 0;
    let densSum = 0;
    let matched = 0;
    concepts.forEach((c, i) => {
      let bestTf = 0; // melhor surface do conceito neste doc
      for (const s of c.surfaces) {
        let tf = 0;
        for (const t of p.terms) if (matchTerm(s, t)) tf += p.tfw.get(t);
        if (tf > bestTf) bestTf = tf;
      }
      if (bestTf > 0) {
        covered += c.weight * conceptIdf[i];
        densSum += bestTf / (bestTf + K); // [0,1)
        matched++;
      }
    });
    if (matched === 0) continue;
    const coverage = covered / denom; // [0,1] — dirige o threshold
    const density = densSum / matched; // [0,1) — só desempata o ranking
    const score = Math.max(0, Math.min(1, coverage * (0.92 + 0.08 * density)));
    if (score >= minScore) scored.push({ ...p.doc, score });
  }

  scored.sort((a, c) => c.score - a.score);
  return scored;
}

module.exports = {
  normalize,
  tokenize,
  matchTerm,
  buildConcepts,
  rankDocuments,
  MIN_SCORE,
  SYNONYM_GROUPS,
  STOPWORDS,
};
