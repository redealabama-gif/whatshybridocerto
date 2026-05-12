/**
 * 🎓 Validated Learning Pipeline - Node.js Backend Version
 * WhatsHybrid AI System v7.9.13
 * 
 * Implements strict validation criteria for pattern graduation:
 * - Minimum 5 samples required before graduation
 * - Minimum 80% positive feedback rate for graduation
 * - Automatic discard if positive rate < 30% with 5+ feedback
 * - Tracks response effectiveness per pattern
 * - Emits events on graduation/discard via EventEmitter
 * 
 * @module ValidatedLearningPipeline
 * @version 1.0.0
 */

const fs = require('fs').promises;
const logger = require('../../utils/logger');
const path = require('path');
const EventEmitter = require('events');

/**
 * Feedback types allowed for pattern validation
 * @typedef {'positive'|'negative'|'neutral'|'edited'|'converted'} FeedbackType
 */

/**
 * Interaction data for learning
 * @typedef {Object} InteractionData
 * @property {string} intent - Intent classification
 * @property {string} question - Original user question
 * @property {string} response - AI-generated response
 * @property {FeedbackType} feedback - User feedback type
 * @property {boolean} [wasEdited] - Whether response was edited
 * @property {string} [editedResponse] - The edited version if wasEdited=true
 */

/**
 * Pattern statistics
 * @typedef {Object} PatternStats
 * @property {string} key - Pattern key
 * @property {number} sampleCount - Number of samples
 * @property {number} positiveCount - Positive feedback count
 * @property {number} negativeCount - Negative feedback count
 * @property {number} neutralCount - Neutral feedback count
 * @property {number} editedCount - Edited feedback count
 * @property {number} convertedCount - Converted feedback count
 * @property {number} positiveRate - Positive feedback rate (0-1)
 * @property {Object.<string, number>} responses - Response text usage counts
 * @property {string} topResponse - Most commonly used response
 * @property {number} createdAt - Timestamp when pattern was created
 * @property {number} lastInteractionAt - Timestamp of last interaction
 */

/**
 * Graduated pattern
 * @typedef {Object} GraduatedPattern
 * @property {string} key - Pattern key
 * @property {string} intent - Intent classification
 * @property {string} topResponse - Most validated response
 * @property {number} positiveRate - Final positive rate
 * @property {number} sampleCount - Total samples used
 * @property {number} graduatedAt - Timestamp of graduation
 */

class ValidatedLearningPipeline extends EventEmitter {
  /**
   * Create a new ValidatedLearningPipeline
   * @param {Object} options - Configuration options
   * @param {string} [options.storagePath] - Path to storage file
   * @param {number} [options.minSamples] - Minimum samples for graduation (default: 5)
   * @param {number} [options.minPositiveRate] - Minimum positive rate for graduation (default: 0.8)
   * @param {number} [options.discardThreshold] - Discard if positive rate below this (default: 0.3)
   */
  constructor(options = {}) {
    super();
    
    this.storagePath = options.storagePath || path.join(__dirname, '../../../data/validated-learning.json');
    this.minSamples = options.minSamples || 5;
    this.minPositiveRate = options.minPositiveRate || 0.8;
    this.discardThreshold = options.discardThreshold || 0.3;
    
    // CORREÇÃO P1: tenantId para namespace no banco — sem cross-tenant contamination
    this.tenantId = options.tenantId || 'default';

    /** @type {Map<string, PatternStats>} */
    this.candidates = new Map();
    
    /** @type {Map<string, GraduatedPattern>} */
    this.graduated = new Map();
    
    /** @type {Set<string>} */
    this.discarded = new Set();
    
    this.totalInteractions = 0;
    this.initialized = false;
  }

  /**
   * Initialize the learning pipeline
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized) return;
    
    try {
      // CORREÇÃO P1: Carregar do banco SQL com namespace por tenant
      await this._loadFromDB();
      this.initialized = true;
      logger.info(`[ValidatedLearningPipeline] ✅ Tenant "${this.tenantId}": ${this.candidates.size} candidates, ${this.graduated.size} graduated`);
    } catch (error) {
      logger.error('[ValidatedLearningPipeline] Initialization error:', error);
      // Fallback para arquivo JSON (compatibilidade com instâncias existentes)
      try {
        await this._ensureStorageDirectory();
        await this._loadFromStorage();
        this.initialized = true;
      } catch (fallbackErr) {
        logger.warn('[ValidatedLearningPipeline] JSON fallback also failed:', fallbackErr.message);
        this.initialized = true; // continua mesmo sem dados
      }
    }
  }

  /** CORREÇÃO P1: Carrega padrões do banco com namespace por tenant */
  async _loadFromDB() {
    try {
      const db = require('../../utils/database');
      const rows = db.all(
        'SELECT * FROM learning_patterns WHERE workspace_id = ?',
        [this.tenantId]
      );
      for (const row of rows) {
        const positiveCount = row.positive_count || 0;
        const negativeCount = row.negative_count || 0;
        const totalFeedback = positiveCount + negativeCount;
        // FIX v8.0.5: dados carregados precisam ter o mesmo shape do estado em memória
        // para que getTopGraduated, _evaluatePattern e o resto funcionem.
        // Antes faltavam: positiveRate, sampleCount, topResponse, key, responses.
        const data = {
          key: row.pattern_key,           // chave usada por _evaluatePattern
          patternKey: row.pattern_key,    // back-compat
          intent: row.intent,
          question: row.question,
          response: row.response,
          topResponse: row.response,      // alias usado em getTopGraduated
          positiveCount,
          negativeCount,
          neutralCount: 0,                // não persistido — começa zerado
          editedCount: 0,
          convertedCount: 0,
          totalCount: row.total_count || totalFeedback,
          sampleCount: row.total_count || totalFeedback,
          feedbackScore: row.feedback_score || 0,
          positiveRate: totalFeedback > 0 ? positiveCount / totalFeedback : 0,
          responses: row.response ? { [row.response]: positiveCount } : {},
          createdAt: row.updated_at ? new Date(row.updated_at).getTime() : Date.now(),
          lastInteractionAt: row.updated_at ? new Date(row.updated_at).getTime() : 0,
        };
        if (row.status === 'graduated') {
          this.graduated.set(row.pattern_key, { ...data, graduatedAt: row.graduated_at });
        } else if (row.status === 'candidate') {
          this.candidates.set(row.pattern_key, data);
        } else {
          this.discarded.add(row.pattern_key);
        }
      }
    } catch (err) {
      // banco pode não estar inicializado ainda no primeiro boot
      logger.warn('[ValidatedLearningPipeline] _loadFromDB warning:', err.message);
    }
  }

  /** CORREÇÃO P1: Persiste padrão no banco com namespace por tenant */
  _persistPatternToDB(patternKey, data, status) {
    try {
      const db = require('../../utils/database');
      db.run(
        `INSERT INTO learning_patterns
         (id, workspace_id, pattern_key, intent, question, response, feedback_score,
          positive_count, negative_count, total_count, status, graduated_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(workspace_id, pattern_key) DO UPDATE SET
           feedback_score=excluded.feedback_score,
           positive_count=excluded.positive_count,
           negative_count=excluded.negative_count,
           total_count=excluded.total_count,
           status=excluded.status,
           graduated_at=excluded.graduated_at,
           updated_at=CURRENT_TIMESTAMP`,
        [
          `${this.tenantId}_${patternKey}`,
          this.tenantId,
          patternKey,
          data.intent || '',
          data.question || '',
          // FIX v8.0.5: candidates em memória guardam a resposta em `topResponse`
          // (computado por _findTopResponse). Antes só procurava `data.response`,
          // que não existia no objeto candidate, então persistíamos response=''.
          // Resultado: graduated ficava no banco sem texto da resposta aprendida.
          data.topResponse || data.response || '',
          data.feedbackScore || 0,
          data.positiveCount || 0,
          data.negativeCount || 0,
          // FIX v8.0.5: candidates usam `sampleCount`, não `totalCount`
          data.sampleCount || data.totalCount || 0,
          status,
          status === 'graduated' ? new Date().toISOString() : null,
        ]
      );
    } catch (err) {
      logger.warn('[ValidatedLearningPipeline] _persistPatternToDB error:', err.message);
    }
  }

  /**
   * Record an interaction for learning
   * @param {InteractionData} data - Interaction data
   * @returns {Promise<void>}
   */
  async recordInteraction(data) {
    const { intent, question, response, feedback, wasEdited, editedResponse } = data;
    
    // Validate required fields
    if (!intent || !question || !response || !feedback) {
      throw new Error('Missing required fields: intent, question, response, feedback');
    }
    
    // Validate feedback type
    const validFeedback = ['positive', 'negative', 'neutral', 'edited', 'converted'];
    if (!validFeedback.includes(feedback)) {
      throw new Error(`Invalid feedback type: ${feedback}. Must be one of: ${validFeedback.join(', ')}`);
    }
    
    // Create normalized pattern key
    const patternKey = this._normalizePatternKey(question);
    
    // Check if pattern is already graduated or discarded
    if (this.graduated.has(patternKey)) {
      logger.info('[ValidatedLearningPipeline] Pattern already graduated:', patternKey);
      return;
    }
    
    if (this.discarded.has(patternKey)) {
      logger.info('[ValidatedLearningPipeline] Pattern was discarded:', patternKey);
      return;
    }
    
    // Get or create candidate pattern
    const candidate = this.candidates.get(patternKey) || {
      key: patternKey,
      intent,
      sampleCount: 0,
      positiveCount: 0,
      negativeCount: 0,
      neutralCount: 0,
      editedCount: 0,
      convertedCount: 0,
      positiveRate: 0,
      responses: {},
      topResponse: '',
      createdAt: Date.now(),
      lastInteractionAt: 0
    };
    
    // Determine which response to track
    const responseToTrack = wasEdited && editedResponse ? editedResponse : response;
    
    // Update response tracking
    candidate.responses[responseToTrack] = (candidate.responses[responseToTrack] || 0) + 1;
    
    // Update feedback counts
    candidate.sampleCount++;
    
    switch (feedback) {
      case 'positive':
        candidate.positiveCount++;
        break;
      case 'negative':
        candidate.negativeCount++;
        break;
      case 'neutral':
        candidate.neutralCount++;
        break;
      case 'edited':
        candidate.editedCount++;
        // Treat edits as negative feedback for the original response
        candidate.negativeCount++;
        break;
      case 'converted':
        candidate.convertedCount++;
        candidate.positiveCount++;
        break;
    }
    
    // Calculate positive rate
    const totalFeedback = candidate.positiveCount + candidate.negativeCount;
    candidate.positiveRate = totalFeedback > 0 ? candidate.positiveCount / totalFeedback : 0;
    
    // Find top response
    candidate.topResponse = this._findTopResponse(candidate.responses);
    
    candidate.lastInteractionAt = Date.now();
    
    // Save updated candidate
    this.candidates.set(patternKey, candidate);
    // CORREÇÃO P1: Persiste no banco com namespace por tenant
    this._persistPatternToDB(patternKey, candidate, 'candidate');
    this.totalInteractions++;
    
    // Check graduation criteria
    await this._evaluatePattern(patternKey, candidate);
    
    // Persist to storage
    await this._saveToStorage();
  }

  /**
   * Get all graduated patterns
   * @returns {GraduatedPattern[]} Array of graduated patterns
   */
  getGraduated() {
    return Array.from(this.graduated.values());
  }

  /**
   * P3 FIX: Get the top N graduated patterns for a given intent, sorted by positive rate.
   * Used by DynamicPromptBuilder to inject few-shot examples into the system prompt.
   *
   * @param {string} intent - Intent to filter by (e.g. 'complaint', 'purchase')
   * @param {number} [n=3] - Maximum number of examples to return
   * @returns {Array<{trigger: string, response: string, intent: string, positiveRate: number}>}
   */
  getTopGraduated(intent, n = 3) {
    return Array.from(this.graduated.values())
      .filter(p => !intent || p.intent === intent)
      .sort((a, b) => (b.positiveRate || 0) - (a.positiveRate || 0))
      .slice(0, n)
      .map(p => ({
        // FIX FATAL v8.0.5: o objeto graduated tem `topResponse`, não `response`.
        // Antes este map retornava response='' (string vazia) porque procurava
        // o nome errado do campo. Resultado: o LLM recebia few-shot com a TRIGGER
        // mas SEM A RESPOSTA aprendida, anulando o ganho do aprendizado.
        // Aceita ambos: padrões em memória (topResponse) e do banco (response).
        trigger: p.question || p.trigger || p.key || '',
        response: p.topResponse || p.response || p.bestResponse || '',
        intent: p.intent,
        positiveRate: p.positiveRate || 0
      }))
      // FIX adicional: filtra patterns sem resposta — não tem porque enviar ao LLM
      .filter(ex => ex.response && ex.response.length > 0);
  }

  /**
   * P3 FIX: Record per-interaction feedback so patterns can graduate over time.
   * Called from AIOrchestrator.recordFeedback().
   *
   * @param {string} interactionId
   * @param {'positive'|'negative'|'neutral'} feedback
   */
  recordFeedback(interactionId, feedback) {
    // Delegate to recordInteraction if the pipeline tracks interactions by ID
    if (this.interactions && this.interactions.has(interactionId)) {
      const interaction = this.interactions.get(interactionId);
      // FIX FATAL v8.0.5: passa string como recordInteraction espera
      // (antes passava número que sempre falhava na validação)
      this.recordInteraction({
        ...interaction,
        feedback,  // mantém string original
      }).catch(err => logger.warn('[ValidatedLearningPipeline] recordFeedback error:', err.message));
    }
  }

  /**
   * Get all candidate patterns with their stats
   * @returns {PatternStats[]} Array of candidate patterns
   */
  getCandidates() {
    return Array.from(this.candidates.values());
  }

  /**
   * Get learning pipeline statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      candidates: this.candidates.size,
      graduated: this.graduated.size,
      discarded: this.discarded.size,
      totalInteractions: this.totalInteractions,
      avgPositiveRate: this._calculateAvgPositiveRate()
    };
  }

  /**
   * Reset all learning data
   * @returns {Promise<void>}
   */
  async reset() {
    this.candidates.clear();
    this.graduated.clear();
    this.discarded.clear();
    this.totalInteractions = 0;
    
    await this._saveToStorage();
    
    logger.info('[ValidatedLearningPipeline] 🔄 Reset complete');
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Normalize pattern key for consistent matching
   * @private
   * @param {string} text - Text to normalize
   * @returns {string} Normalized pattern key
   */
  _normalizePatternKey(text) {
    if (!text || typeof text !== 'string') return '';
    
    // Convert to lowercase
    let normalized = text.toLowerCase();
    
    // Remove punctuation
    normalized = normalized.replace(/[^\w\s]/g, ' ');
    
    // Split into words and sort
    const words = normalized
      .split(/\s+/)
      .filter(w => w.length > 0)
      .sort();
    
    // Join and truncate to 100 chars
    normalized = words.join(' ').substring(0, 100);
    
    return normalized;
  }

  /**
   * Find the most commonly used response
   * @private
   * @param {Object.<string, number>} responses - Response usage counts
   * @returns {string} Most common response
   */
  _findTopResponse(responses) {
    let topResponse = '';
    let maxCount = 0;
    
    for (const [response, count] of Object.entries(responses)) {
      if (count > maxCount) {
        maxCount = count;
        topResponse = response;
      }
    }
    
    return topResponse;
  }

  /**
   * Evaluate pattern for graduation or discard
   * @private
   * @param {string} patternKey - Pattern key
   * @param {PatternStats} candidate - Candidate pattern
   * @returns {Promise<void>}
   */
  async _evaluatePattern(patternKey, candidate) {
    const { sampleCount, positiveRate } = candidate;
    
    // Need at least minSamples before evaluation
    if (sampleCount < this.minSamples) {
      return;
    }
    
    // Check for discard (poor performance)
    if (positiveRate < this.discardThreshold) {
      this.candidates.delete(patternKey);
      this.discarded.add(patternKey);
      
      // FIX FATAL v8.0.5: persistir mudança de status no banco.
      // Antes: o status 'discarded' só ficava em memória (Set). Depois de restart,
      // o pattern era recarregado como 'candidate' do estado anterior salvo.
      this._persistPatternToDB(patternKey, candidate, 'discarded');
      
      logger.info('[ValidatedLearningPipeline] ❌ Pattern discarded:', patternKey, `(${(positiveRate * 100).toFixed(1)}% positive)`);
      
      // Emit discard event
      this.emit('pattern:discarded', {
        key: patternKey,
        intent: candidate.intent,
        positiveRate,
        sampleCount,
        discardedAt: Date.now()
      });
      
      return;
    }
    
    // Check for graduation (excellent performance)
    if (positiveRate >= this.minPositiveRate) {
      const graduated = {
        key: patternKey,
        intent: candidate.intent,
        topResponse: candidate.topResponse,
        positiveRate,
        sampleCount,
        graduatedAt: Date.now()
      };
      
      this.graduated.set(patternKey, graduated);
      this.candidates.delete(patternKey);
      
      // FIX FATAL v8.0.5: persistir como 'graduated' no banco.
      // Antes: depois de restart, o pattern voltava a ser 'candidate' porque
      // o último persist foi com esse status. Padrões aprendidos eram perdidos.
      // Mantemos o objeto candidate completo (com responses, counts) para
      // não perder o histórico de aprendizado.
      this._persistPatternToDB(patternKey, {
        ...candidate,
        topResponse: candidate.topResponse, // já está em candidate
      }, 'graduated');
      
      logger.info('[ValidatedLearningPipeline] 🎓 Pattern graduated:', patternKey, `(${(positiveRate * 100).toFixed(1)}% positive)`);
      
      // Emit graduation event
      this.emit('pattern:graduated', graduated);
    }
  }

  /**
   * Calculate average positive rate across all candidates
   * @private
   * @returns {number} Average positive rate
   */
  _calculateAvgPositiveRate() {
    if (this.candidates.size === 0) return 0;
    
    let sum = 0;
    for (const candidate of this.candidates.values()) {
      sum += candidate.positiveRate;
    }
    
    return sum / this.candidates.size;
  }

  /**
   * Ensure storage directory exists
   * @private
   * @returns {Promise<void>}
   */
  async _ensureStorageDirectory() {
    const dir = path.dirname(this.storagePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Load data from storage file
   * @private
   * @returns {Promise<void>}
   */
  async _loadFromStorage() {
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Restore candidates
      if (parsed.candidates && Array.isArray(parsed.candidates)) {
        for (const candidate of parsed.candidates) {
          this.candidates.set(candidate.key, candidate);
        }
      }
      
      // Restore graduated
      if (parsed.graduated && Array.isArray(parsed.graduated)) {
        for (const pattern of parsed.graduated) {
          this.graduated.set(pattern.key, pattern);
        }
      }
      
      // Restore discarded
      if (parsed.discarded && Array.isArray(parsed.discarded)) {
        this.discarded = new Set(parsed.discarded);
      }
      
      // Restore total interactions
      if (typeof parsed.totalInteractions === 'number') {
        this.totalInteractions = parsed.totalInteractions;
      }
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('[ValidatedLearningPipeline] No existing storage file, starting fresh');
      } else {
        logger.error('[ValidatedLearningPipeline] Error loading storage:', error);
      }
    }
  }

  /**
   * Save data to storage file (legacy JSON backup — DB é a fonte primária)
   * @private
   * @returns {Promise<void>}
   */
  async _saveToStorage() {
    try {
      // FIX v8.0.5: garantir diretório existe ANTES de escrever (não só no fallback)
      await this._ensureStorageDirectory();
      
      const data = {
        candidates: Array.from(this.candidates.values()),
        graduated: Array.from(this.graduated.values()),
        discarded: Array.from(this.discarded),
        totalInteractions: this.totalInteractions,
        savedAt: Date.now()
      };
      
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      // FIX v8.0.5: NÃO relançar — o JSON é só backup legado.
      // O banco SQLite (via _persistPatternToDB) é a fonte primária de verdade.
      // Antes: o throw quebrava recordInteraction inteiro e o feedback era perdido.
      logger.warn('[ValidatedLearningPipeline] JSON backup save warning (non-fatal):', error.message);
    }
  }
}

module.exports = ValidatedLearningPipeline;
