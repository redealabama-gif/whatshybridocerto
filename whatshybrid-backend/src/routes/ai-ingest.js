/**
 * 🧠 AI Ingest API - Sistema de Aprendizado Contínuo (Pilar 2)
 * 
 * Endpoints para ingestão de dados de conversas do WhatsApp:
 * - POST /ingest - Recebe mensagens em tempo real
 * - POST /memory - Salva/atualiza memória de chat
 * - POST /conversation - Salva conversa completa
 * - GET /memory/:chatId - Recupera memória de chat
 * - GET /context/:chatId - Recupera contexto híbrido para IA
 * - POST /feedback - Registra feedback de resposta
 * - POST /enrich - Processa e enriquece mensagem com IA
 * 
 * @version 1.0.0
 */

const express = require('express');
const logger = require('../utils/logger');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const db = require('../utils/database');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

// ============================================
// PILAR 2: Endpoint de Ingestão de Dados
// ============================================

/**
 * POST /ingest - Recebe mensagens do WhatsApp em tempo real
 * Esta é a porta de entrada para o aprendizado contínuo
 */
router.post('/ingest', authenticate, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const workspaceId = req.user.workspace_id;
  const { 
    chatId, 
    message, 
    sender, 
    timestamp, 
    type = 'text',
    isFromMe = false,
    replyTo = null,
    mediaType = null,
    groupName = null,
    contactName = null
  } = req.body;
  
  if (!chatId || !message) {
    throw new AppError('chatId e message são obrigatórios', 400);
  }
  
  const msgId = uuidv4();
  const normalizedMessage = {
    id: msgId,
    chatId,
    message: typeof message === 'string' ? message : JSON.stringify(message),
    sender: sender || (isFromMe ? 'assistant' : 'user'),
    role: isFromMe ? 'assistant' : 'user',
    timestamp: timestamp || Date.now(),
    type,
    replyTo,
    mediaType,
    groupName,
    contactName
  };
  
  // 1. Salvar na tabela de mensagens
  db.run(`
    INSERT INTO messages (id, conversation_id, workspace_id, content, sender, role, message_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    msgId,
    chatId,
    workspaceId,
    normalizedMessage.message,
    normalizedMessage.sender,
    normalizedMessage.role,
    normalizedMessage.type
  ]);
  
  // 2. Atualizar ou criar conversa no ai_conversations
  const existingConv = db.get(
    'SELECT id, messages, context FROM ai_conversations WHERE workspace_id = ? AND conversation_id = ?',
    [workspaceId, chatId]
  );
  
  if (existingConv) {
    // Append à conversa existente
    let messages = [];
    try {
      messages = JSON.parse(existingConv.messages || '[]');
    } catch (e) {
      messages = [];
    }
    
    // Manter apenas as últimas 100 mensagens para não sobrecarregar
    messages.push(normalizedMessage);
    if (messages.length > 100) {
      messages = messages.slice(-100);
    }
    
    // SECURITY FIX (RISK-003): Adicionar workspace_id ao UPDATE para defense-in-depth
    db.run(
      'UPDATE ai_conversations SET messages = ?, updated_at = datetime(\'now\') WHERE id = ? AND workspace_id = ?',
      [JSON.stringify(messages), existingConv.id, workspaceId]
    );
  } else {
    // Criar nova conversa
    const convId = uuidv4();
    db.run(`
      INSERT INTO ai_conversations (id, workspace_id, conversation_id, messages, context, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      convId,
      workspaceId,
      chatId,
      JSON.stringify([normalizedMessage]),
      JSON.stringify({ contactName, groupName })
    ]);
  }
  
  // 3. Pilar 4: Enriquecimento automático (extração de intenção básica)
  const enrichment = extractBasicIntentAndSentiment(normalizedMessage.message);
  
  // 4. Emitir evento via WebSocket se disponível
  if (req.app.get('io')) {
    req.app.get('io').to(`workspace:${workspaceId}`).emit('ai:message:ingested', {
      chatId,
      messageId: msgId,
      enrichment,
      timestamp: Date.now()
    });
  }
  
  res.json({
    success: true,
    messageId: msgId,
    enrichment,
    message: 'Mensagem ingerida para aprendizado'
  });
}));

/**
 * POST /memory - Salva ou atualiza memória de chat
 * Pilar 3: Camada de memória persistente
 */
router.post('/memory', authenticate, asyncHandler(async (req, res) => {
  const workspaceId = req.user.workspace_id;
  const { 
    chatId, 
    memory,
    source = 'extension' // extension, ai, manual
  } = req.body;
  
  if (!chatId) {
    throw new AppError('chatId é obrigatório', 400);
  }
  
  const normalizedMemory = {
    profile: memory?.profile || '',
    preferences: Array.isArray(memory?.preferences) ? memory.preferences : [],
    context: Array.isArray(memory?.context) ? memory.context : [],
    open_loops: Array.isArray(memory?.open_loops) ? memory.open_loops : [],
    next_actions: Array.isArray(memory?.next_actions) ? memory.next_actions : [],
    tone: memory?.tone || 'neutral',
    sentiment_history: memory?.sentiment_history || [],
    lead_score: memory?.lead_score || null,
    tags: memory?.tags || [],
    lastUpdated: Date.now(),
    source
  };
  
  // Verificar se já existe
  const existing = db.get(
    'SELECT id, context FROM ai_conversations WHERE workspace_id = ? AND conversation_id = ?',
    [workspaceId, chatId]
  );
  
  if (existing) {
    // Merge com contexto existente
    let existingContext = {};
    try {
      existingContext = JSON.parse(existing.context || '{}');
    } catch (e) {
      existingContext = {};
    }
    
    const mergedContext = {
      ...existingContext,
      memory: normalizedMemory
    };

    // SECURITY FIX (RISK-003): Adicionar workspace_id ao UPDATE para defense-in-depth
    db.run(
      'UPDATE ai_conversations SET context = ?, updated_at = datetime(\'now\') WHERE id = ? AND workspace_id = ?',
      [JSON.stringify(mergedContext), existing.id, workspaceId]
    );
  } else {
    // Criar novo registro
    const convId = uuidv4();
    db.run(`
      INSERT INTO ai_conversations (id, workspace_id, conversation_id, messages, context, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      convId,
      workspaceId,
      chatId,
      '[]',
      JSON.stringify({ memory: normalizedMemory })
    ]);
  }
  
  res.json({
    success: true,
    chatId,
    memory: normalizedMemory,
    message: 'Memória salva com sucesso'
  });
}));

/**
 * GET /memory/:chatId - Recupera memória de chat
 * Pilar 5: Recuperação de aprendizado
 */
router.get('/memory/:chatId', authenticate, asyncHandler(async (req, res) => {
  const workspaceId = req.user.workspace_id;
  const { chatId } = req.params;
  
  const conv = db.get(
    'SELECT context FROM ai_conversations WHERE workspace_id = ? AND conversation_id = ?',
    [workspaceId, chatId]
  );
  
  if (!conv) {
    return res.json({ success: true, memory: null, found: false });
  }
  
  let context = {};
  try {
    context = JSON.parse(conv.context || '{}');
  } catch (e) {
    context = {};
  }
  
  res.json({
    success: true,
    found: true,
    memory: context.memory || null,
    chatId
  });
}));

/**
 * GET /context/:chatId - Recupera contexto híbrido completo para IA
 * Pilar 5: Reuso do aprendizado em respostas futuras
 */
router.get('/context/:chatId', authenticate, asyncHandler(async (req, res) => {
  const workspaceId = req.user.workspace_id;
  const { chatId } = req.params;
  const { maxMessages = 30, includeExamples = true, maxExamples = 3 } = req.query;
  
  // 1. Buscar conversa e memória
  const conv = db.get(
    'SELECT messages, context FROM ai_conversations WHERE workspace_id = ? AND conversation_id = ?',
    [workspaceId, chatId]
  );
  
  let messages = [];
  let memory = null;
  
  if (conv) {
    try {
      messages = JSON.parse(conv.messages || '[]').slice(-parseInt(maxMessages));
      const ctx = JSON.parse(conv.context || '{}');
      memory = ctx.memory || null;
    } catch (e) {
      logger.error('[AI Ingest] Erro ao parsear dados:', e);
    }
  }
  
  // 2. Buscar exemplos relevantes (few-shot)
  let examples = [];
  if (includeExamples === 'true' || includeExamples === true) {
    // Extrair palavras-chave das últimas mensagens
    const recentText = messages.slice(-5).map(m => m.message || m.content || '').join(' ');
    const keywords = extractKeywords(recentText);
    
    if (keywords.length > 0) {
      // Buscar exemplos que contenham keywords
      const allExamples = db.all(
        'SELECT id, input, output, context, category, tags, usage_count FROM training_examples WHERE workspace_id = ? ORDER BY usage_count DESC LIMIT 50',
        [workspaceId]
      );
      
      // Score por relevância
      examples = allExamples
        .map(ex => {
          let score = 0;
          const exText = ((ex.input || '') + ' ' + (ex.output || '')).toLowerCase();
          keywords.forEach(kw => {
            if (exText.includes(kw.toLowerCase())) score++;
          });
          return { ...ex, score };
        })
        .filter(ex => ex.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, parseInt(maxExamples));
    }
  }
  
  // 3. Buscar knowledge base relevante
  const recentText = messages.slice(-3).map(m => m.message || m.content || '').join(' ');
  const knowledge = searchKnowledgeBase(workspaceId, recentText, 3);
  
  // 4. Construir contexto híbrido
  const hybridContext = {
    chatId,
    memory,
    messages,
    examples: examples.map(ex => ({
      input: ex.input,
      output: ex.output,
      context: ex.context
    })),
    knowledge: knowledge.map(k => ({
      question: k.question,
      answer: k.answer,
      type: k.type
    })),
    stats: {
      totalMessages: messages.length,
      examplesFound: examples.length,
      knowledgeFound: knowledge.length,
      hasMemory: !!memory
    }
  };
  
  res.json({
    success: true,
    context: hybridContext
  });
}));

/**
 * POST /conversation - Salva conversa completa (batch)
 * Útil para sincronização de histórico
 */
router.post('/conversation', authenticate, asyncHandler(async (req, res) => {
  const workspaceId = req.user.workspace_id;
  const { chatId, messages, metadata = {} } = req.body;
  
  if (!chatId || !Array.isArray(messages)) {
    throw new AppError('chatId e messages (array) são obrigatórios', 400);
  }
  
  // Normalizar mensagens
  const normalizedMessages = messages.map(msg => ({
    id: msg.id || uuidv4(),
    message: msg.message || msg.content || msg.body || '',
    sender: msg.sender || (msg.isFromMe ? 'assistant' : 'user'),
    role: msg.isFromMe ? 'assistant' : 'user',
    timestamp: msg.timestamp || Date.now(),
    type: msg.type || 'text'
  }));
  
  // Salvar ou atualizar
  const existing = db.get(
    'SELECT id FROM ai_conversations WHERE workspace_id = ? AND conversation_id = ?',
    [workspaceId, chatId]
  );
  
  if (existing) {
    // SECURITY FIX (RISK-003): Adicionar workspace_id ao UPDATE para defense-in-depth
    db.run(
      'UPDATE ai_conversations SET messages = ?, context = ?, updated_at = datetime(\'now\') WHERE id = ? AND workspace_id = ?',
      [
        JSON.stringify(normalizedMessages.slice(-100)), // Manter últimas 100
        JSON.stringify(metadata),
        existing.id,
        workspaceId
      ]
    );
  } else {
    const convId = uuidv4();
    db.run(`
      INSERT INTO ai_conversations (id, workspace_id, conversation_id, messages, context, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      convId,
      workspaceId,
      chatId,
      JSON.stringify(normalizedMessages.slice(-100)),
      JSON.stringify(metadata)
    ]);
  }
  
  res.json({
    success: true,
    chatId,
    messagesCount: normalizedMessages.length,
    message: 'Conversa salva com sucesso'
  });
}));

/**
 * POST /feedback - Registra feedback de resposta
 * Pilar 4: Motor de enriquecimento (feedback loop)
 */
router.post('/feedback', authenticate, asyncHandler(async (req, res) => {
  const workspaceId = req.user.workspace_id;
  const userId = req.user.id;
  const {
    chatId,
    messageId,
    userMessage,
    assistantResponse,
    rating, // 1-5 ou 'positive'/'negative'
    correctedResponse = null,
    feedbackType = 'rating' // rating, correction, example
  } = req.body;
  
  if (!userMessage || !assistantResponse) {
    throw new AppError('userMessage e assistantResponse são obrigatórios', 400);
  }
  
  // Normalizar rating
  let normalizedRating = 0;
  if (typeof rating === 'number') {
    normalizedRating = Math.max(1, Math.min(5, rating));
  } else if (rating === 'positive') {
    normalizedRating = 5;
  } else if (rating === 'negative') {
    normalizedRating = 1;
  }
  
  // Se feedback positivo ou correção, criar exemplo de treinamento
  if (normalizedRating >= 4 || correctedResponse) {
    const exampleId = uuidv4();
    const output = correctedResponse || assistantResponse;
    
    db.run(`
      INSERT INTO training_examples (id, workspace_id, user_id, input, output, context, category, tags, usage_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      exampleId,
      workspaceId,
      userId,
      userMessage,
      output,
      chatId || '',
      feedbackType === 'correction' ? 'Correção' : 'Aprovado',
      JSON.stringify(extractKeywords(userMessage)),
      0
    ]);
    
    logger.info('[AI Ingest] Exemplo criado a partir de feedback:', exampleId);
  }
  
  // Registrar feedback em analytics
  db.run(`
    INSERT INTO analytics_events (id, workspace_id, event_type, event_data, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `, [
    uuidv4(),
    workspaceId,
    'ai_feedback',
    JSON.stringify({
      chatId,
      messageId,
      rating: normalizedRating,
      hasCorrectedResponse: !!correctedResponse,
      feedbackType
    })
  ]);

  // FIX v9.3.0 BUG CRÍTICO: feedback nunca alimentava o ValidatedLearningPipeline.
  //
  // Antes: a rota só inseria em training_examples e analytics_events. O método
  // orchestrator.recordFeedback() (que chama learningPipeline.recordInteraction
  // pra graduar patterns com ≥80% positivo) era ÓRFÃO — ninguém chamava.
  // Resultado: aprendizado nunca fechava o ciclo.
  //
  // Agora: se a request trouxer interactionId, propagamos pro orchestrator do
  // tenant correto via OrchestratorRegistry.
  const { interactionId } = req.body;
  if (interactionId) {
    try {
      const orchestratorRegistry = require('../registry/OrchestratorRegistry');
      const orchestrator = orchestratorRegistry.get(workspaceId);
      const fbStr = normalizedRating >= 4 ? 'positive'
                  : normalizedRating <= 2 ? 'negative'
                  : 'neutral';
      // recordFeedback é síncrono (chama learningPipeline.recordInteraction
      // que retorna Promise mas faz .catch internamente)
      orchestrator.recordFeedback(interactionId, fbStr);
    } catch (err) {
      logger.warn('[AI Ingest] feedback → orchestrator falhou (não-crítico):', err.message);
    }
  }
  
  res.json({
    success: true,
    message: 'Feedback registrado com sucesso',
    exampleCreated: normalizedRating >= 4 || !!correctedResponse
  });
}));

/**
 * POST /enrich - Processa e enriquece mensagem com análise
 * Pilar 4: Motor de enriquecimento
 */
router.post('/enrich', authenticate, asyncHandler(async (req, res) => {
  const { message, chatId } = req.body;
  
  if (!message) {
    throw new AppError('message é obrigatório', 400);
  }
  
  // Análise local (sem IA externa)
  const enrichment = {
    intent: detectIntent(message),
    sentiment: analyzeSentiment(message),
    entities: extractEntities(message),
    keywords: extractKeywords(message),
    leadSignals: detectLeadSignals(message),
    urgency: detectUrgency(message),
    language: detectLanguage(message)
  };
  
  res.json({
    success: true,
    enrichment
  });
}));

/**
 * GET /stats - Estatísticas de aprendizado
 */
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const workspaceId = req.user.workspace_id;
  
  const totalConversations = db.get(
    'SELECT COUNT(*) as count FROM ai_conversations WHERE workspace_id = ?',
    [workspaceId]
  )?.count || 0;
  
  const totalExamples = db.get(
    'SELECT COUNT(*) as count FROM training_examples WHERE workspace_id = ?',
    [workspaceId]
  )?.count || 0;
  
  const totalKnowledge = db.get(
    'SELECT COUNT(*) as count FROM knowledge_base WHERE workspace_id = ?',
    [workspaceId]
  )?.count || 0;
  
  const recentFeedback = db.get(
    `SELECT COUNT(*) as count FROM analytics_events 
     WHERE workspace_id = ? AND event_type = 'ai_feedback' 
     AND created_at > datetime('now', '-7 days')`,
    [workspaceId]
  )?.count || 0;
  
  res.json({
    success: true,
    stats: {
      totalConversations,
      totalExamples,
      totalKnowledge,
      recentFeedback,
      lastUpdated: Date.now()
    }
  });
}));

// ============================================
// FUNÇÕES AUXILIARES DE ENRIQUECIMENTO
// ============================================

function extractBasicIntentAndSentiment(text) {
  return {
    intent: detectIntent(text),
    sentiment: analyzeSentiment(text)
  };
}

function detectIntent(text) {
  const lower = text.toLowerCase();
  
  const intents = [
    { id: 'greeting', keywords: ['oi', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'eae'], confidence: 0.8 },
    { id: 'price_inquiry', keywords: ['preço', 'quanto custa', 'valor', 'promoção', 'desconto', 'orçamento'], confidence: 0.85 },
    { id: 'product_inquiry', keywords: ['tem', 'disponível', 'existe', 'possuem', 'vocês têm'], confidence: 0.75 },
    { id: 'support', keywords: ['problema', 'erro', 'não funciona', 'ajuda', 'suporte', 'defeito'], confidence: 0.9 },
    { id: 'complaint', keywords: ['reclamação', 'insatisfeito', 'péssimo', 'horrível', 'decepcionado'], confidence: 0.9 },
    { id: 'purchase_intent', keywords: ['comprar', 'adquirir', 'fechar', 'quero', 'preciso', 'pedido'], confidence: 0.85 },
    { id: 'scheduling', keywords: ['agendar', 'marcar', 'horário', 'disponibilidade', 'reunião', 'call'], confidence: 0.85 },
    { id: 'follow_up', keywords: ['status', 'andamento', 'previsão', 'quando', 'ainda'], confidence: 0.75 },
    { id: 'goodbye', keywords: ['tchau', 'obrigado', 'valeu', 'até mais', 'até logo'], confidence: 0.8 }
  ];
  
  for (const intent of intents) {
    if (intent.keywords.some(kw => lower.includes(kw))) {
      return { id: intent.id, confidence: intent.confidence };
    }
  }
  
  return { id: 'general', confidence: 0.5 };
}

function analyzeSentiment(text) {
  const lower = text.toLowerCase();
  
  const positiveWords = ['obrigado', 'ótimo', 'excelente', 'perfeito', 'maravilhoso', 'adorei', 'gostei', 'parabéns', 'muito bom', 'top', 'show'];
  const negativeWords = ['ruim', 'péssimo', 'horrível', 'decepcionado', 'insatisfeito', 'problema', 'erro', 'demora', 'raiva', 'absurdo', 'vergonha'];
  
  let positiveCount = positiveWords.filter(w => lower.includes(w)).length;
  let negativeCount = negativeWords.filter(w => lower.includes(w)).length;
  
  if (positiveCount > negativeCount) {
    return { label: 'positive', score: 0.5 + (positiveCount * 0.15) };
  } else if (negativeCount > positiveCount) {
    return { label: 'negative', score: 0.5 + (negativeCount * 0.15) };
  }
  
  return { label: 'neutral', score: 0.5 };
}

function extractEntities(text) {
  const entities = [];
  
  // Email
  const emailMatch = text.match(/[\w.-]+@[\w.-]+\.\w+/gi);
  if (emailMatch) {
    entities.push(...emailMatch.map(e => ({ type: 'email', value: e })));
  }
  
  // Telefone
  const phoneMatch = text.match(/\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}/g);
  if (phoneMatch) {
    entities.push(...phoneMatch.map(p => ({ type: 'phone', value: p.replace(/\D/g, '') })));
  }
  
  // CPF/CNPJ
  const cpfMatch = text.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g);
  if (cpfMatch) {
    entities.push(...cpfMatch.map(c => ({ type: 'cpf', value: c })));
  }
  
  // Valores monetários
  const moneyMatch = text.match(/R\$\s*[\d.,]+/gi);
  if (moneyMatch) {
    entities.push(...moneyMatch.map(m => ({ type: 'money', value: m })));
  }
  
  // Datas
  const dateMatch = text.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g);
  if (dateMatch) {
    entities.push(...dateMatch.map(d => ({ type: 'date', value: d })));
  }
  
  return entities;
}

function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  
  // Remove pontuação e converte para lowercase
  const words = text
    .toLowerCase()
    .replace(/[^\wáàâãéèêíïóôõöúçñ\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4);
  
  // Remove stopwords
  const stopwords = ['para', 'como', 'isso', 'esse', 'esta', 'esta', 'muito', 'mais', 'pode', 'você', 'vocês', 'sobre', 'quando', 'qual', 'quais', 'onde'];
  
  return [...new Set(words.filter(w => !stopwords.includes(w)))];
}

function detectLeadSignals(text) {
  const lower = text.toLowerCase();
  const signals = [];
  
  if (lower.includes('comprar') || lower.includes('adquirir') || lower.includes('fechar negócio')) {
    signals.push({ type: 'purchase_intent', strength: 'high' });
  }
  
  if (lower.includes('preço') || lower.includes('valor') || lower.includes('orçamento')) {
    signals.push({ type: 'price_interest', strength: 'medium' });
  }
  
  if (lower.includes('urgente') || lower.includes('rápido') || lower.includes('preciso hoje')) {
    signals.push({ type: 'urgency', strength: 'high' });
  }
  
  if (lower.includes('concorrente') || lower.includes('outra empresa') || lower.includes('comparando')) {
    signals.push({ type: 'comparison_shopping', strength: 'medium' });
  }
  
  return signals;
}

function detectUrgency(text) {
  const lower = text.toLowerCase();
  
  const highUrgency = ['urgente', 'agora', 'imediato', 'hoje', 'o mais rápido', 'emergência'];
  const mediumUrgency = ['rápido', 'logo', 'amanhã', 'essa semana', 'breve'];
  
  if (highUrgency.some(w => lower.includes(w))) {
    return { level: 'high', confidence: 0.85 };
  }
  
  if (mediumUrgency.some(w => lower.includes(w))) {
    return { level: 'medium', confidence: 0.7 };
  }
  
  return { level: 'low', confidence: 0.5 };
}

function detectLanguage(text) {
  // Detecção simples baseada em palavras comuns
  const ptWords = ['você', 'para', 'como', 'isso', 'também', 'muito', 'obrigado'];
  const enWords = ['you', 'for', 'how', 'this', 'also', 'very', 'thanks'];
  const esWords = ['usted', 'para', 'como', 'esto', 'también', 'muy', 'gracias'];
  
  const lower = text.toLowerCase();
  
  const ptCount = ptWords.filter(w => lower.includes(w)).length;
  const enCount = enWords.filter(w => lower.includes(w)).length;
  const esCount = esWords.filter(w => lower.includes(w)).length;
  
  if (ptCount >= enCount && ptCount >= esCount) return 'pt';
  if (enCount >= ptCount && enCount >= esCount) return 'en';
  if (esCount >= ptCount && esCount >= enCount) return 'es';
  
  return 'pt'; // default
}

function searchKnowledgeBase(workspaceId, query, limit = 3) {
  if (!query) return [];
  
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return [];
  
  // Busca simples por keywords
  const allKnowledge = db.all(
    'SELECT id, type, question, answer, content, tags FROM knowledge_base WHERE workspace_id = ? LIMIT 50',
    [workspaceId]
  );
  
  const scored = allKnowledge.map(k => {
    let score = 0;
    const kText = ((k.question || '') + ' ' + (k.answer || '') + ' ' + (k.content || '')).toLowerCase();
    
    keywords.forEach(kw => {
      if (kText.includes(kw.toLowerCase())) score++;
    });
    
    return { ...k, score };
  });
  
  return scored
    .filter(k => k.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}


// ==============================================================================
// SYNC ROUTE (Correção Pilar 3)
// ==============================================================================
router.post('/sync', authenticate, asyncHandler(async (req, res) => {
  const { examples, faqs, products, memories, businessInfo } = req.body;
  const workspaceId = req.user.workspace_id;
  const results = {
    examples: 0,
    faqs: 0,
    products: 0,
    memories: 0,
    businessInfo: 0
  };

  // v9.5.0 BUG #147: Refactor cross-driver. Antes este endpoint usava
  // `db.getDb().prepare(sql)` + named params (`@id`, `@workspaceId`) — feature
  // exclusiva de better-sqlite3, quebrando em Postgres mesmo com adapter SQL.
  // CHANGELOG-v9.4.7 documentou como "v10". Refatorado pra `db.run(sql, [params])`
  // que funciona nos dois drivers e usa o adapter de INSERT OR REPLACE existente.
  const { v4: uuidv4 } = require('../utils/uuid-wrapper');

  // Sync Examples
  if (Array.isArray(examples)) {
    db.transaction(() => {
      const sql = `INSERT OR REPLACE INTO training_examples
        (id, workspace_id, input, output, context, category, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const now = new Date().toISOString();
      examples.forEach(ex => {
        try {
          db.run(sql, [
            ex.id || uuidv4(),
            workspaceId,
            ex.input,
            ex.output,
            ex.context || '',
            ex.category || 'Geral',
            JSON.stringify(ex.tags || []),
            ex.createdAt || now,
            now,
          ]);
          results.examples++;
        } catch (e) {
          logger.error('[Sync] Erro ao salvar exemplo:', e);
        }
      });
    });
  }

  // Sync FAQs
  if (Array.isArray(faqs)) {
    db.transaction(() => {
      const sql = `INSERT OR REPLACE INTO faqs
        (id, workspace_id, question, answer, category, keywords, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      const now = new Date().toISOString();
      faqs.forEach(faq => {
        try {
          db.run(sql, [
            faq.id || uuidv4(),
            workspaceId,
            faq.question,
            faq.answer,
            faq.category || 'general',
            JSON.stringify(faq.keywords || []),
            faq.createdAt || now,
            now,
          ]);
          results.faqs++;
        } catch (e) {
          logger.error('[Sync] Erro ao salvar FAQ:', e);
        }
      });
    });
  }

  // Sync Products
  if (Array.isArray(products)) {
    db.transaction(() => {
      const sql = `INSERT OR REPLACE INTO products
        (id, workspace_id, name, description, price, stock, category, tags, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const now = new Date().toISOString();
      products.forEach(prod => {
        try {
          db.run(sql, [
            prod.id || uuidv4(),
            workspaceId,
            prod.name,
            prod.description || '',
            prod.price || 0,
            prod.stock || 0,
            prod.category || 'general',
            JSON.stringify(prod.tags || []),
            prod.createdAt || now,
            now,
          ]);
          results.products++;
        } catch (e) {
          logger.error('[Sync] Erro ao salvar produto:', e);
        }
      });
    });
  }

  // Sync Business Info
  if (businessInfo && typeof businessInfo === 'object') {
    try {
      // CREATE TABLE IF NOT EXISTS via exec — funciona nos dois drivers.
      // Se a tabela já existir (caso normal pós-migrations) é no-op.
      db.exec(`CREATE TABLE IF NOT EXISTS business_info (
        workspace_id TEXT PRIMARY KEY,
        data TEXT,
        updated_at TEXT
      )`);

      db.run(
        `INSERT OR REPLACE INTO business_info (workspace_id, data, updated_at) VALUES (?, ?, ?)`,
        [workspaceId, JSON.stringify(businessInfo), new Date().toISOString()]
      );

      results.businessInfo = 1;
    } catch (e) {
      logger.error('[Sync] Erro ao salvar businessInfo:', e);
    }
  }

  res.json({
    success: true,
    message: 'Sincronização concluída',
    stats: results
  });
}));

module.exports = router;
