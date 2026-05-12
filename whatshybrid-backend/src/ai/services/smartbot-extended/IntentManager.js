/**
 * IntentManager
 * @file Extraído de SmartBotExtendedService.js (refactor v9)
 */


class IntentManager {
  constructor() {
    this.intents = new Map();
    this.patterns = new Map();
    this.trainingData = [];
    this.confidenceThreshold = 0.6;
    this._registerDefaultIntents();
  }

  _registerDefaultIntents() {
    this.registerIntent('greeting', {
      patterns: [/^(oi|olá|ola|hey|hi|hello|bom dia|boa tarde|boa noite)/i],
      keywords: ['oi', 'olá', 'hello', 'bom dia', 'boa tarde', 'boa noite'],
      priority: 10
    });

    this.registerIntent('farewell', {
      patterns: [/^(tchau|até|bye|adeus|falou|flw|vlw)/i, /(obrigad[oa]|valeu|thanks)/i],
      keywords: ['tchau', 'até mais', 'adeus', 'bye'],
      priority: 10
    });

    this.registerIntent('question', {
      patterns: [/\?$/, /^(como|qual|quando|onde|por ?que|quem|quanto)/i],
      priority: 5
    });

    this.registerIntent('complaint', {
      patterns: [/(problema|erro|bug|não funciona|nao funciona)/i, /(péssimo|pessimo|horrível|horrivel|absurdo)/i],
      keywords: ['problema', 'erro', 'bug', 'reclamação', 'insatisfeito'],
      priority: 15,
      sentiment: 'negative'
    });

    this.registerIntent('urgent', {
      patterns: [/(urgente|urgência|emergência|imediato)/i, /(preciso agora|crítico|critico)/i],
      keywords: ['urgente', 'emergência', 'imediato', 'agora'],
      priority: 20
    });

    this.registerIntent('purchase_interest', {
      patterns: [/(quero|queria|gostaria|interesse|comprar)/i, /(preço|preco|valor|quanto custa)/i],
      keywords: ['comprar', 'preço', 'valor', 'disponível'],
      priority: 12
    });

    this.registerIntent('technical_support', {
      patterns: [/(ajuda|suporte|assistência)/i, /(como faço|não sei|não consigo)/i],
      keywords: ['ajuda', 'suporte', 'como faço'],
      priority: 10
    });

    this.registerIntent('cancellation', {
      patterns: [/(cancelar|cancelamento|desistir)/i, /(estornar|reembolso|devolver)/i],
      keywords: ['cancelar', 'desistir', 'reembolso'],
      priority: 15
    });

    this.registerIntent('thanks', {
      patterns: [/(obrigad[oa]|agradeço|valeu|thanks)/i],
      keywords: ['obrigado', 'obrigada', 'valeu'],
      priority: 8
    });

    this.registerIntent('confirmation', {
      patterns: [/^(sim|ok|certo|correto|isso|confirmo|confirmado)$/i],
      priority: 10
    });

    this.registerIntent('negation', {
      patterns: [/^(não|nao|nunca|negativo|no)$/i],
      priority: 10
    });
  }

  registerIntent(intentId, config) {
    this.intents.set(intentId, {
      id: intentId,
      patterns: config.patterns || [],
      keywords: config.keywords || [],
      priority: config.priority || 0,
      sentiment: config.sentiment || null,
      responses: config.responses || [],
      actions: config.actions || []
    });
  }

  classify(text, context = {}) {
    const scores = new Map();
    const normalizedText = text.toLowerCase().trim();

    this.intents.forEach((intent, intentId) => {
      let score = 0;
      let matchedPatterns = [];

      intent.patterns.forEach(pattern => {
        if (pattern.test(text)) {
          score += 0.4;
          matchedPatterns.push(pattern.toString());
        }
      });

      intent.keywords.forEach(keyword => {
        if (normalizedText.includes(keyword.toLowerCase())) score += 0.2;
      });

      score *= (1 + intent.priority / 100);

      if (context.previousIntent === intentId) score *= 0.8;
      if (context.sentiment && intent.sentiment === context.sentiment) score *= 1.2;

      if (score > 0) scores.set(intentId, { score: Math.min(score, 1), patterns: matchedPatterns });
    });

    this._adjustScoresFromTraining(normalizedText, scores);

    const sorted = Array.from(scores.entries()).sort((a, b) => b[1].score - a[1].score);

    if (sorted.length === 0) return { intent: 'unknown', confidence: 0, alternatives: [] };

    const [topIntent, topData] = sorted[0];
    const alternatives = sorted.slice(1, 4).map(([intent, data]) => ({ intent, confidence: data.score }));

    return {
      intent: topData.score >= this.confidenceThreshold ? topIntent : 'unknown',
      confidence: topData.score,
      matchedPatterns: topData.patterns,
      alternatives,
      allScores: Object.fromEntries(scores)
    };
  }

  _adjustScoresFromTraining(text, scores) {
    const words = new Set(text.split(/\s+/));
    this.trainingData.forEach(example => {
      const exampleWords = new Set(example.text.toLowerCase().split(/\s+/));
      const intersection = new Set([...words].filter(x => exampleWords.has(x)));
      const similarity = intersection.size / Math.max(words.size, exampleWords.size);

      if (similarity > 0.5) {
        const currentScore = scores.get(example.intent)?.score || 0;
        scores.set(example.intent, {
          score: currentScore + similarity * 0.3 * (example.positive ? 1 : -0.5),
          patterns: scores.get(example.intent)?.patterns || []
        });
      }
    });
  }

  addTrainingExample(text, intent, positive = true) {
    this.trainingData.push({ text: text.toLowerCase(), intent, positive, addedAt: Date.now() });
  }

  getIntent(intentId) { return this.intents.get(intentId) || null; }
  listIntents() { return Array.from(this.intents.keys()); }
  setConfidenceThreshold(threshold) { this.confidenceThreshold = threshold; }
}

// ============================================================
// 👥 HUMAN ASSISTANCE SYSTEM
// ============================================================

module.exports = IntentManager;
