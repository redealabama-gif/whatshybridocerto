/**
 * specialized-assistants.js — v9.5.5
 *
 * Domain-specific assistant routing. Adopted pattern from RedeAlabama's
 * vendedor_ia_console.php which instantiates 3 separate LlmServices for
 * sales offer / objection handling / recovery campaigns.
 *
 * Instead of a single generic prompt for every customer message, this module
 * detects the conversational situation and adds a specialized "playbook" block
 * to the system prompt. The base system prompt and persona still apply — the
 * specialist additions narrow the model's focus for that turn.
 *
 * Public API:
 *   window.WHLAssistants.pickAssistant(transcript, lastUserMsg, profile?) →
 *     { id, name, promptAddition, examples, confidence } | null
 *
 *   window.WHLAssistants.list() → assistant[]
 *   window.WHLAssistants.register(assistant) → void   (allow user-defined)
 */
(function() {
  'use strict';

  const MIN_CONFIDENCE = 0.55;

  function asLower(s) { return String(s || '').toLowerCase(); }
  function anyMatch(text, list) {
    return list.some(p => p instanceof RegExp ? p.test(text) : asLower(text).includes(p));
  }

  // -----------------------------------------------------------------------
  // 1. SmartOffer — customer signals price interest / asks for discount.
  // -----------------------------------------------------------------------
  const SmartOfferAssistant = {
    id: 'sales_smart_offer',
    name: 'Especialista em Ofertas',
    triggers: {
      keywords: ['desconto', 'promocao', 'promoção', 'oferta', 'cupom', 'mais barato',
                 'tem condicao', 'tem condição', 'à vista', 'a vista', 'parcelamento',
                 'parcelar', 'pix tem desconto', 'preço', 'preco', 'valor'],
      regex: [/quanto.*custa/i, /qual.*o.*preço/i, /é.*caro/i],
    },
    promptAddition: [
      'PLAYBOOK: Especialista em ofertas e fechamento.',
      'Quando o cliente sinaliza interesse em preço/desconto:',
      '1. Confirme o produto/serviço de interesse antes de cotar.',
      '2. Apresente o preço cheio com confiança (sem se desculpar).',
      '3. Ofereça UMA condição diferenciada concreta (ex: 10% à vista no PIX, parcelamento em 3x sem juros).',
      '4. Crie urgência sutil ("essa condição vale até hoje", "última unidade") apenas se for verdade.',
      '5. Termine com pergunta de avanço ("posso reservar para você?", "consigo enviar agora?").',
      'NUNCA invente desconto que não está autorizado pelo CONTEXTO DO NEGÓCIO.',
    ].join('\n'),
    examples: [
      { user: 'Qual o valor?', assistant: 'O valor é R$ 199. À vista no PIX fica R$ 179 — quer que eu separe pra você?' },
      { user: 'Tem desconto?', assistant: 'Tenho! No PIX à vista, 10% de desconto. Posso reservar?' },
    ],
  };

  // -----------------------------------------------------------------------
  // 2. ObjectionHandler — customer is hesitating / objecting.
  // -----------------------------------------------------------------------
  const ObjectionAssistant = {
    id: 'sales_objection',
    name: 'Resolução de Objeções',
    triggers: {
      keywords: ['ta caro', 'tá caro', 'muito caro', 'caro demais', 'não cabe',
                 'nao cabe', 'sem dinheiro', 'sem grana', 'não tenho como',
                 'nao tenho como', 'achei caro', 'fora do orçamento',
                 'fora do orcamento', 'preciso pensar', 'vou pensar',
                 'depois eu vejo', 'volto outra hora', 'qualquer coisa eu volto',
                 'não vou querer', 'nao vou querer', 'desisti'],
      regex: [/dá.*pra.*fazer.*menos/i, /dá.*pra.*baixar/i, /não.*tenho.*condi/i],
    },
    promptAddition: [
      'PLAYBOOK: Especialista em resolver objeções de venda.',
      'O cliente está hesitando. NÃO pressione. Sequência recomendada:',
      '1. Acolha a objeção sem combater ("entendo perfeitamente, faz sentido pensar").',
      '2. Faça UMA pergunta para entender a objeção real (preço? confiança? prazo? especificação?).',
      '3. Se a objeção é preço, ofereça parcelamento OU produto alternativo de menor valor (não baixe o preço sem autorização).',
      '4. Se a objeção é confiança, traga prova social (avaliações, garantia, política de troca).',
      '5. Se a objeção é "vou pensar", agradeça e proponha follow-up concreto ("posso te chamar amanhã às 10h?").',
      'Tom: empático, sem pressão. Nunca diga "deixa eu te convencer".',
    ].join('\n'),
    examples: [
      { user: 'Achei caro', assistant: 'Entendo. Posso te perguntar: ficou caro pelo orçamento agora ou pelo valor em si? Te ajudo a achar a melhor opção.' },
      { user: 'Vou pensar', assistant: 'Tranquilo, decisão importante mesmo. Posso te chamar amanhã pra ver se ficou alguma dúvida?' },
    ],
  };

  // -----------------------------------------------------------------------
  // 3. RecoveryCampaign — re-engaging a dormant customer.
  // -----------------------------------------------------------------------
  const RecoveryAssistant = {
    id: 'sales_recovery',
    name: 'Recuperação de Cliente',
    // Triggered by profile, not message keywords — see pickAssistant().
    triggers: { keywords: [], regex: [] },
    activatesWhen: (transcript, lastUserMsg, profile) => {
      // Profile heuristic: customer hasn't engaged in 30+ days, OR conversation
      // is just resuming after a long gap.
      if (profile?.daysSinceLastContact >= 30) return true;
      if (profile?.lastContact && (Date.now() - profile.lastContact) > 30 * 86400000) return true;
      // OR last user message is a simple greeting after a long silence detected
      // by the conversation count being low.
      return false;
    },
    promptAddition: [
      'PLAYBOOK: Recuperação de cliente dormente.',
      'Este cliente já interagiu antes mas ficou parado por mais de 30 dias.',
      '1. Cumprimente sem cobrança ("oi, tudo bem?", NÃO "sumiu, hein?").',
      '2. Faça referência sutil a interação anterior se houver dado no perfil ("vi que você se interessou por X").',
      '3. Traga novidade real ou condição especial de retorno (não force um pitch).',
      '4. Seja breve — máx 2 frases. Cliente reativado responde a leveza, não a esforço.',
      '5. Termine com pergunta aberta de baixo compromisso ("alguma coisa que posso te mostrar hoje?").',
    ].join('\n'),
    examples: [
      { user: 'Oi', assistant: 'Olá! Tudo bem? Que bom te ver de novo. Tem alguma coisa nova que posso te mostrar?' },
    ],
  };

  // -----------------------------------------------------------------------
  // Registry & router
  // -----------------------------------------------------------------------
  const registry = [SmartOfferAssistant, ObjectionAssistant, RecoveryAssistant];

  function scoreAssistant(assistant, transcript, lastUserMsg, profile) {
    // activatesWhen takes precedence — gives 1.0 confidence when true.
    if (typeof assistant.activatesWhen === 'function') {
      try {
        if (assistant.activatesWhen(transcript, lastUserMsg, profile)) return 1.0;
      } catch (_) {}
    }
    const text = lastUserMsg || transcript || '';
    if (!text) return 0;
    const triggers = assistant.triggers || {};
    const kw = Array.isArray(triggers.keywords) ? triggers.keywords : [];
    const rx = Array.isArray(triggers.regex) ? triggers.regex : [];
    let hits = 0;
    if (anyMatch(text, kw)) hits += 1;
    if (anyMatch(text, rx)) hits += 1;
    if (!hits) return 0;
    // 1 hit = 0.7, 2 hits = 0.95.
    return hits === 1 ? 0.7 : 0.95;
  }

  function pickAssistant(transcript, lastUserMsg, profile) {
    let best = null;
    for (const a of registry) {
      const c = scoreAssistant(a, transcript, lastUserMsg, profile);
      if (c >= MIN_CONFIDENCE && (!best || c > best.confidence)) {
        best = { id: a.id, name: a.name, promptAddition: a.promptAddition, examples: a.examples || [], confidence: c };
      }
    }
    return best;
  }

  function register(assistant) {
    if (!assistant || !assistant.id || !assistant.promptAddition) return false;
    registry.push(assistant);
    return true;
  }

  function list() {
    return registry.map(a => ({ id: a.id, name: a.name }));
  }

  if (typeof window !== 'undefined') {
    window.WHLAssistants = { pickAssistant, register, list };
    console.log('[SpecializedAssistants] ✅ Loaded with', registry.length, 'assistants');
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { pickAssistant, register, list };
  }
})();
