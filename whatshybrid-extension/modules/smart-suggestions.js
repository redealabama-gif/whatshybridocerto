/**
 * 💬 Smart Suggestions - Sugestões Inteligentes SEM IA Externa
 *
 * Gera sugestões de resposta baseadas em padrões e contexto,
 * SEM depender de APIs externas de IA (OpenAI, Anthropic, etc.)
 *
 * @version 1.0.0
 */

(function() {
  'use strict';

  if (window.__SMART_SUGGESTIONS_LOADED__) return;
  window.__SMART_SUGGESTIONS_LOADED__ = true;

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[SmartSuggestions]', ...args); }
  let checkAIService = null;

  // ============================================
  // BANCO DE PADRÕES DE RESPOSTA
  // ============================================

  const PATTERNS = {
    // Saudações
    greetings: {
      triggers: ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'eai', 'e ai', 'oie'],
      responses: [
        'Olá! Como posso ajudar você hoje? 😊',
        'Oi! Tudo bem? Em que posso ser útil?',
        'Olá! Seja bem-vindo(a)! Como posso ajudar?',
        'Oi! Estou à disposição. O que você precisa?'
      ]
    },

    // Preço/Valor
    price: {
      triggers: ['preço', 'preco', 'valor', 'quanto custa', 'quanto é', 'quanto e', 'quanto fica', 'custo', 'orçamento', 'orcamento'],
      responses: [
        'O valor varia de acordo com o produto/serviço. Posso detalhar as opções disponíveis para você?',
        'Para informar o valor exato, preciso de mais detalhes. Qual produto ou serviço você tem interesse?',
        'Temos diferentes opções de preço. Qual item específico você gostaria de saber?'
      ]
    },

    // Pagamento
    payment: {
      triggers: ['pix', 'pagamento', 'pagar', 'cartão', 'cartao', 'boleto', 'transferência', 'transferencia', 'forma de pagamento'],
      responses: [
        'Aceitamos PIX, cartão de crédito e boleto. Qual forma de pagamento prefere?',
        'Temos várias formas de pagamento: PIX (com desconto), cartão em até 12x, ou boleto. Qual prefere?',
        'O pagamento pode ser feito via PIX, cartão ou boleto. Posso enviar os dados?'
      ]
    },

    // Entrega/Prazo
    delivery: {
      triggers: ['entrega', 'prazo', 'frete', 'envio', 'quando chega', 'demora', 'dias'],
      responses: [
        'O prazo de entrega é de 5 a 7 dias úteis após a confirmação do pagamento.',
        'A entrega geralmente leva de 3 a 10 dias úteis, dependendo da região. Posso verificar para seu CEP?',
        'Trabalhamos com entrega expressa (2-3 dias) e normal (5-7 dias). Qual prefere?'
      ]
    },

    // Disponibilidade
    availability: {
      triggers: ['disponível', 'disponivel', 'tem', 'estoque', 'possui', 'vocês tem', 'voces tem'],
      responses: [
        'Vou verificar a disponibilidade e já retorno. Um momento, por favor.',
        'Deixa eu confirmar se temos em estoque. Qual cor/tamanho você precisa?',
        'Posso verificar a disponibilidade para você. Qual a especificação desejada?'
      ]
    },

    // Agradecimento
    thanks: {
      triggers: ['obrigado', 'obrigada', 'valeu', 'agradeço', 'agradeco', 'muito obrigado', 'vlw', 'thanks'],
      responses: [
        'Por nada! Se precisar de mais alguma coisa, estou à disposição 😊',
        'Disponha! Foi um prazer ajudar!',
        'Imagina! Qualquer dúvida, pode chamar!',
        'De nada! Conte comigo sempre que precisar!'
      ]
    },

    // Despedida
    goodbye: {
      triggers: ['tchau', 'até mais', 'ate mais', 'até logo', 'ate logo', 'flw', 'falou', 'bye'],
      responses: [
        'Até mais! Foi um prazer atendê-lo(a)! 😊',
        'Tchau! Tenha um ótimo dia!',
        'Até logo! Volte sempre!',
        'Obrigado pelo contato! Até a próxima!'
      ]
    },

    // Reclamação
    complaint: {
      triggers: ['problema', 'reclamação', 'reclamacao', 'erro', 'defeito', 'não funciona', 'nao funciona', 'ruim', 'péssimo', 'pessimo'],
      responses: [
        'Lamento muito pelo inconveniente. Pode me descrever o problema com mais detalhes para que eu possa ajudar?',
        'Sinto muito por isso. Vou verificar o que aconteceu e resolver da melhor forma possível.',
        'Peço desculpas pelo ocorrido. Pode me passar mais informações para eu entender e resolver?'
      ]
    },

    // Dúvida genérica
    question: {
      triggers: ['dúvida', 'duvida', 'como funciona', 'pode me explicar', 'não entendi', 'nao entendi', 'me explica', '?'],
      responses: [
        'Claro! Vou explicar. Qual sua dúvida específica?',
        'Com certeza! O que você gostaria de saber?',
        'Sem problemas! Me conta o que não ficou claro.'
      ]
    },

    // Informações/Horário
    info: {
      triggers: ['horário', 'horario', 'atendimento', 'funciona', 'abre', 'fecha', 'endereço', 'endereco', 'localização', 'localizacao'],
      responses: [
        'Nosso horário de atendimento é de segunda a sexta, das 9h às 18h.',
        'Funcionamos de segunda a sexta das 9h às 18h, e sábados das 9h às 13h.',
        'Posso fornecer mais informações. O que você precisa saber?'
      ]
    },

    // Urgência
    urgent: {
      triggers: ['urgente', 'urgência', 'urgencia', 'rápido', 'rapido', 'agora', 'imediato', 'pressa'],
      responses: [
        'Entendo a urgência! Vou priorizar seu atendimento. Como posso ajudar?',
        'Vou agilizar o máximo possível. Me passa os detalhes?',
        'Compreendo! Vamos resolver isso o mais rápido possível.'
      ]
    },

    // Aguardar
    wait: {
      triggers: ['esperar', 'aguardar', 'momento', 'já volto', 'ja volto', 'um minuto', '1 min'],
      responses: [
        'Sem problemas! Estarei aqui quando você voltar.',
        'Ok! Aguardo seu retorno.',
        'Tudo bem! Me chama quando puder.'
      ]
    },

    // Mídia/Áudio/Imagem (tolerante a formatos de placeholder)
    media: {
      triggers: [
        '[mídia: imagem]', '[mídia: áudio]', '[mídia: vídeo]', '[mídia: figurinha]', '[mídia: documento]', '[mídia]',
        '[midia: imagem]', '[midia: audio]', '[midia: video]', '[midia: figurinha]', '[midia]',
        'mídia', 'midia', 'imagem', 'áudio', 'audio', 'vídeo', 'video', 'figurinha', 'sticker', 'documento'
      ],
      responses: [
        'Recebi seu arquivo. Só um momento enquanto verifico.',
        'Obrigado pelo envio! Vou analisar e já te retorno.',
        'Recebido! Já vou olhar.'
      ]
    }
  };

  // Respostas padrão quando nenhum padrão é encontrado
  const DEFAULT_RESPONSES = [
    'Entendi. Como posso ajudar com isso?',
    'Certo! Pode me dar mais detalhes?',
    'Ok! Em que posso ser útil?',
    'Compreendo. Posso ajudar com mais alguma informação?'
  ];

  // ============================================
  // ANÁLISE DE MENSAGEM
  // ============================================

  function analyzeMessage(message) {
    if (!message || typeof message !== 'string') return null;

    const lower = message.toLowerCase().trim();
    const matches = [];

    // Verificar cada padrão
    for (const [category, data] of Object.entries(PATTERNS)) {
      for (const trigger of data.triggers) {
        if (lower.includes(trigger)) {
          matches.push({
            category,
            trigger,
            confidence: calculateConfidence(lower, trigger),
            responses: data.responses
          });
          break; // Apenas um match por categoria
        }
      }
    }

    // Ordenar por confiança
    matches.sort((a, b) => b.confidence - a.confidence);

    return matches.length > 0 ? matches[0] : null;
  }

  function calculateConfidence(message, trigger) {
    // Maior confiança se o trigger está no início ou é a mensagem toda
    if (message === trigger) return 1.0;
    if (message.startsWith(trigger)) return 0.9;
    if (message.endsWith(trigger)) return 0.8;
    
    // Verificar proporção
    const ratio = trigger.length / message.length;
    return Math.min(0.7, ratio + 0.3);
  }

  // ============================================
  // GERAÇÃO DE SUGESTÃO
  // ============================================

  function generateSuggestion(lastMessage, conversationContext = []) {
    log('Gerando sugestão para:', lastMessage);

    // Analisar última mensagem
    const analysis = analyzeMessage(lastMessage);

    if (analysis) {
      // Escolher resposta aleatória do padrão
      const responses = analysis.responses;
      const suggestion = responses[Math.floor(Math.random() * responses.length)];
      
      log('Padrão encontrado:', analysis.category, '- Confiança:', analysis.confidence);
      
      return {
        text: suggestion,
        category: analysis.category,
        confidence: analysis.confidence,
        source: 'pattern_match'
      };
    }

    // Fallback: resposta padrão
    const defaultSuggestion = DEFAULT_RESPONSES[Math.floor(Math.random() * DEFAULT_RESPONSES.length)];
    
    return {
      text: defaultSuggestion,
      category: 'default',
      confidence: 0.3,
      source: 'fallback'
    };
  }

  // ============================================
  // ANÁLISE DE CONTEXTO
  // ============================================

  function analyzeConversation(messages) {
    if (!messages || messages.length === 0) return null;

    // Extrair tópicos da conversa
    const topics = new Set();
    const sentiment = { positive: 0, negative: 0, neutral: 0 };

    for (const msg of messages) {
      const content = (msg.content || msg.text || '').toLowerCase();
      
      // Detectar tópicos
      for (const [category] of Object.entries(PATTERNS)) {
        const data = PATTERNS[category];
        if (data.triggers.some(t => content.includes(t))) {
          topics.add(category);
        }
      }

      // Detectar sentimento básico
      if (content.match(/obrigad|perfeito|ótimo|otimo|maravilh|excelente|bom|legal/)) {
        sentiment.positive++;
      } else if (content.match(/problema|erro|ruim|péssimo|pessimo|horrível|horrivel|decepcion/)) {
        sentiment.negative++;
      } else {
        sentiment.neutral++;
      }
    }

    return {
      topics: Array.from(topics),
      sentiment: sentiment.negative > sentiment.positive ? 'negative' : 
                 sentiment.positive > sentiment.negative ? 'positive' : 'neutral',
      messageCount: messages.length
    };
  }

  // ============================================
  // API PÚBLICA
  // ============================================

  function getSuggestion(lastMessage, context = []) {
    try {
      return generateSuggestion(lastMessage, context);
    } catch (error) {
      console.error('[SmartSuggestions] Erro:', error);
      return {
        text: 'Como posso ajudar?',
        category: 'error',
        confidence: 0.1,
        source: 'error_fallback'
      };
    }
  }

  function getMultipleSuggestions(lastMessage, count = 3) {
    const suggestions = [];
    const analysis = analyzeMessage(lastMessage);

    if (analysis && analysis.responses) {
      // Pegar múltiplas respostas do mesmo padrão
      const shuffled = [...analysis.responses].sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(count, shuffled.length); i++) {
        suggestions.push({
          text: shuffled[i],
          category: analysis.category,
          confidence: analysis.confidence - (i * 0.1),
          source: 'pattern_match'
        });
      }
    }

    // Completar com defaults se necessário
    while (suggestions.length < count) {
      const defaultSuggestion = DEFAULT_RESPONSES[suggestions.length % DEFAULT_RESPONSES.length];
      suggestions.push({
        text: defaultSuggestion,
        category: 'default',
        confidence: 0.2,
        source: 'fallback'
      });
    }

    return suggestions;
  }

  function addCustomPattern(category, triggers, responses) {
    if (!category || !triggers || !responses) return false;

    PATTERNS[category] = {
      triggers: Array.isArray(triggers) ? triggers : [triggers],
      responses: Array.isArray(responses) ? responses : [responses]
    };

    log('Padrão customizado adicionado:', category);
    return true;
  }

  function getPatterns() {
    return { ...PATTERNS };
  }

  // ============================================
  // INTEGRAÇÃO COM AIService
  // ============================================

  // Sobrescrever AIService.generateResponse — APENAS quando NÃO existir
  // nenhum provider OU backend disponível. O patch antigo era agressivo
  // demais: gateava só por `getConfiguredProviders().length > 0`, que volta
  // [] em vários cenários comuns (configuração via backend, cache frio,
  // master-token só salvo no whl_auth_token sem refresh do AIService).
  // Resultado: AIService real era pulado e o usuário via canned templates
  // ("Entendi, posso ajudar com mais alguma informação?") apesar do
  // backend estar perfeitamente acessível.
  function patchAIService() {
    if (!window.AIService) return;

    const originalGenerateResponse = window.AIService.generateResponse;
    const originalGenerateText = window.AIService.generateText;

    // Verificação mais inteligente: tem provider local OU backend OK OU
    // master-token persistido. Qualquer um desses == NÃO usar fallback.
    const hasAnyAIPath = () => {
      try {
        const providers = window.AIService.getConfiguredProviders?.();
        if (providers && providers.length > 0) return true;
      } catch (_) { /* segue */ }
      try {
        if (window.BackendClient && typeof window.BackendClient.isConnected === 'function' && window.BackendClient.isConnected()) return true;
      } catch (_) { /* segue */ }
      try {
        if (window.CopilotEngine && typeof window.CopilotEngine.generateResponse === 'function') return true;
      } catch (_) { /* segue */ }
      return false;
    };

    // Patch generateResponse
    window.AIService.generateResponse = async function(message, context = [], options = {}) {
      // Sempre tenta o AIService real PRIMEIRO. Só cai no fallback canned
      // se o original throw E não houver nenhuma alternativa viva. Com isto,
      // se o backend está só temporariamente em 429 e o originalGenerateResponse
      // joga, ainda tentamos via fallback — mas se o backend funciona, o
      // usuário vê resposta coerente do provider real.
      if (originalGenerateResponse) {
        try {
          const r = await originalGenerateResponse.call(this, message, context, options);
          if (r && (r.content || r.text)) return r;
        } catch (error) {
          log('AIService.generateResponse falhou:', error.message);
        }
      }

      // Só agora cai no canned local — e mesmo assim só se não há
      // NENHUM caminho de IA viva (provider + backend + copilot todos off).
      if (hasAnyAIPath()) {
        // Há caminho mas falhou — propaga erro pra UI mostrar real
        throw new Error('IA temporariamente indisponível');
      }

      log('Usando SmartSuggestions como fallback (nenhum provider/backend disponível)');
      const suggestion = getSuggestion(message, context);
      return {
        content: suggestion.text,
        provider: 'smart_suggestions_local',
        model: 'pattern_matching',
        usage: { totalTokens: 0 },
        confidence: suggestion.confidence
      };
    };

    // Patch generateText — mesma lógica
    window.AIService.generateText = async function(prompt, options = {}) {
      if (originalGenerateText) {
        try {
          const r = await originalGenerateText.call(this, prompt, options);
          if (r && (r.content || r.text)) return r;
        } catch (error) {
          log('AIService.generateText falhou:', error.message);
        }
      }

      // Fallback
      const suggestion = getSuggestion(prompt);
      return {
        content: suggestion.text,
        provider: 'smart_suggestions_local',
        model: 'pattern_matching',
        usage: { totalTokens: 0 }
      };
    };

    log('✅ AIService patcheado com fallback local');
  }

  // ============================================
  // INICIALIZAÇÃO
  // ============================================

  function init() {
    log('Inicializando SmartSuggestions...');
    
    // Aguardar AIService e fazer patch
    if (checkAIService) clearInterval(checkAIService);
    checkAIService = setInterval(() => {
      if (window.AIService) {
        clearInterval(checkAIService);
        checkAIService = null;
        patchAIService();
      }
    }, 500);

    // Timeout após 10 segundos
    setTimeout(() => {
      if (checkAIService) {
        clearInterval(checkAIService);
        checkAIService = null;
      }
    }, 10000);

    log('✅ SmartSuggestions inicializado');
  }

  // Expor API
  window.SmartSuggestions = {
    init,
    getSuggestion,
    getMultipleSuggestions,
    analyzeMessage,
    analyzeConversation,
    addCustomPattern,
    getPatterns,
    PATTERNS,
    DEFAULT_RESPONSES
  };

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', () => {
    if (checkAIService) {
      clearInterval(checkAIService);
      checkAIService = null;
    }
  });

  log('Módulo SmartSuggestions carregado');
})();
