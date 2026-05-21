/**
 * Lightweight language detector for pt-BR / es / en.
 *
 * Heuristic stopword + diacritic scoring — no external deps, no LLM call.
 * Used to auto-detect the language of an inbound customer message so the
 * AI pipeline can reply in the same language (overrides the workspace's
 * configured default).
 *
 * Returns 'pt-BR', 'es', 'en', or null when the text is too short or the
 * result is ambiguous — in that case the caller should fall back to the
 * workspace's configured ai_language (or 'pt-BR').
 */

'use strict';

// Distinctive tokens only. Shared pt/es words ("para", "con", "una",
// "está", "comprar", "entrega") are intentionally excluded — they add
// equally to both scores and would just inflate noise.
const MARKERS = {
  'pt-BR': {
    words: ['você', 'vocês', 'não', 'obrigado', 'obrigada', 'quero', 'queria',
      'preço', 'quanto', 'custa', 'vc', 'pra', 'também', 'fazer', 'hoje',
      'amanhã', 'isso', 'esse', 'olá', 'oi', 'tudo', 'gostaria', 'poderia',
      'dúvida', 'whatsapp', 'voltar', 'enviar', 'mensagem'],
    regex: [/ç/i, /ã[oe]/i, /õe/i, /\bnão\b/i, /\bvocê/i],
  },
  es: {
    words: ['hola', 'gracias', 'quiero', 'quería', 'precio', 'cuánto', 'cuesta',
      'usted', 'ustedes', 'buenos', 'días', 'tardes', 'noches', 'también',
      'hacer', 'ahora', 'mañana', 'esto', 'quisiera', 'podría', 'qué', 'cómo',
      'duda', 'enviar', 'mensaje', 'pregunta'],
    regex: [/ñ/i, /¿/, /¡/, /\bgracias\b/i, /\bhola\b/i],
  },
  en: {
    words: ['the', 'you', 'your', 'want', 'price', 'how', 'much', 'hello', 'hi',
      'thanks', 'thank', 'please', 'can', 'could', 'would', 'this', 'that',
      'today', 'tomorrow', 'with', 'for', 'buy', 'need', 'have', 'good',
      'morning', 'question', 'message', 'send'],
    regex: [/\bthe\b/i, /\byou\b/i, /\bthanks?\b/i, /\bplease\b/i],
  },
};

/**
 * @param {string} text - the inbound message text
 * @returns {('pt-BR'|'es'|'en'|null)}
 */
function detectLanguage(text) {
  if (typeof text !== 'string') return null;
  const clean = text.toLowerCase().trim();
  if (clean.length < 6) return null;

  const tokens = clean.split(/[^a-záàâãéêíóôõúüñ]+/i).filter(Boolean);
  if (tokens.length < 2) return null;

  const scores = { 'pt-BR': 0, es: 0, en: 0 };
  for (const [lang, marker] of Object.entries(MARKERS)) {
    const wordSet = new Set(marker.words);
    for (const t of tokens) {
      if (wordSet.has(t)) scores[lang] += 1;
    }
    for (const re of marker.regex) {
      if (re.test(text)) scores[lang] += 1.5;
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topLang, topScore] = ranked[0];
  const secondScore = ranked[1][1];

  // Require a real signal and a clear margin over the runner-up,
  // otherwise stay undecided and let the caller use the default.
  if (topScore < 2) return null;
  if (topScore - secondScore < 1.5) return null;
  return topLang;
}

module.exports = { detectLanguage };
