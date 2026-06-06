/**
 * 🎭 EmotionToneEngine — percepção de emoção e tom (Camada 1)
 *
 * Detecta o estado EMOCIONAL do cliente (não só intent) a partir da mensagem +
 * histórico recente, e produz uma DIRETRIZ de resposta PROPORCIONAL ao momento —
 * o "responda como um humano responderia" que o operador pediu.
 *
 * Por que existe: o DynamicPromptBuilder já tinha seções de empatia/urgência e
 * de estratégia (Chain-of-Thought), mas elas dependiam de um `analysis` que o
 * AIOrchestrator nunca montava — então ficavam DESLIGADAS. Este motor calcula
 * esse sinal de forma barata (regras pt-BR, sem custo de IA) e o orquestrador o
 * injeta no prompt.
 *
 * 100% à prova de falha: retorna um perfil neutro se algo der errado.
 *
 * @returns {{ emotion, intensity, sentiment, sentimentScore, urgency, guidance }}
 */

'use strict';

// ── Léxicos (pt-BR primeiro; sinais universais como emoji/CAPS valem p/ qualquer idioma) ──
const LEX = {
  anger: [
    'absurdo', 'ridiculo', 'ridículo', 'palhacada', 'palhaçada', 'inaceitavel', 'inaceitável',
    'lixo', 'pessimo', 'péssimo', 'horrivel', 'horrível', 'raiva', 'irritad', 'revoltad',
    'cansei', 'cansad', 'um descaso', 'descaso', 'vergonha', 'porcaria', 'enrolação', 'enrolacao',
    'cade', 'cadê', 'de novo', 'ninguem resolve', 'ninguém resolve', 'me engana', 'enganaram',
  ],
  anxiety: [
    'preocupad', 'ansios', 'aflit', 'nervos', 'medo', 'receio', 'inseguro', 'insegura',
    'sera que', 'será que', 'to com medo', 'tô com medo', 'estou com medo', 'apreensiv',
  ],
  disappointment: [
    'decepcionad', 'desapontad', 'esperava mais', 'que pena', 'frustrad', 'triste',
    'achei que', 'pensei que fosse', 'fiquei chatead',
  ],
  excitement: [
    'amei', 'adorei', 'maravilh', 'perfeito', 'perfeita', 'otimo', 'ótimo', 'excelente',
    'incrivel', 'incrível', 'top', 'sensacional', 'que bom', 'aaa', 'eba', 'uhul', 'show de bola',
    'fechado', 'bora', 'quero muito', 'mal posso esperar',
  ],
  gratitude: [
    'obrigad', 'obg', 'valeu', 'vlw', 'agradeç', 'agradec', 'gratidao', 'gratidão',
    'muito gentil', 'você é demais', 'voce e demais', 'salvou',
  ],
  confusion: [
    'nao entendi', 'não entendi', 'como assim', 'confus', 'fiquei perdid', 'nao sei se',
    'não sei se', 'pode explicar', 'nao compreendi', 'não compreendi', 'que que', 'em que sentido',
  ],
};

const URGENCY_HIGH = [
  'urgente', 'urgencia', 'urgência', 'emergencia', 'emergência', 'agora', 'imediat',
  'pra ontem', 'pra já', 'pra ja', 'rapido', 'rápido', 'rapidinho', 'socorro', 'preciso ja',
];
const URGENCY_MED = ['hoje', 'logo', 'assim que possivel', 'assim que possível', 'o quanto antes', 'ainda hoje'];

const INTENSIFIERS = ['muito', 'demais', 'super', 'extremamente', 'totalmente', 'completamente', 'pra caramba'];
const POSITIVE_EMOJI = /[\u{1F600}-\u{1F60F}\u{1F970}\u{1F60D}\u{2764}\u{2665}\u{1F44D}\u{1F525}\u{1F389}]/u;
const NEGATIVE_EMOJI = /[\u{1F620}-\u{1F624}\u{1F62D}\u{1F61E}\u{1F614}\u{1F44E}\u{1F92C}]/u;

const norm = (s) => String(s || '').toLowerCase();
const countHits = (text, list) => list.reduce((n, kw) => (text.includes(kw) ? n + 1 : n), 0);

// Diretrizes de resposta proporcionais (i18n leve; pt-BR é o principal).
const GUIDANCE = {
  'pt-BR': {
    anger: 'O cliente está irritado/frustrado. Reconheça o incômodo com sinceridade, peça desculpas se fizer sentido e vá DIRETO à solução. Tom calmo, humano e resolutivo. Evite jargão de vendas, respostas longas ou defensivas.',
    anxiety: 'O cliente está ansioso/inseguro. Tranquilize com clareza, passe segurança, dê próximos passos concretos e prazos realistas. Evite tecnicismo.',
    disappointment: 'O cliente está decepcionado. Mostre que entende a frustração, assuma responsabilidade quando couber e ofereça uma saída concreta — não minimize o que ele sentiu.',
    excitement: 'O cliente está animado/satisfeito. Espelhe a energia positiva (sem exagero), reforce que foi uma boa escolha e conduza com naturalidade ao próximo passo.',
    gratitude: 'O cliente demonstrou gratidão. Retribua de forma calorosa e breve e ofereça ajuda adicional, sem encerrar de forma seca.',
    confusion: 'O cliente está confuso. Explique de forma simples e objetiva, em passos curtos, e confirme ao final se ficou claro.',
    neutral: null,
  },
  en: {
    anger: 'The customer is upset/frustrated. Sincerely acknowledge the problem, apologize if appropriate, and go STRAIGHT to the solution. Stay calm, human and resolution-focused. Avoid sales jargon and long, defensive replies.',
    anxiety: 'The customer is anxious/unsure. Reassure clearly, convey safety, and give concrete next steps and realistic timelines. Avoid jargon.',
    disappointment: 'The customer is disappointed. Show you understand, take responsibility when appropriate and offer a concrete way forward — do not minimize their feelings.',
    excitement: 'The customer is excited/happy. Mirror the positive energy (without overdoing it), reinforce their good choice and naturally guide them to the next step.',
    gratitude: 'The customer expressed gratitude. Respond warmly and briefly and offer further help.',
    confusion: 'The customer is confused. Explain simply and step by step, then confirm it is clear.',
    neutral: null,
  },
  es: {
    anger: 'El cliente está molesto/frustrado. Reconoce el problema con sinceridad, discúlpate si corresponde y ve DIRECTO a la solución. Mantén un tono calmado, humano y resolutivo.',
    anxiety: 'El cliente está ansioso/inseguro. Tranquilízalo con claridad, transmite seguridad y da próximos pasos y plazos concretos.',
    disappointment: 'El cliente está decepcionado. Muestra que entiendes, asume responsabilidad cuando corresponda y ofrece una salida concreta.',
    excitement: 'El cliente está entusiasmado. Refleja la energía positiva, refuerza su buena elección y guíalo con naturalidad al siguiente paso.',
    gratitude: 'El cliente mostró gratitud. Responde de forma cálida y breve y ofrece ayuda adicional.',
    confusion: 'El cliente está confundido. Explica de forma simple y por pasos, y confirma si quedó claro.',
    neutral: null,
  },
};

class EmotionToneEngine {
  /**
   * @param {string} message - mensagem atual do cliente
   * @param {Array<{role,content}>} recentMessages - histórico recente (opcional)
   * @param {string} language - 'pt-BR' | 'en' | 'es'
   */
  analyze(message, recentMessages = [], language = 'pt-BR') {
    try {
      const raw = String(message || '');
      const text = norm(raw);
      if (!text.trim()) return this._neutral();

      // Peso extra para a última fala do cliente no histórico (contexto imediato).
      let ctx = '';
      try {
        const lastClient = (Array.isArray(recentMessages) ? recentMessages : [])
          .filter((m) => m && m.role === 'user')
          .slice(-2)
          .map((m) => norm(m.content))
          .join(' ');
        ctx = lastClient;
      } catch (_) { /* histórico é opcional */ }

      // Contagem de sinais por emoção (mensagem atual pesa 2x, contexto 1x).
      const scores = {};
      for (const [emo, list] of Object.entries(LEX)) {
        scores[emo] = countHits(text, list) * 2 + countHits(ctx, list);
      }

      // Sinais universais
      const exclamations = (raw.match(/!/g) || []).length;
      const capsWords = (raw.match(/\b[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{3,}\b/g) || []).length;
      const repeats = /(.)\1{2,}/.test(text); // "muitooo", "ajudaaa"
      const hasIntensifier = INTENSIFIERS.some((w) => text.includes(w));
      if (POSITIVE_EMOJI.test(raw)) scores.excitement += 2;
      if (NEGATIVE_EMOJI.test(raw)) scores.anger += 1;
      if (text.includes('?') || /\?\?+/.test(raw)) scores.confusion += 1;

      // Emoção dominante
      let emotion = 'neutral';
      let best = 0;
      for (const [emo, sc] of Object.entries(scores)) {
        if (sc > best) { best = sc; emotion = emo; }
      }

      // Intensidade 1..5
      let intensity = 1;
      if (best > 0) {
        intensity = 2 + Math.min(2, best - 1);                 // 2..4 por contagem
        if (exclamations >= 3 || capsWords >= 2) intensity++;  // ênfase visual
        if (repeats || hasIntensifier) intensity++;
        intensity = Math.max(1, Math.min(5, intensity));
      } else {
        // Sem emoção marcada, mas com ênfase forte → leve elevação (provável urgência/insatisfação)
        if (exclamations >= 3 || capsWords >= 2) intensity = 2;
      }

      // Sentimento + score
      const NEG = new Set(['anger', 'disappointment', 'anxiety']);
      const POS = new Set(['excitement', 'gratitude']);
      let sentiment = 'neutral';
      let sentimentScore = 0;
      if (NEG.has(emotion)) { sentiment = 'negative'; sentimentScore = -Math.min(0.95, 0.25 + intensity * 0.15); }
      else if (POS.has(emotion)) { sentiment = 'positive'; sentimentScore = Math.min(0.95, 0.25 + intensity * 0.15); }

      // Urgência
      let urgency = 'low';
      if (countHits(text, URGENCY_HIGH) > 0 || (capsWords >= 2 && exclamations >= 2)) urgency = 'high';
      else if (countHits(text, URGENCY_MED) > 0) urgency = 'medium';

      // Diretriz proporcional
      const langKey = String(language || 'pt-BR').startsWith('en') ? 'en'
        : String(language || 'pt-BR').startsWith('es') ? 'es' : 'pt-BR';
      const base = (GUIDANCE[langKey] || GUIDANCE['pt-BR'])[emotion] || null;
      let guidance = base;
      if (guidance && intensity >= 4) {
        const tag = langKey === 'en' ? ' (high intensity — be especially careful and human)'
          : langKey === 'es' ? ' (intensidad alta — sé especialmente cuidadoso y humano)'
          : ' (intensidade alta — seja especialmente cuidadoso e humano)';
        guidance += tag;
      }
      // Urgência alta reforça a diretriz mesmo em emoção neutra.
      if (urgency === 'high') {
        const u = langKey === 'en' ? 'The request is urgent: prioritize, be objective and give a clear timeline.'
          : langKey === 'es' ? 'La solicitud es urgente: prioriza, sé objetivo y da un plazo claro.'
          : 'O pedido é urgente: priorize, seja objetivo e dê um prazo claro.';
        guidance = guidance ? `${guidance}\n${u}` : u;
      }

      return { emotion, intensity, sentiment, sentimentScore, urgency, guidance };
    } catch (_) {
      return this._neutral();
    }
  }

  _neutral() {
    return { emotion: 'neutral', intensity: 1, sentiment: 'neutral', sentimentScore: 0, urgency: 'low', guidance: null };
  }
}

module.exports = EmotionToneEngine;
