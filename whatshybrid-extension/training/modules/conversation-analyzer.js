/**
 * 🔄 Conversation Analyzer - Aprendizado com Conversas Reais
 * Importa e analisa histórico de conversas para aprendizado
 * 
 * @version 1.0.0
 */

class ConversationAnalyzer {
  constructor() {
    this.conversations = [];
    this.learnedExamples = [];
    this.patterns = new Map();
  }

  // ============================================
  // IMPORTAÇÃO DE CONVERSAS
  // ============================================

  /**
   * Importa conversas de arquivo exportado do WhatsApp
   * @param {File} file - Arquivo .txt do WhatsApp
   */
  async importWhatsAppExport(file) {
    const text = await file.text();
    const messages = this.parseWhatsAppExport(text);
    
    const conversation = {
      id: `conv_${Date.now()}`,
      source: file.name,
      messages,
      importedAt: Date.now()
    };

    this.conversations.push(conversation);
    
    return {
      conversationId: conversation.id,
      messageCount: messages.length,
      participants: [...new Set(messages.map(m => m.sender))]
    };
  }

  /**
   * Parser do formato de exportação do WhatsApp
   */
  parseWhatsAppExport(text) {
    const messages = [];
    const lines = text.split('\n');
    
    // Padrão: [DD/MM/YYYY, HH:MM:SS] Sender: Message
    // ou: DD/MM/YYYY HH:MM - Sender: Message
    const patterns = [
      /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*-?\s*([^:]+):\s*(.+)$/,
      /^(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2})\s*-\s*([^:]+):\s*(.+)$/
    ];

    let currentMessage = null;

    for (const line of lines) {
      let matched = false;

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          if (currentMessage) {
            messages.push(currentMessage);
          }
          
          currentMessage = {
            date: match[1],
            time: match[2],
            sender: match[3].trim(),
            content: match[4].trim(),
            isMedia: match[4].includes('<Mídia oculta>') || match[4].includes('<Media omitted>')
          };
          matched = true;
          break;
        }
      }

      // Linha de continuação
      if (!matched && currentMessage && line.trim()) {
        currentMessage.content += '\n' + line.trim();
      }
    }

    if (currentMessage) {
      messages.push(currentMessage);
    }

    return messages;
  }

  /**
   * Importa conversas de JSON estruturado
   */
  async importJSON(file) {
    const text = await file.text();
    const data = JSON.parse(text);

    if (Array.isArray(data)) {
      this.conversations.push(...data.map((conv, idx) => ({
        id: `conv_json_${Date.now()}_${idx}`,
        ...conv,
        importedAt: Date.now()
      })));
    } else if (data.messages) {
      this.conversations.push({
        id: `conv_json_${Date.now()}`,
        messages: data.messages,
        importedAt: Date.now()
      });
    }

    return { imported: this.conversations.length };
  }

  // ============================================
  // ANÁLISE DE CONVERSAS
  // ============================================

  /**
   * Analisa uma conversa e identifica bons exemplos de resposta
   */
  analyzeConversation(conversationId, attendantNames = []) {
    const conversation = this.conversations.find(c => c.id === conversationId);
    if (!conversation) return null;

    const examples = [];
    const messages = conversation.messages;

    // Identificar quem é atendente vs cliente
    const senders = [...new Set(messages.map(m => m.sender))];
    const attendant = attendantNames.length > 0 
      ? senders.find(s => attendantNames.some(n => s.toLowerCase().includes(n.toLowerCase())))
      : senders[0]; // Assume primeiro como atendente se não especificado

    // Extrair pares pergunta-resposta
    for (let i = 0; i < messages.length - 1; i++) {
      const msg = messages[i];
      const nextMsg = messages[i + 1];

      // Cliente pergunta, atendente responde
      if (msg.sender !== attendant && nextMsg.sender === attendant) {
        // Pular mensagens de mídia
        if (msg.isMedia || nextMsg.isMedia) continue;
        
        // Pular mensagens muito curtas
        if (msg.content.length < 10 || nextMsg.content.length < 20) continue;

        const example = {
          id: `ex_${Date.now()}_${i}`,
          input: msg.content,
          output: nextMsg.content,
          context: {
            conversationId,
            position: i,
            date: msg.date
          },
          quality: this.estimateQuality(msg.content, nextMsg.content),
          category: this.detectCategory(msg.content),
          intent: this.detectIntent(msg.content)
        };

        examples.push(example);
      }
    }

    return {
      conversationId,
      totalMessages: messages.length,
      extractedExamples: examples.length,
      examples
    };
  }

  /**
   * Estima qualidade do exemplo baseado em heurísticas
   */
  estimateQuality(question, answer) {
    let score = 5;

    // Tamanho adequado da resposta
    if (answer.length > 50 && answer.length < 500) score += 1;
    if (answer.length > 100) score += 1;

    // Resposta não é apenas "sim" ou "não"
    if (answer.toLowerCase().trim() !== 'sim' && answer.toLowerCase().trim() !== 'não') {
      score += 1;
    }

    // Contém saudação ou agradecimento
    if (/obrigad|agradeç|prazer|ajudar/i.test(answer)) score += 0.5;

    // Não contém erros óbvios
    if (!/kkkk|kkk|haha|rsrs/i.test(answer)) score += 0.5;

    return Math.min(10, Math.round(score));
  }

  /**
   * Detecta categoria da pergunta
   */
  detectCategory(text) {
    const categories = {
      preco: /pre[çc]o|valor|custa|quanto/i,
      disponibilidade: /tem|dispon[íi]vel|estoque|entrega/i,
      suporte: /problema|erro|n[ãa]o funciona|ajuda/i,
      duvida: /como|onde|quando|qual|porque/i,
      compra: /comprar|pedido|pagar|pagamento/i,
      reclamacao: /reclama|insatisf|péssimo|horrível/i
    };

    for (const [cat, regex] of Object.entries(categories)) {
      if (regex.test(text)) return cat;
    }

    return 'geral';
  }

  /**
   * Detecta intenção da mensagem
   */
  detectIntent(text) {
    const intents = {
      greeting: /^(oi|olá|bom dia|boa tarde|boa noite|hey|hello)/i,
      question_price: /pre[çc]o|valor|custa|quanto/i,
      question_availability: /tem|dispon[íi]vel|estoque/i,
      buy_intent: /quero comprar|vou levar|fecha|fechar/i,
      complaint: /reclama|problema|insatisf/i,
      thanks: /obrigad|agradeç|valeu/i,
      farewell: /tchau|até|adeus|falou/i
    };

    for (const [intent, regex] of Object.entries(intents)) {
      if (regex.test(text)) return intent;
    }

    return 'general';
  }

  // ============================================
  // PADRÕES E INSIGHTS
  // ============================================

  /**
   * Identifica padrões de sucesso nas conversas
   */
  identifySuccessPatterns() {
    const patterns = {
      goodOpenings: [],
      effectiveResponses: [],
      conversionPhrases: [],
      recoveryStrategies: []
    };

    this.learnedExamples.forEach(ex => {
      if (ex.quality >= 8) {
        // Boas aberturas
        if (ex.intent === 'greeting') {
          patterns.goodOpenings.push(ex.output);
        }
        
        // Frases de conversão
        if (/fechar|comprar|pedido/i.test(ex.input)) {
          patterns.conversionPhrases.push(ex.output);
        }
      }
    });

    return patterns;
  }

  /**
   * Gera relatório de análise
   */
  generateReport() {
    const report = {
      totalConversations: this.conversations.length,
      totalMessages: this.conversations.reduce((sum, c) => sum + (c.messages?.length || 0), 0),
      extractedExamples: this.learnedExamples.length,
      categoriesDistribution: {},
      qualityDistribution: { high: 0, medium: 0, low: 0 },
      topIntents: {}
    };

    this.learnedExamples.forEach(ex => {
      // Categorias
      report.categoriesDistribution[ex.category] = (report.categoriesDistribution[ex.category] || 0) + 1;
      
      // Qualidade
      if (ex.quality >= 8) report.qualityDistribution.high++;
      else if (ex.quality >= 5) report.qualityDistribution.medium++;
      else report.qualityDistribution.low++;

      // Intenções
      report.topIntents[ex.intent] = (report.topIntents[ex.intent] || 0) + 1;
    });

    return report;
  }

  // ============================================
  // EXPORTAÇÃO PARA TREINAMENTO
  // ============================================

  /**
   * Aprova exemplos para treinamento
   */
  approveExamples(exampleIds) {
    const approved = [];
    
    exampleIds.forEach(id => {
      const example = this.learnedExamples.find(e => e.id === id);
      if (example) {
        example.approved = true;
        approved.push(example);
      }
    });

    return approved;
  }

  /**
   * Exporta exemplos aprovados para o sistema de few-shot
   */
  async exportToFewShot() {
    const approved = this.learnedExamples.filter(e => e.approved);
    
    if (window.fewShotLearning) {
      for (const ex of approved) {
        await window.fewShotLearning.addExample({
          input: ex.input,
          output: ex.output,
          category: ex.category,
          intent: ex.intent,
          quality: ex.quality,
          tags: ['imported', 'conversation', ex.category],
          source: 'conversation_analyzer'
        });
      }
    }

    return { exported: approved.length };
  }

  // ============================================
  // GETTERS
  // ============================================

  getConversations() {
    return [...this.conversations];
  }

  getLearnedExamples() {
    return [...this.learnedExamples];
  }

  addLearnedExamples(examples) {
    this.learnedExamples.push(...examples);
  }
}

// Exportar
window.ConversationAnalyzer = ConversationAnalyzer;
window.conversationAnalyzer = new ConversationAnalyzer();
console.log('[ConversationAnalyzer] ✅ Módulo de análise de conversas carregado');
