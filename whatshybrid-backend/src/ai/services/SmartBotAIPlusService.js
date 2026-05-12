/**
 * SmartBot AI Plus Service - Backend (13 sistemas)
 * @version 1.0.0
 */

const EventEmitter = require('events');
const logger = require('../../utils/logger');

// 1. KNOWLEDGE BASE (RAG)
class KnowledgeBase extends EventEmitter {
  constructor(options = {}) {
    super();
    this.documents = new Map();
    this.embeddings = new Map();
    this.index = [];
    this.options = { maxDocuments: options.maxDocuments || 1000, chunkSize: options.chunkSize || 500, chunkOverlap: options.chunkOverlap || 50, similarityThreshold: options.similarityThreshold || 0.7, maxResults: options.maxResults || 5, ...options };
    this.stats = { totalDocuments: 0, totalChunks: 0, searches: 0, hits: 0 };
  }
  async addDocument(docId, content, metadata = {}) {
    const chunks = this._chunkText(content);
    const doc = { id: docId, content, chunks, metadata: { ...metadata, addedAt: Date.now(), chunkCount: chunks.length } };
    this.documents.set(docId, doc);
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = `${docId}_chunk_${i}`;
      const embedding = this._generateEmbedding(chunks[i]);
      this.embeddings.set(chunkId, { docId, chunkIndex: i, text: chunks[i], embedding, metadata });
      this.index.push(chunkId);
    }
    this.stats.totalDocuments++; this.stats.totalChunks += chunks.length;
    this.emit('documentAdded', { docId, chunks: chunks.length });
    return doc;
  }
  async removeDocument(docId) {
    const doc = this.documents.get(docId);
    if (!doc) return false;
    for (let i = 0; i < doc.chunks.length; i++) { const chunkId = `${docId}_chunk_${i}`; this.embeddings.delete(chunkId); this.index = this.index.filter(id => id !== chunkId); }
    this.documents.delete(docId); this.stats.totalDocuments--; this.stats.totalChunks -= doc.chunks.length;
    return true;
  }
  search(query, options = {}) {
    const maxResults = options.maxResults || this.options.maxResults;
    const threshold = options.threshold || this.options.similarityThreshold;
    this.stats.searches++;
    const queryEmbedding = this._generateEmbedding(query);
    const results = [];
    for (const chunkId of this.index) {
      const chunk = this.embeddings.get(chunkId);
      if (!chunk) continue;
      const similarity = this._cosineSimilarity(queryEmbedding, chunk.embedding);
      if (similarity >= threshold) results.push({ docId: chunk.docId, chunkIndex: chunk.chunkIndex, text: chunk.text, similarity, metadata: chunk.metadata });
    }
    results.sort((a, b) => b.similarity - a.similarity);
    const grouped = this._groupByDocument(results.slice(0, maxResults * 2));
    const finalResults = grouped.slice(0, maxResults);
    if (finalResults.length > 0) this.stats.hits++;
    return { query, results: finalResults, totalFound: results.length, searchTime: Date.now() };
  }
  getContextForQuery(query, maxTokens = 2000) {
    const searchResults = this.search(query, { maxResults: 10 });
    let context = '', tokenCount = 0;
    const tokensPerChar = 0.25;
    for (const result of searchResults.results) {
      const chunkTokens = Math.ceil(result.text.length * tokensPerChar);
      if (tokenCount + chunkTokens > maxTokens) break;
      context += `\n---\nFonte: ${result.metadata.title || result.docId}\n${result.text}\n`;
      tokenCount += chunkTokens;
    }
    return { context: context.trim(), sources: searchResults.results.map(r => ({ docId: r.docId, title: r.metadata.title, similarity: r.similarity })), tokenEstimate: tokenCount };
  }
  _chunkText(text) {
    const { chunkSize, chunkOverlap } = this.options;
    const chunks = [];
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    let currentChunk = '';
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      if (currentChunk.length + trimmed.length > chunkSize) {
        if (currentChunk) chunks.push(currentChunk.trim());
        const words = currentChunk.split(' ');
        const overlapWords = words.slice(-Math.floor(chunkOverlap / 5));
        currentChunk = overlapWords.join(' ') + ' ' + trimmed;
      } else { currentChunk += (currentChunk ? '. ' : '') + trimmed; }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
  }
  _generateEmbedding(text) {
    const words = text.toLowerCase().replace(/[^\w\sáéíóúàèìòùâêîôûãõç]/g, '').split(/\s+/).filter(w => w.length > 2);
    const wordFreq = {};
    for (const word of words) wordFreq[word] = (wordFreq[word] || 0) + 1;
    const norm = Math.sqrt(Object.values(wordFreq).reduce((a, b) => a + b * b, 0)) || 1;
    for (const word in wordFreq) wordFreq[word] /= norm;
    return wordFreq;
  }
  _cosineSimilarity(embedding1, embedding2) {
    let dotProduct = 0, norm1 = 0, norm2 = 0;
    const allWords = new Set([...Object.keys(embedding1), ...Object.keys(embedding2)]);
    for (const word of allWords) { const v1 = embedding1[word] || 0, v2 = embedding2[word] || 0; dotProduct += v1 * v2; norm1 += v1 * v1; norm2 += v2 * v2; }
    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
    return denominator ? dotProduct / denominator : 0;
  }
  _groupByDocument(results) {
    const grouped = new Map();
    for (const result of results) {
      if (!grouped.has(result.docId)) grouped.set(result.docId, { docId: result.docId, metadata: result.metadata, chunks: [], maxSimilarity: 0 });
      const group = grouped.get(result.docId);
      group.chunks.push({ text: result.text, similarity: result.similarity, chunkIndex: result.chunkIndex });
      group.maxSimilarity = Math.max(group.maxSimilarity, result.similarity);
    }
    return Array.from(grouped.values()).sort((a, b) => b.maxSimilarity - a.maxSimilarity);
  }
  listDocuments() { return Array.from(this.documents.values()).map(d => ({ id: d.id, title: d.metadata.title, chunkCount: d.chunks.length, addedAt: d.metadata.addedAt })); }
  getStats() { return { ...this.stats, hitRate: this.stats.searches ? (this.stats.hits / this.stats.searches * 100).toFixed(1) + '%' : '0%' }; }
}

// 2. CONVERSATION SUMMARIZER
class ConversationSummarizer {
  constructor(options = {}) {
    this.options = { maxMessagesBeforeSummary: options.maxMessagesBeforeSummary || 20, summaryMaxLength: options.summaryMaxLength || 500, preserveLastMessages: options.preserveLastMessages || 5, ...options };
    this.summaries = new Map();
    this.stats = { totalSummaries: 0, messagesProcessed: 0, tokensSaved: 0 };
  }
  needsSummary(messages) { return messages.length > this.options.maxMessagesBeforeSummary; }
  summarize(messages, existingSummary = null) {
    if (messages.length < 5) return { summary: null, messagesToKeep: messages };
    const preserveCount = this.options.preserveLastMessages;
    const toSummarize = messages.slice(0, -preserveCount);
    const toKeep = messages.slice(-preserveCount);
    const keyInfo = this._extractKeyInfo(toSummarize);
    const summary = this._generateSummary(keyInfo, existingSummary);
    this.stats.totalSummaries++; this.stats.messagesProcessed += toSummarize.length;
    this.stats.tokensSaved += this._estimateTokens(toSummarize) - this._estimateTokens([{ text: summary.text }]);
    return { summary, messagesToKeep: toKeep, originalCount: messages.length, summarizedCount: toSummarize.length };
  }
  _extractKeyInfo(messages) {
    const info = { topics: new Set(), entities: { names: new Set(), dates: new Set(), values: new Set() }, sentiment: { positive: 0, negative: 0, neutral: 0 }, questions: [] };
    for (const msg of messages) {
      const text = msg.text || msg.body || '';
      const isFromMe = msg.fromMe || msg.isFromMe;
      text.toLowerCase().split(/\s+/).filter(w => w.length > 4).forEach(w => info.topics.add(w));
      const nameMatch = text.match(/(?:sou|me chamo|meu nome é)\s+(\w+)/i);
      if (nameMatch) info.entities.names.add(nameMatch[1]);
      const dateMatch = text.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g);
      if (dateMatch) dateMatch.forEach(d => info.entities.dates.add(d));
      const valueMatch = text.match(/R\$\s*[\d.,]+/g);
      if (valueMatch) valueMatch.forEach(v => info.entities.values.add(v));
      if (text.includes('?')) info.questions.push({ text: text.substring(0, 100), from: isFromMe ? 'agent' : 'customer' });
      const positiveWords = ['obrigado', 'ótimo', 'excelente', 'perfeito', 'bom'];
      const negativeWords = ['problema', 'ruim', 'péssimo', 'não', 'cancelar'];
      const hasPositive = positiveWords.some(w => text.toLowerCase().includes(w));
      const hasNegative = negativeWords.some(w => text.toLowerCase().includes(w));
      if (hasPositive && !hasNegative) info.sentiment.positive++;
      else if (hasNegative && !hasPositive) info.sentiment.negative++;
      else info.sentiment.neutral++;
    }
    return info;
  }
  _generateSummary(info, existingSummary) {
    const parts = [];
    const sentimentText = info.sentiment.positive > info.sentiment.negative ? 'positivo' : info.sentiment.negative > info.sentiment.positive ? 'negativo' : 'neutro';
    parts.push(`Tom: ${sentimentText}`);
    if (info.entities.names.size > 0) parts.push(`Cliente: ${Array.from(info.entities.names).join(', ')}`);
    if (info.entities.values.size > 0) parts.push(`Valores: ${Array.from(info.entities.values).join(', ')}`);
    const customerQuestions = info.questions.filter(q => q.from === 'customer');
    if (customerQuestions.length > 0) parts.push(`Perguntas: ${customerQuestions.length}`);
    let finalText = parts.join('. ');
    if (existingSummary) finalText = existingSummary.text + ' | ' + finalText;
    return { text: finalText.substring(0, this.options.summaryMaxLength), entities: { names: Array.from(info.entities.names), values: Array.from(info.entities.values), dates: Array.from(info.entities.dates) }, sentiment: sentimentText, generatedAt: Date.now() };
  }
  _estimateTokens(messages) { return messages.reduce((sum, m) => sum + Math.ceil((m.text || m.body || '').length / 4), 0); }
  prepareContext(chatId, messages, maxTokens = 3000) {
    const cached = this.summaries.get(chatId);
    if (!this.needsSummary(messages)) return { context: messages, summary: null, tokenEstimate: this._estimateTokens(messages) };
    const { summary, messagesToKeep } = this.summarize(messages, cached?.summary);
    this.summaries.set(chatId, { summary, updatedAt: Date.now() });
    const contextMessages = [{ role: 'system', content: `[RESUMO]\n${summary.text}` }, ...messagesToKeep];
    return { context: contextMessages, summary, tokenEstimate: this._estimateTokens(contextMessages), savings: this._estimateTokens(messages) - this._estimateTokens(contextMessages) };
  }
  getStats() { return { ...this.stats, cachedSummaries: this.summaries.size }; }
  clearCache(chatId) { if (chatId) this.summaries.delete(chatId); else this.summaries.clear(); }
}

// 3. LEAD SCORING AI
class LeadScoringAI extends EventEmitter {
  constructor(options = {}) {
    super();
    this.scores = new Map();
    this.options = { decayFactor: options.decayFactor || 0.95, maxScore: options.maxScore || 100, ...options };
    this.weights = { engagement: { messageCount: 2, responseSpeed: 3 }, intent: { priceInquiry: 20, urgentNeed: 25, readyToBuy: 30 }, profile: { hasEmail: 5, hasCompany: 10, budgetMentioned: 20 }, negative: { unsubscribed: -50, noResponse: -5 } };
    this.stats = { totalScored: 0, hotLeads: 0, warmLeads: 0, coldLeads: 0 };
  }
  scoreContact(chatId, data) {
    let score = this.scores.get(chatId)?.score || 0;
    const factors = [];
    if (data.messageCount) { const s = Math.min(data.messageCount * this.weights.engagement.messageCount, 20); score += s; factors.push({ factor: 'messageCount', value: s }); }
    if (data.avgResponseTime) { const s = data.avgResponseTime < 60000 ? 9 : data.avgResponseTime < 300000 ? 6 : 3; score += s; factors.push({ factor: 'responseSpeed', value: s }); }
    if (data.askedPrice) { score += this.weights.intent.priceInquiry; factors.push({ factor: 'priceInquiry', value: this.weights.intent.priceInquiry }); }
    if (data.mentionedUrgency) { score += this.weights.intent.urgentNeed; factors.push({ factor: 'urgentNeed', value: this.weights.intent.urgentNeed }); }
    if (data.readyToBuy) { score += this.weights.intent.readyToBuy; factors.push({ factor: 'readyToBuy', value: this.weights.intent.readyToBuy }); }
    if (data.email) { score += this.weights.profile.hasEmail; factors.push({ factor: 'hasEmail', value: this.weights.profile.hasEmail }); }
    if (data.company) { score += this.weights.profile.hasCompany; factors.push({ factor: 'hasCompany', value: this.weights.profile.hasCompany }); }
    if (data.budgetMentioned) { score += this.weights.profile.budgetMentioned; factors.push({ factor: 'budgetMentioned', value: this.weights.profile.budgetMentioned }); }
    if (data.unsubscribed) { score += this.weights.negative.unsubscribed; factors.push({ factor: 'unsubscribed', value: this.weights.negative.unsubscribed }); }
    if (data.noResponseDays > 3) { const p = this.weights.negative.noResponse * Math.min(data.noResponseDays, 10); score += p; factors.push({ factor: 'noResponse', value: p }); }
    score = Math.max(0, Math.min(score, this.options.maxScore));
    const classification = score >= 70 ? 'hot' : score >= 40 ? 'warm' : 'cold';
    const result = { chatId, score: Math.round(score), classification, factors, updatedAt: Date.now() };
    this.scores.set(chatId, result);
    this._updateStats();
    this.emit('scoreUpdated', result);
    return result;
  }
  analyzeMessage(text) {
    const signals = { askedPrice: false, mentionedUrgency: false, readyToBuy: false, productInterest: false, budgetMentioned: false };
    const lowerText = text.toLowerCase();
    if (/quanto custa|qual o pre[çc]o|valor|or[çc]amento/i.test(lowerText)) signals.askedPrice = true;
    if (/urgente|preciso hoje|o mais r[áa]pido|imediato/i.test(lowerText)) signals.mentionedUrgency = true;
    if (/quero comprar|vou fechar|pode enviar|quero contratar/i.test(lowerText)) signals.readyToBuy = true;
    if (/me interesso|gostaria de saber|quero conhecer/i.test(lowerText)) signals.productInterest = true;
    if (/meu or[çc]amento|tenho para gastar|posso pagar/i.test(lowerText)) signals.budgetMentioned = true;
    return signals;
  }
  applyDecay() {
    for (const [chatId, data] of this.scores) {
      const days = (Date.now() - data.updatedAt) / (1000 * 60 * 60 * 24);
      if (days > 1) { data.score = Math.round(data.score * Math.pow(this.options.decayFactor, days)); data.classification = data.score >= 70 ? 'hot' : data.score >= 40 ? 'warm' : 'cold'; }
    }
    this._updateStats();
  }
  getTopLeads(limit = 10, classification = null) {
    let leads = Array.from(this.scores.values());
    if (classification) leads = leads.filter(l => l.classification === classification);
    return leads.sort((a, b) => b.score - a.score).slice(0, limit);
  }
  getScore(chatId) { return this.scores.get(chatId); }
  _updateStats() {
    this.stats.totalScored = this.scores.size;
    this.stats.hotLeads = Array.from(this.scores.values()).filter(l => l.classification === 'hot').length;
    this.stats.warmLeads = Array.from(this.scores.values()).filter(l => l.classification === 'warm').length;
    this.stats.coldLeads = Array.from(this.scores.values()).filter(l => l.classification === 'cold').length;
  }
  getStats() { return { ...this.stats }; }
}

// 4. AUTO TAGGER
class AutoTagger {
  constructor(options = {}) {
    this.tags = new Map();
    this.tagDefinitions = new Map();
    this.options = { maxTagsPerChat: options.maxTagsPerChat || 10, minConfidence: options.minConfidence || 0.6, ...options };
    this._initDefaultTags();
    this.stats = { totalTagged: 0, tagDistribution: {} };
  }
  _initDefaultTags() {
    const defaults = [
      { id: 'support', name: 'Suporte', keywords: ['ajuda', 'problema', 'erro', 'não funciona'], color: '#e74c3c' },
      { id: 'sales', name: 'Vendas', keywords: ['comprar', 'preço', 'valor', 'orçamento'], color: '#27ae60' },
      { id: 'billing', name: 'Financeiro', keywords: ['pagamento', 'boleto', 'nota fiscal', 'fatura'], color: '#f39c12' },
      { id: 'feedback', name: 'Feedback', keywords: ['sugestão', 'opinião', 'melhorar'], color: '#9b59b6' },
      { id: 'urgent', name: 'Urgente', keywords: ['urgente', 'emergência', 'agora', 'imediato'], color: '#c0392b' },
      { id: 'new_customer', name: 'Novo Cliente', keywords: ['primeiro contato', 'conhecer', 'gostaria de saber'], color: '#3498db' },
      { id: 'retention', name: 'Retenção', keywords: ['cancelar', 'desistir', 'não quero mais'], color: '#e67e22' },
      { id: 'technical', name: 'Técnico', keywords: ['configurar', 'instalar', 'integrar', 'API'], color: '#1abc9c' },
      { id: 'scheduling', name: 'Agendamento', keywords: ['agendar', 'marcar', 'horário'], color: '#34495e' },
      { id: 'information', name: 'Informação', keywords: ['dúvida', 'como funciona', 'o que é'], color: '#7f8c8d' }
    ];
    for (const tag of defaults) this.tagDefinitions.set(tag.id, tag);
  }
  addTagDefinition(id, name, keywords, color = '#95a5a6') { this.tagDefinitions.set(id, { id, name, keywords, color }); }
  analyzeAndTag(chatId, messages) {
    const text = messages.map(m => m.text || m.body || '').join(' ').toLowerCase();
    const detectedTags = [];
    for (const [tagId, tagDef] of this.tagDefinitions) {
      const score = this._calculateTagScore(text, tagDef.keywords);
      if (score >= this.options.minConfidence) detectedTags.push({ id: tagId, name: tagDef.name, color: tagDef.color, confidence: score, detectedAt: Date.now() });
    }
    detectedTags.sort((a, b) => b.confidence - a.confidence);
    const finalTags = detectedTags.slice(0, this.options.maxTagsPerChat);
    const existing = this.tags.get(chatId) || [];
    const merged = this._mergeTags(existing, finalTags);
    this.tags.set(chatId, merged);
    this._updateStats();
    return { chatId, tags: merged, newTags: finalTags.filter(t => !existing.find(e => e.id === t.id)) };
  }
  _calculateTagScore(text, keywords) {
    let matches = 0, totalWeight = 0;
    for (const keyword of keywords) { const weight = keyword.length > 5 ? 2 : 1; totalWeight += weight; if (text.includes(keyword.toLowerCase())) matches += weight; }
    return totalWeight > 0 ? matches / totalWeight : 0;
  }
  _mergeTags(existing, newTags) {
    const merged = new Map();
    for (const tag of existing) merged.set(tag.id, tag);
    for (const tag of newTags) if (!merged.has(tag.id) || tag.confidence > merged.get(tag.id).confidence) merged.set(tag.id, tag);
    return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence).slice(0, this.options.maxTagsPerChat);
  }
  addTag(chatId, tagId) {
    const tagDef = this.tagDefinitions.get(tagId);
    if (!tagDef) return null;
    const existing = this.tags.get(chatId) || [];
    if (existing.find(t => t.id === tagId)) return existing;
    existing.push({ id: tagId, name: tagDef.name, color: tagDef.color, confidence: 1.0, manual: true, detectedAt: Date.now() });
    this.tags.set(chatId, existing);
    return existing;
  }
  removeTag(chatId, tagId) { const existing = this.tags.get(chatId) || []; const filtered = existing.filter(t => t.id !== tagId); this.tags.set(chatId, filtered); return filtered; }
  getChatsByTag(tagId) { const results = []; for (const [chatId, tags] of this.tags) if (tags.find(t => t.id === tagId)) results.push({ chatId, tags }); return results; }
  getTags(chatId) { return this.tags.get(chatId) || []; }
  getAllTagDefinitions() { return Array.from(this.tagDefinitions.values()); }
  _updateStats() { this.stats.totalTagged = this.tags.size; this.stats.tagDistribution = {}; for (const tags of this.tags.values()) for (const tag of tags) this.stats.tagDistribution[tag.id] = (this.stats.tagDistribution[tag.id] || 0) + 1; }
  getStats() { return { ...this.stats }; }
}

// 5. RESPONSE QUALITY SCORER
class ResponseQualityScorer {
  constructor(options = {}) {
    this.scores = [];
    this.options = { maxHistory: options.maxHistory || 1000, ...options };
    this.criteria = { relevance: { weight: 0.25 }, completeness: { weight: 0.20 }, clarity: { weight: 0.20 }, tone: { weight: 0.15 }, actionability: { weight: 0.10 }, length: { weight: 0.10 } };
    this.stats = { totalScored: 0, avgScore: 0, distribution: { excellent: 0, good: 0, fair: 0, poor: 0 } };
  }
  scoreResponse(input, response, context = {}) {
    const scores = { relevance: this._scoreRelevance(input, response), completeness: this._scoreCompleteness(input, response), clarity: this._scoreClarity(response), tone: this._scoreTone(response, context), actionability: this._scoreActionability(response), length: this._scoreLength(response, input) };
    let totalScore = 0;
    for (const [criterion, data] of Object.entries(this.criteria)) totalScore += (scores[criterion] || 0) * data.weight;
    const result = { input: input.substring(0, 100), response: response.substring(0, 100), scores, totalScore: Math.round(totalScore * 100) / 100, classification: this._classifyScore(totalScore), timestamp: Date.now(), suggestions: this._generateSuggestions(scores) };
    this.scores.push(result);
    if (this.scores.length > this.options.maxHistory) this.scores.shift();
    this._updateStats();
    return result;
  }
  _scoreRelevance(input, response) { const inputWords = new Set(input.toLowerCase().split(/\s+/).filter(w => w.length > 3)); const responseWords = new Set(response.toLowerCase().split(/\s+/).filter(w => w.length > 3)); let matches = 0; for (const word of inputWords) if (responseWords.has(word)) matches++; return inputWords.size > 0 ? Math.min(matches / inputWords.size * 1.5, 1) : 0.5; }
  _scoreCompleteness(input, response) { const isQuestion = input.includes('?'); const hasAnswer = response.length > 50; if (isQuestion) { const indicators = ['sim', 'não', 'é', 'são', 'pode']; return indicators.some(i => response.toLowerCase().includes(i)) && hasAnswer ? 0.9 : hasAnswer ? 0.7 : 0.4; } return hasAnswer ? 0.8 : 0.5; }
  _scoreClarity(response) { const sentences = response.split(/[.!?]+/).filter(s => s.trim()); const avgLen = sentences.reduce((s, sent) => s + sent.split(/\s+/).length, 0) / (sentences.length || 1); if (avgLen > 30) return 0.5; if (avgLen < 5) return 0.6; if (avgLen >= 10 && avgLen <= 20) return 1.0; return 0.8; }
  _scoreTone(response, context) { const formalIndicators = ['prezado', 'atenciosamente']; const casualIndicators = ['oi', 'olá', 'blz']; const isFormal = formalIndicators.some(i => response.toLowerCase().includes(i)); const isCasual = casualIndicators.some(i => response.toLowerCase().includes(i)); if (context.preferFormal && isFormal) return 1.0; if (context.preferCasual && isCasual) return 1.0; return isFormal ? 0.9 : isCasual ? 0.7 : 0.8; }
  _scoreActionability(response) { const indicators = ['clique', 'acesse', 'entre em contato', 'envie', 'aguarde']; return indicators.some(i => response.toLowerCase().includes(i)) ? 1.0 : 0.6; }
  _scoreLength(response, input) { const ratio = response.length / (input.length || 1); if (ratio < 0.5) return 0.4; if (ratio > 10) return 0.5; if (ratio >= 1 && ratio <= 5) return 1.0; return 0.7; }
  _classifyScore(score) { if (score >= 0.85) return 'excellent'; if (score >= 0.70) return 'good'; if (score >= 0.50) return 'fair'; return 'poor'; }
  _generateSuggestions(scores) { const suggestions = []; if (scores.relevance < 0.7) suggestions.push('Aumentar relevância'); if (scores.completeness < 0.7) suggestions.push('Resposta incompleta'); if (scores.clarity < 0.7) suggestions.push('Melhorar clareza'); if (scores.actionability < 0.7) suggestions.push('Incluir ações claras'); return suggestions; }
  _updateStats() { this.stats.totalScored = this.scores.length; if (this.scores.length > 0) { this.stats.avgScore = Math.round(this.scores.reduce((s, x) => s + x.totalScore, 0) / this.scores.length * 100) / 100; this.stats.distribution = { excellent: 0, good: 0, fair: 0, poor: 0 }; for (const score of this.scores) this.stats.distribution[score.classification]++; } }
  getStats() { return { ...this.stats }; }
  getRecentScores(limit = 20) { return this.scores.slice(-limit).reverse(); }
}

// 6. PROACTIVE ENGAGEMENT
class ProactiveEngagement {
  constructor(options = {}) {
    this.options = { inactivityThreshold: options.inactivityThreshold || 24 * 60 * 60 * 1000, followUpDelay: options.followUpDelay || 2 * 60 * 60 * 1000, maxSuggestionsPerChat: options.maxSuggestionsPerChat || 3, ...options };
    this.suggestions = new Map();
    this.triggers = this._initDefaultTriggers();
    this.stats = { totalSuggestions: 0, accepted: 0, dismissed: 0 };
  }
  _initDefaultTriggers() {
    return [
      { id: 'follow_up_no_response', name: 'Follow-up sem resposta', condition: (chat) => chat.lastMessageFromCustomer && Date.now() - chat.lastMessageTime > this.options.followUpDelay && !chat.lastMessageFromMe, template: 'Olá! Posso ajudar com mais alguma coisa?', priority: 'high' },
      { id: 'price_follow_up', name: 'Follow-up preço', condition: (chat) => chat.askedPrice && !chat.receivedProposal, template: 'Vi que você se interessou. Posso enviar uma proposta?', priority: 'high' },
      { id: 'cart_abandonment', name: 'Carrinho abandonado', condition: (chat) => chat.addedToCart && !chat.completed, template: 'Posso ajudar a finalizar sua compra?', priority: 'medium' },
      { id: 'reactivation', name: 'Reativação', condition: (chat) => Date.now() - chat.lastInteraction > 30 * 24 * 60 * 60 * 1000, template: 'Faz tempo! Temos novidades.', priority: 'low' },
      { id: 'feedback_request', name: 'Feedback', condition: (chat) => chat.purchaseCompleted && Date.now() - chat.purchaseDate > 7 * 24 * 60 * 60 * 1000, template: 'Como foi sua experiência?', priority: 'low' }
    ];
  }
  analyzeChat(chatId, chatData) {
    const suggestions = [];
    for (const trigger of this.triggers) { try { if (trigger.condition(chatData)) suggestions.push({ triggerId: trigger.id, name: trigger.name, message: this._fillTemplate(trigger.template, chatData), priority: trigger.priority, generatedAt: Date.now() }); } catch (e) { } }
    suggestions.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.priority] - ({ high: 0, medium: 1, low: 2 })[b.priority]);
    const finalSuggestions = suggestions.slice(0, this.options.maxSuggestionsPerChat);
    if (finalSuggestions.length > 0) { this.suggestions.set(chatId, finalSuggestions); this.stats.totalSuggestions += finalSuggestions.length; }
    return { chatId, suggestions: finalSuggestions, hasUrgent: finalSuggestions.some(s => s.priority === 'high') };
  }
  _fillTemplate(template, data) { return template.replace(/\{(\w+)\}/g, (match, key) => data[key] || match); }
  addTrigger(id, name, condition, template, priority = 'medium') { this.triggers.push({ id, name, condition, template, priority }); }
  acceptSuggestion(chatId, triggerId) { const s = this.suggestions.get(chatId) || []; const i = s.findIndex(x => x.triggerId === triggerId); if (i >= 0) { s.splice(i, 1); this.suggestions.set(chatId, s); this.stats.accepted++; } }
  dismissSuggestion(chatId, triggerId) { const s = this.suggestions.get(chatId) || []; const i = s.findIndex(x => x.triggerId === triggerId); if (i >= 0) { s.splice(i, 1); this.suggestions.set(chatId, s); this.stats.dismissed++; } }
  getSuggestions(chatId) { return this.suggestions.get(chatId) || []; }
  getAllPendingSuggestions() { const all = []; for (const [chatId, s] of this.suggestions) for (const sg of s) all.push({ chatId, ...sg }); return all.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.priority] - ({ high: 0, medium: 1, low: 2 })[b.priority]); }
  getStats() { return { ...this.stats, acceptanceRate: this.stats.accepted + this.stats.dismissed > 0 ? ((this.stats.accepted / (this.stats.accepted + this.stats.dismissed)) * 100).toFixed(1) + '%' : '0%', pendingCount: Array.from(this.suggestions.values()).reduce((s, x) => s + x.length, 0) }; }
}

// 7. SMART SCHEDULER
class SmartScheduler {
  constructor(options = {}) {
    this.responseData = new Map();
    this.options = { minDataPoints: options.minDataPoints || 5, defaultBestHours: options.defaultBestHours || [9, 10, 11, 14, 15, 16], ...options };
    this.globalStats = { hourDistribution: new Array(24).fill(0), dayDistribution: new Array(7).fill(0), totalResponses: 0 };
  }
  recordResponse(chatId, timestamp = Date.now()) {
    const date = new Date(timestamp);
    const hour = date.getHours(), day = date.getDay();
    if (!this.responseData.has(chatId)) this.responseData.set(chatId, { hours: new Array(24).fill(0), days: new Array(7).fill(0), total: 0 });
    const data = this.responseData.get(chatId);
    data.hours[hour]++; data.days[day]++; data.total++;
    this.globalStats.hourDistribution[hour]++; this.globalStats.dayDistribution[day]++; this.globalStats.totalResponses++;
  }
  getBestTimes(chatId = null) {
    const data = chatId ? this.responseData.get(chatId) : null;
    if (data && data.total >= this.options.minDataPoints) return this._analyzeBestTimes(data);
    if (this.globalStats.totalResponses >= this.options.minDataPoints * 10) return this._analyzeBestTimes({ hours: this.globalStats.hourDistribution, days: this.globalStats.dayDistribution, total: this.globalStats.totalResponses });
    return { bestHours: this.options.defaultBestHours, bestDays: [1, 2, 3, 4, 5], confidence: 'low', recommendation: 'Horários padrão.' };
  }
  _analyzeBestTimes(data) {
    const hourScores = data.hours.map((count, hour) => ({ hour, count })).sort((a, b) => b.count - a.count);
    const bestHours = hourScores.slice(0, 6).map(h => h.hour).sort((a, b) => a - b);
    const dayScores = data.days.map((count, day) => ({ day, count })).sort((a, b) => b.count - a.count);
    const bestDays = dayScores.slice(0, 3).map(d => d.day).sort((a, b) => a - b);
    const maxHour = Math.max(...data.hours), avgHour = data.hours.reduce((a, b) => a + b, 0) / 24;
    const confidence = maxHour > avgHour * 2 ? 'high' : maxHour > avgHour * 1.5 ? 'medium' : 'low';
    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    return { bestHours, bestDays, confidence, recommendation: `Melhores: ${bestHours.join('h, ')}h em ${bestDays.map(d => dayNames[d]).join(', ')}`, dataPoints: data.total };
  }
  getNextBestTime(chatId = null) {
    const { bestHours, bestDays } = this.getBestTimes(chatId);
    const now = new Date();
    for (const hour of bestHours) if (hour > now.getHours() && bestDays.includes(now.getDay())) { const next = new Date(now); next.setHours(hour, 0, 0, 0); return { datetime: next, isToday: true }; }
    for (let i = 1; i <= 7; i++) { const nextDay = (now.getDay() + i) % 7; if (bestDays.includes(nextDay)) { const next = new Date(now); next.setDate(next.getDate() + i); next.setHours(bestHours[0], 0, 0, 0); return { datetime: next, isToday: false }; } }
    const next = new Date(now); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0); return { datetime: next, isToday: false };
  }
  getStats() { return { totalChatsTracked: this.responseData.size, totalResponses: this.globalStats.totalResponses, peakHour: this.globalStats.hourDistribution.indexOf(Math.max(...this.globalStats.hourDistribution)), peakDay: this.globalStats.dayDistribution.indexOf(Math.max(...this.globalStats.dayDistribution)) }; }
}

// 8. AB TESTING ENGINE
class ABTestingEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.tests = new Map();
    this.assignments = new Map();
    this.options = { minSampleSize: options.minSampleSize || 50, confidenceLevel: options.confidenceLevel || 0.95, ...options };
    this.stats = { activeTests: 0, completedTests: 0, totalAssignments: 0 };
  }
  createTest(testId, config) {
    const test = { id: testId, name: config.name || testId, description: config.description || '', variants: config.variants || [{ id: 'control', name: 'Controle', content: config.controlContent }, { id: 'treatment', name: 'Tratamento', content: config.treatmentContent }], metric: config.metric || 'response_rate', targetSampleSize: config.targetSampleSize || this.options.minSampleSize * 2, status: 'active', createdAt: Date.now(), results: {} };
    for (const variant of test.variants) test.results[variant.id] = { assignments: 0, conversions: 0, totalValue: 0 };
    this.tests.set(testId, test);
    this.stats.activeTests++;
    this.emit('testCreated', test);
    return test;
  }
  getVariant(testId, chatId) {
    const test = this.tests.get(testId);
    if (!test || test.status !== 'active') return null;
    const chatAssignments = this.assignments.get(chatId) || {};
    if (chatAssignments[testId]) return test.variants.find(v => v.id === chatAssignments[testId]);
    const variantIndex = Math.floor(Math.random() * test.variants.length);
    const variant = test.variants[variantIndex];
    chatAssignments[testId] = variant.id;
    this.assignments.set(chatId, chatAssignments);
    test.results[variant.id].assignments++;
    this.stats.totalAssignments++;
    this._checkTestCompletion(testId);
    return variant;
  }
  recordConversion(testId, chatId, value = 1) {
    const test = this.tests.get(testId);
    if (!test) return;
    const chatAssignments = this.assignments.get(chatId) || {};
    const variantId = chatAssignments[testId];
    if (variantId && test.results[variantId]) { test.results[variantId].conversions++; test.results[variantId].totalValue += value; }
  }
  analyzeTest(testId) {
    const test = this.tests.get(testId);
    if (!test) return null;
    const analysis = { testId, name: test.name, status: test.status, variants: [], winner: null, confidence: 0, recommendation: '' };
    for (const variant of test.variants) {
      const results = test.results[variant.id];
      const rate = results.assignments > 0 ? results.conversions / results.assignments : 0;
      analysis.variants.push({ id: variant.id, name: variant.name, assignments: results.assignments, conversions: results.conversions, conversionRate: (rate * 100).toFixed(2) + '%', avgValue: results.conversions > 0 ? (results.totalValue / results.conversions).toFixed(2) : '0' });
    }
    if (analysis.variants.every(v => v.assignments >= this.options.minSampleSize)) {
      const sorted = [...analysis.variants].sort((a, b) => parseFloat(b.conversionRate) - parseFloat(a.conversionRate));
      analysis.winner = sorted[0].id;
      analysis.confidence = this._calculateConfidence(test.results[sorted[0].id], test.results[sorted[1].id]);
      analysis.recommendation = analysis.confidence >= this.options.confidenceLevel ? `"${sorted[0].name}" vence com ${(analysis.confidence * 100).toFixed(1)}% confiança` : 'Dados insuficientes';
    } else { analysis.recommendation = 'Coletando dados...'; }
    return analysis;
  }
  _calculateConfidence(resultA, resultB) {
    const nA = resultA.assignments, nB = resultB.assignments;
    const pA = resultA.conversions / nA, pB = resultB.conversions / nB;
    if (nA < 10 || nB < 10) return 0;
    const pooledP = (resultA.conversions + resultB.conversions) / (nA + nB);
    const se = Math.sqrt(pooledP * (1 - pooledP) * (1/nA + 1/nB));
    if (se === 0) return 0;
    const z = Math.abs(pA - pB) / se;
    if (z >= 2.58) return 0.99; if (z >= 1.96) return 0.95; if (z >= 1.64) return 0.90; if (z >= 1.28) return 0.80;
    return z / 2.58 * 0.80;
  }
  _checkTestCompletion(testId) {
    const test = this.tests.get(testId);
    if (!test) return;
    const total = Object.values(test.results).reduce((s, r) => s + r.assignments, 0);
    if (total >= test.targetSampleSize) { test.status = 'completed'; this.stats.activeTests--; this.stats.completedTests++; }
  }
  endTest(testId) {
    const test = this.tests.get(testId);
    if (test && test.status === 'active') { test.status = 'completed'; test.completedAt = Date.now(); this.stats.activeTests--; this.stats.completedTests++; }
    return this.analyzeTest(testId);
  }
  getTest(testId) { return this.tests.get(testId); }
  listTests(status = null) { const tests = Array.from(this.tests.values()); return status ? tests.filter(t => t.status === status) : tests; }
  getStats() { return { ...this.stats }; }
}

// 9. LANGUAGE DETECTOR
class LanguageDetector {
  constructor(options = {}) {
    this.options = { defaultLanguage: options.defaultLanguage || 'pt-BR', minConfidence: options.minConfidence || 0.6, ...options };
    this.languageProfiles = this._initLanguageProfiles();
    this.chatLanguages = new Map();
    this.stats = { detections: 0, languages: {} };
  }
  _initLanguageProfiles() {
    return {
      'pt-BR': { name: 'Português (Brasil)', commonWords: ['de', 'que', 'não', 'para', 'com', 'uma', 'os', 'no', 'se', 'você', 'obrigado', 'oi', 'olá'], patterns: [/ção$/, /ões$/, /mente$/], formalGreeting: 'Prezado(a)', casualGreeting: 'Oi', formalClosing: 'Atenciosamente', casualClosing: 'Abraços' },
      'en': { name: 'English', commonWords: ['the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'you', 'hello', 'hi', 'thanks'], patterns: [/tion$/, /ing$/, /ed$/, /ly$/], formalGreeting: 'Dear', casualGreeting: 'Hi', formalClosing: 'Best regards', casualClosing: 'Cheers' },
      'es': { name: 'Español', commonWords: ['de', 'la', 'que', 'el', 'en', 'y', 'a', 'los', 'se', 'hola', 'gracias', 'buenos'], patterns: [/ción$/, /mente$/, /ando$/, /iendo$/], formalGreeting: 'Estimado(a)', casualGreeting: 'Hola', formalClosing: 'Atentamente', casualClosing: 'Saludos' }
    };
  }
  detect(text) {
    if (!text || text.length < 10) return { language: this.options.defaultLanguage, confidence: 0, detected: false };
    this.stats.detections++;
    const words = text.toLowerCase().split(/\s+/);
    const scores = {};
    for (const [lang, profile] of Object.entries(this.languageProfiles)) {
      let score = 0, matches = 0;
      for (const word of words) if (profile.commonWords.includes(word)) { score += 2; matches++; }
      for (const pattern of profile.patterns) for (const word of words) if (pattern.test(word)) { score += 1; matches++; }
      scores[lang] = { score, matches, confidence: words.length > 0 ? Math.min(matches / words.length * 2, 1) : 0 };
    }
    const best = Object.entries(scores).sort((a, b) => b[1].confidence - a[1].confidence)[0];
    const result = { language: best[1].confidence >= this.options.minConfidence ? best[0] : this.options.defaultLanguage, confidence: best[1].confidence, detected: best[1].confidence >= this.options.minConfidence, allScores: scores };
    this.stats.languages[result.language] = (this.stats.languages[result.language] || 0) + 1;
    return result;
  }
  detectAndSetChatLanguage(chatId, text) { const detection = this.detect(text); if (detection.detected) this.chatLanguages.set(chatId, { language: detection.language, confidence: detection.confidence, detectedAt: Date.now() }); return detection; }
  getChatLanguage(chatId) { return this.chatLanguages.get(chatId)?.language || this.options.defaultLanguage; }
  getGreeting(chatId, formal = false) { const lang = this.getChatLanguage(chatId); const profile = this.languageProfiles[lang] || this.languageProfiles['pt-BR']; return formal ? profile.formalGreeting : profile.casualGreeting; }
  getClosing(chatId, formal = false) { const lang = this.getChatLanguage(chatId); const profile = this.languageProfiles[lang] || this.languageProfiles['pt-BR']; return formal ? profile.formalClosing : profile.casualClosing; }
  detectTone(text) { const formalIndicators = ['prezado', 'senhor', 'atenciosamente']; const casualIndicators = ['oi', 'opa', 'blz']; const lowerText = text.toLowerCase(); const formalScore = formalIndicators.filter(i => lowerText.includes(i)).length; const casualScore = casualIndicators.filter(i => lowerText.includes(i)).length; if (formalScore > casualScore) return 'formal'; if (casualScore > formalScore) return 'casual'; return 'neutral'; }
  getSupportedLanguages() { return Object.entries(this.languageProfiles).map(([code, profile]) => ({ code, name: profile.name })); }
  getStats() { return { ...this.stats }; }
}

// 10. RESPONSE CACHE
class ResponseCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.options = { maxSize: options.maxSize || 500, defaultTTL: options.defaultTTL || 24 * 60 * 60 * 1000, similarityThreshold: options.similarityThreshold || 0.85, ...options };
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }
  _generateKey(input) { return input.toLowerCase().replace(/[^\w\sáéíóúàèìòùâêîôûãõç]/g, '').replace(/\s+/g, ' ').trim(); }
  _similarity(str1, str2) { const set1 = new Set(str1.split(' ')), set2 = new Set(str2.split(' ')); const intersection = new Set([...set1].filter(x => set2.has(x))); const union = new Set([...set1, ...set2]); return intersection.size / union.size; }
  set(input, response, ttl = null) { const key = this._generateKey(input); const expiry = Date.now() + (ttl || this.options.defaultTTL); if (this.cache.size >= this.options.maxSize) this._evictOldest(); this.cache.set(key, { input, response, expiry, hits: 0, createdAt: Date.now(), lastHit: null }); this.stats.sets++; }
  get(input) {
    const key = this._generateKey(input);
    if (this.cache.has(key)) { const entry = this.cache.get(key); if (Date.now() < entry.expiry) { entry.hits++; entry.lastHit = Date.now(); this.stats.hits++; return { response: entry.response, exact: true, similarity: 1 }; } else this.cache.delete(key); }
    let bestMatch = null, bestSimilarity = 0;
    for (const [cachedKey, entry] of this.cache) { if (Date.now() >= entry.expiry) continue; const similarity = this._similarity(key, cachedKey); if (similarity >= this.options.similarityThreshold && similarity > bestSimilarity) { bestSimilarity = similarity; bestMatch = entry; } }
    if (bestMatch) { bestMatch.hits++; bestMatch.lastHit = Date.now(); this.stats.hits++; return { response: bestMatch.response, exact: false, similarity: bestSimilarity }; }
    this.stats.misses++; return null;
  }
  async getOrSet(input, generator) { const cached = this.get(input); if (cached) return cached; const response = await generator(); this.set(input, response); return { response, exact: true, similarity: 1, fromCache: false }; }
  _evictOldest() { let oldest = null, oldestTime = Infinity; for (const [key, entry] of this.cache) { const time = entry.lastHit || entry.createdAt; if (time < oldestTime) { oldestTime = time; oldest = key; } } if (oldest) { this.cache.delete(oldest); this.stats.evictions++; } }
  cleanup() { const now = Date.now(); let cleaned = 0; for (const [key, entry] of this.cache) if (now >= entry.expiry) { this.cache.delete(key); cleaned++; } return cleaned; }
  invalidate(input) { return this.cache.delete(this._generateKey(input)); }
  clear() { this.cache.clear(); }
  getStats() { return { ...this.stats, size: this.cache.size, hitRate: this.stats.hits + this.stats.misses > 0 ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1) + '%' : '0%' }; }
}

// 11. HISTORY COMPRESSOR
class HistoryCompressor {
  constructor(options = {}) { this.options = { maxTokens: options.maxTokens || 3000, compressionRatio: options.compressionRatio || 0.5, preserveRecent: options.preserveRecent || 5, ...options }; this.stats = { totalCompressed: 0, tokensSaved: 0 }; }
  estimateTokens(text) { return Math.ceil(text.length / 4); }
  compress(messages, maxTokens = null) {
    const targetTokens = maxTokens || this.options.maxTokens;
    let totalTokens = messages.reduce((sum, m) => sum + this.estimateTokens(m.text || m.body || m.content || ''), 0);
    if (totalTokens <= targetTokens) return { messages, compressed: false, tokensSaved: 0 };
    const preserve = messages.slice(-this.options.preserveRecent);
    const toCompress = messages.slice(0, -this.options.preserveRecent);
    const compressed = [];
    let currentBatch = [], currentTokens = 0;
    const batchMaxTokens = targetTokens * 0.3 / Math.max(toCompress.length / 10, 1);
    for (const msg of toCompress) { const text = msg.text || msg.body || msg.content || ''; const tokens = this.estimateTokens(text); if (currentTokens + tokens > batchMaxTokens && currentBatch.length > 0) { compressed.push(this._compressBatch(currentBatch)); currentBatch = []; currentTokens = 0; } currentBatch.push(msg); currentTokens += tokens; }
    if (currentBatch.length > 0) compressed.push(this._compressBatch(currentBatch));
    const result = [...compressed, ...preserve];
    const newTokens = result.reduce((sum, m) => sum + this.estimateTokens(m.text || m.body || m.content || ''), 0);
    const saved = totalTokens - newTokens;
    this.stats.totalCompressed++; this.stats.tokensSaved += saved;
    return { messages: result, compressed: true, originalTokens: totalTokens, newTokens, tokensSaved: saved, compressionRatio: ((1 - newTokens / totalTokens) * 100).toFixed(1) + '%' };
  }
  _compressBatch(messages) {
    if (messages.length === 1) return this._compressSingleMessage(messages[0]);
    const fromMe = messages.filter(m => m.fromMe || m.isFromMe);
    const fromCustomer = messages.filter(m => !(m.fromMe || m.isFromMe));
    const summary = [];
    if (fromCustomer.length > 0) summary.push(`Cliente (${fromCustomer.length} msgs): ${this._summarizeText(fromCustomer.map(m => m.text || m.body || '').join(' '))}`);
    if (fromMe.length > 0) summary.push(`Agente (${fromMe.length} msgs): ${this._summarizeText(fromMe.map(m => m.text || m.body || '').join(' '))}`);
    return { role: 'system', content: `[HISTÓRICO COMPRIMIDO]\n${summary.join('\n')}`, compressed: true, originalCount: messages.length };
  }
  _compressSingleMessage(message) { const text = message.text || message.body || message.content || ''; if (this.estimateTokens(text) <= 50) return message; return { ...message, text: this._summarizeText(text), content: this._summarizeText(text), compressed: true }; }
  _summarizeText(text, maxLength = 150) { if (text.length <= maxLength) return text; const sentences = text.split(/[.!?]+/).filter(s => s.trim()); if (sentences.length <= 2) return text.substring(0, maxLength) + '...'; const first = sentences[0].trim(), last = sentences[sentences.length - 1].trim(); if (first.length + last.length < maxLength) return `${first}. [...] ${last}`; return first.substring(0, maxLength) + '...'; }
  prepareForAI(messages, maxTokens = null) { const { messages: compressed, tokensSaved, compressionRatio } = this.compress(messages, maxTokens); return { messages: compressed.map(m => ({ role: m.fromMe || m.isFromMe ? 'assistant' : 'user', content: m.text || m.body || m.content || '' })), tokensSaved, compressionRatio }; }
  getStats() { return { ...this.stats, avgTokensSaved: this.stats.totalCompressed > 0 ? Math.round(this.stats.tokensSaved / this.stats.totalCompressed) : 0 }; }
}

// 12. BATCH PROCESSOR
class BatchProcessor extends EventEmitter {
  constructor(options = {}) { super(); this.queue = []; this.processing = false; this.options = { batchSize: options.batchSize || 10, batchDelay: options.batchDelay || 1000, maxQueueSize: options.maxQueueSize || 100, timeout: options.timeout || 30000, ...options }; this.processor = options.processor || (async (items) => items); this.batchTimeout = null; this.stats = { totalProcessed: 0, totalBatches: 0, avgBatchSize: 0, errors: 0 }; }
  add(item) { return new Promise((resolve, reject) => { if (this.queue.length >= this.options.maxQueueSize) { reject(new Error('Queue full')); return; } this.queue.push({ item, resolve, reject, addedAt: Date.now() }); this._scheduleBatch(); }); }
  addAll(items) { return Promise.all(items.map(item => this.add(item))); }
  _scheduleBatch() { if (this.batchTimeout) return; if (this.queue.length >= this.options.batchSize) { this._processBatch(); return; } this.batchTimeout = setTimeout(() => { this.batchTimeout = null; this._processBatch(); }, this.options.batchDelay); }
  async _processBatch() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const batch = this.queue.splice(0, this.options.batchSize);
    const items = batch.map(b => b.item);
    try { const results = await Promise.race([this.processor(items), new Promise((_, reject) => setTimeout(() => reject(new Error('Batch timeout')), this.options.timeout))]); for (let i = 0; i < batch.length; i++) batch[i].resolve(results[i] || results); this.stats.totalProcessed += batch.length; this.stats.totalBatches++; this.stats.avgBatchSize = this.stats.totalProcessed / this.stats.totalBatches; this.emit('batchProcessed', { count: batch.length }); } catch (error) { for (const b of batch) b.reject(error); this.stats.errors++; }
    this.processing = false;
    if (this.queue.length > 0) this._scheduleBatch();
  }
  async flush() { if (this.batchTimeout) { clearTimeout(this.batchTimeout); this.batchTimeout = null; } const promises = []; while (this.queue.length > 0) promises.push(this._processBatch()); await Promise.all(promises); }
  setProcessor(processor) { this.processor = processor; }
  clear() { for (const b of this.queue) b.reject(new Error('Queue cleared')); this.queue = []; }
  getQueueSize() { return this.queue.length; }
  getStats() { return { ...this.stats, queueSize: this.queue.length, isProcessing: this.processing }; }
}

// 13. LAZY LOADER
class LazyLoader {
  constructor(options = {}) { this.modules = new Map(); this.loaded = new Map(); this.loading = new Map(); this.options = { preloadDelay: options.preloadDelay || 5000, ...options }; this.stats = { totalModules: 0, loadedModules: 0, loadTime: {} }; }
  register(moduleId, loader, options = {}) { this.modules.set(moduleId, { loader, priority: options.priority || 'low', preload: options.preload || false, dependencies: options.dependencies || [], description: options.description || '' }); this.stats.totalModules++; }
  async load(moduleId) {
    if (this.loaded.has(moduleId)) return this.loaded.get(moduleId);
    if (this.loading.has(moduleId)) return this.loading.get(moduleId);
    const moduleDef = this.modules.get(moduleId);
    if (!moduleDef) throw new Error(`Module not registered: ${moduleId}`);
    for (const dep of moduleDef.dependencies) await this.load(dep);
    const startTime = Date.now();
    const loadPromise = (async () => { try { const module = await moduleDef.loader(); this.loaded.set(moduleId, module); this.loading.delete(moduleId); this.stats.loadedModules++; this.stats.loadTime[moduleId] = Date.now() - startTime; return module; } catch (error) { this.loading.delete(moduleId); throw error; } })();
    this.loading.set(moduleId, loadPromise);
    return loadPromise;
  }
  async loadAll(moduleIds) { return Promise.all(moduleIds.map(id => this.load(id))); }
  async get(moduleId) { if (this.loaded.has(moduleId)) return this.loaded.get(moduleId); return this.load(moduleId); }
  isLoaded(moduleId) { return this.loaded.has(moduleId); }
  unload(moduleId) { const module = this.loaded.get(moduleId); if (module) { if (typeof module.cleanup === 'function') module.cleanup(); this.loaded.delete(moduleId); this.stats.loadedModules--; return true; } return false; }
  async preloadHighPriority() { const highPriority = []; for (const [id, def] of this.modules) if (def.priority === 'high' || def.preload) highPriority.push(id); if (highPriority.length > 0) await this.loadAll(highPriority); }
  schedulePreload() { setTimeout(() => { this.preloadHighPriority(); }, this.options.preloadDelay); }
  listModules() { const list = []; for (const [id, def] of this.modules) list.push({ id, priority: def.priority, loaded: this.loaded.has(id), loading: this.loading.has(id), loadTime: this.stats.loadTime[id] || null, dependencies: def.dependencies, description: def.description }); return list; }
  getStats() { return { ...this.stats, memoryEstimate: `${(JSON.stringify([...this.loaded.values()]).length / 1024).toFixed(1)} KB` }; }
}

// MAIN SERVICE CLASS
class SmartBotAIPlusService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.knowledgeBase = new KnowledgeBase(options.knowledgeBase);
    this.summarizer = new ConversationSummarizer(options.summarizer);
    this.leadScoring = new LeadScoringAI(options.leadScoring);
    this.autoTagger = new AutoTagger(options.autoTagger);
    this.qualityScorer = new ResponseQualityScorer(options.qualityScorer);
    this.proactiveEngagement = new ProactiveEngagement(options.proactiveEngagement);
    this.smartScheduler = new SmartScheduler(options.smartScheduler);
    this.abTesting = new ABTestingEngine(options.abTesting);
    this.languageDetector = new LanguageDetector(options.languageDetector);
    this.responseCache = new ResponseCache(options.responseCache);
    this.historyCompressor = new HistoryCompressor(options.historyCompressor);
    this.batchProcessor = new BatchProcessor(options.batchProcessor);
    this.lazyLoader = new LazyLoader(options.lazyLoader);
    this.initialized = false;
    this.options = options;
    this.knowledgeBase.on('documentAdded', (data) => this.emit('knowledge:documentAdded', data));
    this.leadScoring.on('scoreUpdated', (data) => this.emit('lead:scoreUpdated', data));
    this.abTesting.on('testCreated', (data) => this.emit('abtest:created', data));
    this.batchProcessor.on('batchProcessed', (data) => this.emit('batch:processed', data));
  }
  async init() { if (this.initialized) return; this.leadScoring.applyDecay(); this.responseCache.cleanup(); this.lazyLoader.schedulePreload(); this.initialized = true; logger.info('[SmartBot AI Plus Service] ✅ 13 sistemas inicializados'); }
  async processMessage(chatId, message, context = {}) {
    const text = message.text || message.body || '';
    const results = {};
    results.language = this.languageDetector.detectAndSetChatLanguage(chatId, text);
    if (context.messages && context.messages.length > 0) results.tags = this.autoTagger.analyzeAndTag(chatId, context.messages);
    const signals = this.leadScoring.analyzeMessage(text);
    results.leadScore = this.leadScoring.scoreContact(chatId, { ...context.contactData, ...signals, messageCount: (context.messageCount || 0) + 1 });
    if (text.includes('?') || context.needsKnowledge) results.knowledge = this.knowledgeBase.getContextForQuery(text);
    results.cachedResponse = this.responseCache.get(text);
    results.suggestions = this.proactiveEngagement.getSuggestions(chatId);
    results.bestTime = this.smartScheduler.getBestTimes(chatId);
    const activeTests = this.abTesting.listTests('active');
    if (activeTests.length > 0) results.abVariant = this.abTesting.getVariant(activeTests[0].id, chatId);
    if (!message.fromMe) this.smartScheduler.recordResponse(chatId);
    return { chatId, processedAt: Date.now(), ...results };
  }
  prepareAIContext(chatId, messages, maxTokens = 3000) {
    const compressed = this.historyCompressor.prepareForAI(messages, maxTokens * 0.7);
    const lastMessage = messages[messages.length - 1];
    const text = lastMessage?.text || lastMessage?.body || '';
    const knowledge = this.knowledgeBase.getContextForQuery(text, maxTokens * 0.3);
    const { summary } = this.summarizer.prepareContext(chatId, messages, maxTokens);
    return { messages: compressed.messages, knowledge: knowledge.context, summary: summary?.text, tokensSaved: compressed.tokensSaved, sources: knowledge.sources };
  }
  evaluateResponse(input, response, context = {}) { return this.qualityScorer.scoreResponse(input, response, context); }
  cacheResponse(input, response, ttl) { this.responseCache.set(input, response, ttl); }
  getStats() { return { knowledgeBase: this.knowledgeBase.getStats(), summarizer: this.summarizer.getStats(), leadScoring: this.leadScoring.getStats(), autoTagger: this.autoTagger.getStats(), qualityScorer: this.qualityScorer.getStats(), proactiveEngagement: this.proactiveEngagement.getStats(), smartScheduler: this.smartScheduler.getStats(), abTesting: this.abTesting.getStats(), languageDetector: this.languageDetector.getStats(), responseCache: this.responseCache.getStats(), historyCompressor: this.historyCompressor.getStats(), batchProcessor: this.batchProcessor.getStats(), lazyLoader: this.lazyLoader.getStats() }; }
  exportData() { return { knowledgeBase: { documents: this.knowledgeBase.listDocuments(), stats: this.knowledgeBase.getStats() }, leadScores: this.leadScoring.getTopLeads(100), tags: Array.from(this.autoTagger.tags.entries()), abTests: this.abTesting.listTests(), stats: this.getStats(), exportedAt: new Date().toISOString() }; }
}

module.exports = { SmartBotAIPlusService, KnowledgeBase, ConversationSummarizer, LeadScoringAI, AutoTagger, ResponseQualityScorer, ProactiveEngagement, SmartScheduler, ABTestingEngine, LanguageDetector, ResponseCache, HistoryCompressor, BatchProcessor, LazyLoader };
