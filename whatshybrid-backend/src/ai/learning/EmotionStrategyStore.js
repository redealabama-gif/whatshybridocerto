/**
 * 🎯 EmotionStrategyStore — aprende qual ABORDAGEM de tom converte por emoção
 *
 * Para cada emoção do cliente (raiva, ansiedade, decepção, ...), o sistema testa
 * 2 abordagens de tom e aprende, pelo FEEDBACK real (aprovar/editar/rejeitar),
 * qual funciona melhor — e passa a preferi-la (explorar/explotar, epsilon-greedy).
 *
 * Decisões ("não quebrar nada" + privacidade):
 *  - ISOLADO: tabela própria `emotion_strategy_stats`, autocriada. Só CONTADORES
 *    agregados por (workspace, emoção, abordagem) — SEM conteúdo do cliente, SEM
 *    PII (não é dado pessoal → fora da retenção LGPD).
 *  - DESLIGADO por padrão no orquestrador (WHL_EMOTION_LEARNING=1 liga).
 *  - À prova de falha: erro de DB → cai na abordagem padrão e não grava.
 */

'use strict';

const db = require('../../utils/database');
const logger = require('../../utils/logger');

// Abordagens de tom (A/B). Genéricas o suficiente para qualquer emoção; o que
// muda é QUAL converte melhor em CADA emoção — e é isso que se aprende.
const APPROACHES = ['acolher_resolver', 'acolher_explicar'];

const DIRECTIVES = {
  acolher_resolver: {
    'pt-BR': 'Abordagem de tom: acolha de forma curta e vá DIRETO à solução — objetivo e resolutivo.',
    en: 'Tone approach: acknowledge briefly and go STRAIGHT to the solution — objective and resolution-focused.',
    es: 'Enfoque de tono: reconoce brevemente y ve DIRECTO a la solución — objetivo y resolutivo.',
  },
  acolher_explicar: {
    'pt-BR': 'Abordagem de tom: acolha e EXPLIQUE com calma o que aconteceu / como funciona, demonstrando cuidado, antes de concluir.',
    en: 'Tone approach: acknowledge and calmly EXPLAIN what happened / how it works, showing care, before wrapping up.',
    es: 'Enfoque de tono: reconoce y EXPLICA con calma qué pasó / cómo funciona, mostrando cuidado, antes de concluir.',
  },
};

const EPSILON = 0.2;     // 20% de exploração (testa a outra abordagem)
const MIN_SAMPLES = 8;   // abaixo disso, explora bastante (ainda aprendendo)

function langKey(language) {
  const l = String(language || 'pt-BR');
  return l.startsWith('en') ? 'en' : l.startsWith('es') ? 'es' : 'pt-BR';
}

let _tableReady = false;
function ensureTable() {
  if (_tableReady) return;
  try {
    db.run(`CREATE TABLE IF NOT EXISTS emotion_strategy_stats (
      workspace_id TEXT NOT NULL,
      emotion TEXT NOT NULL,
      approach TEXT NOT NULL,
      positive INTEGER DEFAULT 0,
      negative INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (workspace_id, emotion, approach)
    )`);
    _tableReady = true;
  } catch (e) {
    logger.warn?.(`[EmotionStrategyStore] ensureTable falhou: ${e.message}`);
  }
}

class EmotionStrategyStore {
  constructor(tenantId) {
    this.tenantId = tenantId || 'default';
  }

  /** @returns {string[]} abordagens disponíveis */
  static approaches() { return APPROACHES.slice(); }

  /** Diretriz de tom (i18n) da abordagem escolhida, para injetar no prompt. */
  getApproachDirective(approach, language = 'pt-BR') {
    const d = DIRECTIVES[approach];
    return (d && (d[langKey(language)] || d['pt-BR'])) || '';
  }

  /**
   * Escolhe a abordagem para uma emoção: explora quando há pouco dado ou por
   * epsilon; senão, explota a de maior taxa de aprovação (Laplace-smoothed).
   * @returns {string} approach key
   */
  pickApproach(emotion) {
    if (!emotion || emotion === 'neutral') return APPROACHES[0];
    ensureTable();
    try {
      const rows = db.all(
        'SELECT approach, positive, total FROM emotion_strategy_stats WHERE workspace_id = ? AND emotion = ?',
        [this.tenantId, emotion]
      ) || [];
      const by = {};
      let totalAll = 0;
      for (const r of rows) { by[r.approach] = r; totalAll += (r.total || 0); }

      if (totalAll < MIN_SAMPLES || Math.random() < EPSILON) {
        return APPROACHES[Math.floor(Math.random() * APPROACHES.length)];
      }
      let best = APPROACHES[0];
      let bestScore = -1;
      for (const a of APPROACHES) {
        const r = by[a] || { positive: 0, total: 0 };
        // taxa de aprovação suavizada (evita 0/0 e overfit em poucas amostras)
        const score = (r.positive + 1) / ((r.total || 0) + 2);
        if (score > bestScore) { bestScore = score; best = a; }
      }
      return best;
    } catch (e) {
      logger.debug?.(`[EmotionStrategyStore] pickApproach: ${e.message}`);
      return APPROACHES[0];
    }
  }

  /**
   * Registra o resultado de uma abordagem para uma emoção.
   * @param {string} emotion
   * @param {string} approach
   * @param {'positive'|'negative'} outcome
   */
  record(emotion, approach, outcome) {
    if (!emotion || emotion === 'neutral' || !APPROACHES.includes(approach)) return;
    if (outcome !== 'positive' && outcome !== 'negative') return;
    ensureTable();
    try {
      const pos = outcome === 'positive' ? 1 : 0;
      const neg = outcome === 'negative' ? 1 : 0;
      db.run(
        `INSERT INTO emotion_strategy_stats (workspace_id, emotion, approach, positive, negative, total, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(workspace_id, emotion, approach) DO UPDATE SET
           positive = positive + excluded.positive,
           negative = negative + excluded.negative,
           total = total + excluded.total,
           updated_at = CURRENT_TIMESTAMP`,
        [this.tenantId, emotion, approach, pos, neg]
      );
    } catch (e) {
      logger.debug?.(`[EmotionStrategyStore] record: ${e.message}`);
    }
  }
}

module.exports = EmotionStrategyStore;
