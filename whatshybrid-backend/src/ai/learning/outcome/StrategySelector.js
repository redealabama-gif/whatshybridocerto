/**
 * 🧭 StrategySelector
 * WhatsHybrid Pro v10.2.0 — Auto-Evolutionary AI
 *
 * Seleciona AUTOMATICAMENTE a melhor estratégia de resposta
 * antes de construir o prompt, baseado em performance histórica REAL.
 *
 * Decide:
 *   - comercialAggression: quão agressivo comercialmente ser (0→1)
 *   - ctaStyle: tipo de CTA a usar ('soft' | 'direct' | 'urgent')
 *   - responseLength: comprimento preferido ('brief' | 'normal' | 'detailed')
 *   - toneVariant: tom de resposta ('formal' | 'conversational' | 'enthusiastic')
 *
 * Fontes de decisão (em ordem de prioridade):
 *   1. Performance histórica do CLIENTE específico (se ≥3 outcomes)
 *   2. Performance histórica do GOAL/STAGE atual (se ≥5 amostras)
 *   3. Defaults calibrados por estágio do cliente
 *
 * @module ai/learning/outcome/StrategySelector
 */

const logger = require('../../../config/logger');

// Defaults calibrados por estágio — usados quando não há histórico suficiente
const STAGE_DEFAULTS = {
  cold: {
    comercialAggression: 0.2,
    ctaStyle:            'soft',
    responseLength:      'normal',
    toneVariant:         'conversational',
  },
  interested: {
    comercialAggression: 0.5,
    ctaStyle:            'direct',
    responseLength:      'normal',
    toneVariant:         'enthusiastic',
  },
  warm: {
    comercialAggression: 0.85,
    ctaStyle:            'urgent',
    responseLength:      'brief',
    toneVariant:         'direct',
  },
  customer: {
    comercialAggression: 0.3,
    ctaStyle:            'soft',
    responseLength:      'brief',
    toneVariant:         'formal',
  },
  inactive: {
    comercialAggression: 0.4,
    ctaStyle:            'soft',
    responseLength:      'normal',
    toneVariant:         'conversational',
  },
};

// Scores mínimos por aggressiveness level para subir de patamar
const AGGRESSION_THRESHOLDS = {
  low:    { min: 0.0, max: 0.33 },
  medium: { min: 0.34, max: 0.66 },
  high:   { min: 0.67, max: 1.0 },
};

// Histórico por cliente: janela rolante de outcomes recentes
// clientId → [{ score, goal, ctaStyle, responseLength, toneVariant, convertedAt }]
const CLIENT_HISTORY_LIMIT = 30;
const MIN_SAMPLES_FOR_OVERRIDE = 3;

class StrategySelector {
  constructor(config = {}) {
    this.config = {
      minSamplesForOverride: config.minSamplesForOverride || MIN_SAMPLES_FOR_OVERRIDE,
      explorationRate:       config.explorationRate       || 0.1,
      ...config,
    };

    // CORREÇÃO P1: tenantId para namespace no banco — sem cross-tenant contamination
    this.tenantId = config.tenantId || 'default';

    // Histórico por cliente (cache in-memory, persistido no banco)
    this.clientHistory = new Map();

    // Histórico por goal+stage (global por tenant, persistido no banco)
    this.globalHistory = new Map();

    this.stats = { total: 0, fromClient: 0, fromGlobal: 0, fromDefault: 0, explored: 0 };

    // Carregar histórico do banco na inicialização (assíncrono, não bloqueia)
    this._loadFromDB().catch(err =>
      logger.warn('[StrategySelector] Falha ao carregar histórico do banco:', err.message)
    );
  }

  /** CORREÇÃO P1: Carrega histórico de estratégias do banco com namespace por tenant */
  async _loadFromDB() {
    try {
      const db = require('../../../utils/database');
      const rows = db.all(
        `SELECT chat_id, response_goal, client_stage, intent, tone_variant, cta_style,
                response_length, performance_score, outcome_label
         FROM strategy_history
         WHERE workspace_id = ?
         ORDER BY created_at DESC LIMIT 500`,
        [this.tenantId]
      );
      for (const row of rows) {
        // Reconstruir clientHistory
        if (row.chat_id) {
          if (!this.clientHistory.has(row.chat_id)) this.clientHistory.set(row.chat_id, []);
          this.clientHistory.get(row.chat_id).push({
            responseGoal: row.response_goal, clientStage: row.client_stage,
            toneVariant: row.tone_variant, ctaStyle: row.cta_style,
            responseLength: row.response_length, score: row.performance_score,
            outcome: row.outcome_label,
          });
        }
        // Reconstruir globalHistory
        const gKey = `${row.response_goal}:${row.client_stage}`;
        if (!this.globalHistory.has(gKey)) this.globalHistory.set(gKey, []);
        this.globalHistory.get(gKey).push({
          toneVariant: row.tone_variant, ctaStyle: row.cta_style,
          responseLength: row.response_length, score: row.performance_score,
        });
      }
    } catch (err) {
      // banco pode não estar pronto no primeiro boot
      logger.warn('[StrategySelector] _loadFromDB warning:', err.message);
    }
  }

  /** CORREÇÃO P1: Persiste um outcome de estratégia no banco */
  _persistOutcomeToDB(chatId, strategyData) {
    try {
      const db = require('../../../utils/database');
      db.run(
        `INSERT INTO strategy_history
         (workspace_id, chat_id, response_goal, client_stage, intent,
          tone_variant, cta_style, response_length, performance_score, outcome_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.tenantId, chatId || '',
         strategyData.responseGoal || null, strategyData.clientStage || null,
         strategyData.intent || null, strategyData.toneVariant || null,
         strategyData.ctaStyle || null, strategyData.responseLength || null,
         strategyData.score ?? null, strategyData.outcome || null]
      );
    } catch (err) {
      logger.warn('[StrategySelector] _persistOutcomeToDB error:', err.message);
    }
  }

  /**
   * Ponto de entrada principal.
   * Retorna a estratégia a usar para esta interação.
   *
   * @param {Object} p
   * @param {string} p.chatId
   * @param {string} p.clientStage
   * @param {string} p.responseGoal
   * @param {string} p.intent
   * @returns {Object} strategy
   */
  select({ chatId, clientStage = 'cold', responseGoal, intent }) {
    this.stats.total++;

    // Exploração aleatória (10%) — permite descobrir novas combinações
    if (Math.random() < this.config.explorationRate) {
      this.stats.explored++;
      const strategy = this._explore(clientStage);
      logger.debug(`[StrategySelector] EXPLORE for ${chatId}: ${JSON.stringify(strategy)}`);
      return { ...strategy, source: 'exploration' };
    }

    // 1. Histórico do cliente específico
    const clientKey = chatId;
    const clientData = this.clientHistory.get(clientKey) || [];
    if (clientData.length >= this.config.minSamplesForOverride) {
      const strategy = this._fromClientHistory(clientData, clientStage);
      if (strategy) {
        this.stats.fromClient++;
        logger.debug(`[StrategySelector] CLIENT history for ${chatId}: ${JSON.stringify(strategy)}`);
        return { ...strategy, source: 'client_history' };
      }
    }

    // 2. Histórico global por goal+stage
    const globalKey = `${responseGoal}:${clientStage}`;
    const globalData = this.globalHistory.get(globalKey) || [];
    if (globalData.length >= this.config.minSamplesForOverride * 2) {
      const strategy = this._fromGlobalHistory(globalData, clientStage);
      if (strategy) {
        this.stats.fromGlobal++;
        logger.debug(`[StrategySelector] GLOBAL history ${globalKey}: ${JSON.stringify(strategy)}`);
        return { ...strategy, source: 'global_history' };
      }
    }

    // 3. Default por estágio
    this.stats.fromDefault++;
    const def = STAGE_DEFAULTS[clientStage] || STAGE_DEFAULTS.cold;
    return { ...def, source: 'stage_default' };
  }

  /**
   * Registra o outcome de uma estratégia para alimentar histórico.
   * Chamado pelo AutoLearningLoop após resolver o outcome.
   *
   * @param {Object} p
   * @param {string} p.chatId
   * @param {string} p.responseGoal
   * @param {string} p.clientStage
   * @param {Object} p.strategy      – Estratégia que foi usada
   * @param {number} p.score         – Score do PerformanceScoreEngine
   * @param {boolean} p.converted    – Houve conversão?
   */
  recordOutcome({ chatId, responseGoal, clientStage, strategy, score, converted }) {
    if (!strategy) return;

    const record = {
      score,
      converted,
      responseGoal,
      clientStage,
      ctaStyle:            strategy.ctaStyle,
      responseLength:      strategy.responseLength,
      toneVariant:         strategy.toneVariant,
      comercialAggression: strategy.comercialAggression,
      recordedAt:          Date.now(),
    };

    // Histórico por cliente
    const clientData = this.clientHistory.get(chatId) || [];
    clientData.push(record);
    if (clientData.length > CLIENT_HISTORY_LIMIT) clientData.shift();
    this.clientHistory.set(chatId, clientData);

    // Histórico global
    const globalKey = `${responseGoal}:${clientStage}`;
    const globalData = this.globalHistory.get(globalKey) || [];
    globalData.push(record);
    if (globalData.length > 200) globalData.shift();
    this.globalHistory.set(globalKey, globalData);
  }

  /**
   * Gera a instrução textual da estratégia para injeção no prompt.
   */
  toPromptInstruction(strategy) {
    const lines = [];

    // Agressividade comercial
    if (strategy.comercialAggression >= 0.7) {
      lines.push('## 💼 Commercial Strategy: ALTA PERFORMANCE');
      lines.push('Este cliente está pronto para decidir. Seja direto, remova obstáculos, conduza ao fechamento.');
    } else if (strategy.comercialAggression >= 0.4) {
      lines.push('## 💼 Commercial Strategy: CONSULTIVA');
      lines.push('Apresente valor, entenda a necessidade, abra caminho para o próximo passo.');
    } else {
      lines.push('## 💼 Commercial Strategy: EXPLORATÓRIA');
      lines.push('Construa relacionamento e confiança. Sem pressão. Foco em informar e gerar interesse.');
    }

    // CTA Style
    const ctaMap = {
      urgent:  'Termine com CTA URGENTE: escassez, prazo ou oportunidade única.',
      direct:  'Termine com CTA DIRETO: pergunta ou proposta clara de próximo passo.',
      soft:    'Termine com CTA SUAVE: convite natural para continuar a conversa.',
    };
    if (ctaMap[strategy.ctaStyle]) lines.push(ctaMap[strategy.ctaStyle]);

    // Response length
    const lenMap = {
      brief:    'Comprimento: CURTO — máximo 2 frases. Vá direto ao ponto.',
      normal:   'Comprimento: NORMAL — até 4 frases. Equilibrado.',
      detailed: 'Comprimento: DETALHADO — explique com profundidade quando necessário.',
    };
    if (lenMap[strategy.responseLength]) lines.push(lenMap[strategy.responseLength]);

    // Tone
    const toneMap = {
      formal:        'Tom: PROFISSIONAL e formal.',
      conversational:'Tom: CONVERSACIONAL e próximo, como um consultor amigável.',
      enthusiastic:  'Tom: ENTUSIASTA e energético — mostre que acredita no produto.',
      direct:        'Tom: DIRETO — sem rodeios, objetivo.',
    };
    if (toneMap[strategy.toneVariant]) lines.push(toneMap[strategy.toneVariant]);

    if (strategy.source && strategy.source !== 'stage_default') {
      lines.push(`_(estratégia baseada em performance histórica: ${strategy.source})_`);
    }

    return lines.join('\n');
  }

  getStats() {
    return {
      ...this.stats,
      clientsTracked:  this.clientHistory.size,
      globalKeys:      this.globalHistory.size,
    };
  }

  // ─── privado ───────────────────────────────────────────────────────────────

  /**
   * Deriva estratégia do histórico específico do cliente.
   * Pega os 10 outcomes mais recentes e identifica o padrão com melhor score.
   */
  _fromClientHistory(data, clientStage) {
    const recent = data.slice(-10);
    if (recent.length < this.config.minSamplesForOverride) return null;

    // Agrupar por combinação de estratégia e calcular score médio
    const combos = {};
    for (const r of recent) {
      const key = `${r.ctaStyle}|${r.responseLength}|${r.toneVariant}`;
      if (!combos[key]) combos[key] = { sum: 0, count: 0, r };
      combos[key].sum += r.score;
      combos[key].count++;
    }

    let bestKey = null, bestAvg = -1;
    for (const [key, c] of Object.entries(combos)) {
      const avg = c.sum / c.count;
      if (avg > bestAvg) { bestAvg = avg; bestKey = key; }
    }

    if (!bestKey || bestAvg < 0.3) return null; // sem sinal claro, usar default

    const best = combos[bestKey].r;
    const defaults = STAGE_DEFAULTS[clientStage] || STAGE_DEFAULTS.cold;

    return {
      comercialAggression: this._avgField(recent, 'comercialAggression') ?? defaults.comercialAggression,
      ctaStyle:            best.ctaStyle    || defaults.ctaStyle,
      responseLength:      best.responseLength || defaults.responseLength,
      toneVariant:         best.toneVariant || defaults.toneVariant,
    };
  }

  /**
   * Deriva estratégia do histórico global para este goal+stage.
   */
  _fromGlobalHistory(data, clientStage) {
    if (data.length < this.config.minSamplesForOverride * 2) return null;

    // Top 20% por score
    const sorted  = [...data].sort((a, b) => b.score - a.score);
    const top     = sorted.slice(0, Math.max(3, Math.floor(sorted.length * 0.2)));
    const defaults = STAGE_DEFAULTS[clientStage] || STAGE_DEFAULTS.cold;

    return {
      comercialAggression: this._avgField(top, 'comercialAggression') ?? defaults.comercialAggression,
      ctaStyle:            this._modeField(top, 'ctaStyle')    || defaults.ctaStyle,
      responseLength:      this._modeField(top, 'responseLength') || defaults.responseLength,
      toneVariant:         this._modeField(top, 'toneVariant') || defaults.toneVariant,
    };
  }

  /** Exploração: seleciona estratégia aleatória dentro de bounds razoáveis */
  _explore(clientStage) {
    const defaults = STAGE_DEFAULTS[clientStage] || STAGE_DEFAULTS.cold;
    const ctaStyles = ['soft', 'direct', 'urgent'];
    const lengths   = ['brief', 'normal', 'detailed'];
    const tones     = ['formal', 'conversational', 'enthusiastic', 'direct'];

    return {
      comercialAggression: Math.min(1, Math.max(0, defaults.comercialAggression + (Math.random() - 0.5) * 0.4)),
      ctaStyle:            ctaStyles[Math.floor(Math.random() * ctaStyles.length)],
      responseLength:      lengths[Math.floor(Math.random() * lengths.length)],
      toneVariant:         tones[Math.floor(Math.random() * tones.length)],
    };
  }

  _avgField(arr, field) {
    const vals = arr.map(r => r[field]).filter(v => typeof v === 'number');
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  _modeField(arr, field) {
    const freq = {};
    for (const r of arr) {
      const v = r[field];
      if (v) freq[v] = (freq[v] || 0) + 1;
    }
    let best = null, bestCount = 0;
    for (const [v, count] of Object.entries(freq)) {
      if (count > bestCount) { bestCount = count; best = v; }
    }
    return best;
  }
}

module.exports = StrategySelector;
