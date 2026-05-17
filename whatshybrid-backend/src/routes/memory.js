/**
 * Memory Routes - API para Memória Híbrida "Leão"
 */

const express = require('express');
const router = express.Router();
const { authenticate, apiKeyAuth } = require('../middleware/auth');
const { makeLikeTerm } = require('../utils/sql-helpers');
const { checkSubscription } = require('../middleware/subscription');
const { body, validationResult } = require('express-validator');
const database = require('../utils/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

/**
 * POST /api/v1/memory/batch
 * Sincroniza múltiplas memórias
 * FIX PEND-HIGH-002: Requer plano premium (memória avançada)
 */
router.post(
  '/batch',
  authenticate,
  checkSubscription('memory'),
  body('memories').optional().isArray().withMessage('memories deve ser um array'),
  body('events').optional().isArray().withMessage('events deve ser um array'),
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Compat: alguns clientes antigos enviam { events: [...] } em vez de { memories: [...] }
    let { memories } = req.body;
    if (!Array.isArray(memories) && Array.isArray(req.body.events)) {
      memories = req.body.events.map(e => {
        const mem = (e && e.memory) ? e.memory : (e || {});
        return {
          id: mem.id || e.id,
          chatId: mem.chatId || e.chatId || e.chatKey || mem.chatKey,
          chatTitle: mem.chatTitle || mem.chat_title || mem.title || '',
          phoneNumber: mem.phoneNumber || mem.phone_number || mem.phone || '',
          summary: mem.summary || mem.profile || '',
          facts: mem.facts || [],
          interactions: mem.interactions || [],
          context: mem.context || {},
          metrics: mem.metrics || {},
          version: mem.version || e.version || 1,
          updatedAt: mem.updatedAt || mem.updated_at || e.timestamp || Date.now(),
          _deleted: !!(mem._deleted || e._deleted)
        };
      });
    }

    if (!Array.isArray(memories)) {
      return res.status(400).json({ success: false, error: 'memories ou events deve ser um array' });
    }

    // Garantir chatId (ou chatKey) em cada item
    for (const m of memories) {
      if (!m || !(m.chatId || m.chatKey)) {
        return res.status(400).json({ success: false, error: 'chatId é obrigatório em cada memória' });
      }
      if (!m.chatId && m.chatKey) m.chatId = m.chatKey;
    }
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    const results = { synced: 0, deleted: 0, errors: [] };
    
    for (const memory of memories) {
      try {
        if (memory._deleted) {
          // Deleta memória
          await db.run(`
            DELETE FROM chat_memories WHERE chat_id = ? AND workspace_id = ?
          `, [memory.chatId, workspaceId]);
          results.deleted++;
        } else {
          // Upsert memória
          const existing = await db.get(`
            SELECT * FROM chat_memories WHERE chat_id = ? AND workspace_id = ?
          `, [memory.chatId, workspaceId]);
          
          if (existing) {
            // Update
            await db.run(`
              UPDATE chat_memories SET
                chat_title = ?,
                phone_number = ?,
                summary = ?,
                facts = ?,
                interactions = ?,
                context = ?,
                metrics = ?,
                version = ?,
                updated_at = ?
              WHERE chat_id = ? AND workspace_id = ?
            `, [
              memory.chatTitle,
              memory.phoneNumber,
              memory.summary,
              JSON.stringify(memory.facts || []),
              JSON.stringify(memory.interactions || []),
              JSON.stringify(memory.context || {}),
              JSON.stringify(memory.metrics || {}),
              memory.version || 1,
              Date.now(),
              memory.chatId,
              workspaceId
            ]);
          } else {
            // Insert
            await db.run(`
              INSERT INTO chat_memories (
                id, chat_id, workspace_id, chat_title, phone_number,
                summary, facts, interactions, context, metrics,
                version, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              uuidv4(),
              memory.chatId,
              workspaceId,
              memory.chatTitle,
              memory.phoneNumber,
              memory.summary,
              JSON.stringify(memory.facts || []),
              JSON.stringify(memory.interactions || []),
              JSON.stringify(memory.context || {}),
              JSON.stringify(memory.metrics || {}),
              memory.version || 1,
              memory.createdAt || Date.now(),
              Date.now()
            ]);
          }
          results.synced++;
        }
      } catch (e) {
        results.errors.push({ chatId: memory.chatId, error: e.message });
      }
    }
    
    res.json({
      success: true,
      ...results
    });
    
  } catch (error) {
    logger.error('Error syncing memories:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/memory/:chatId
 * Obtém memória de um chat específico
 */

/**
 * GET /api/v1/memory/query
 * Compat: consulta memória por chatKey/chatId (usado pela extensão)
 */
router.get('/query', authenticate, checkSubscription('memory'), async (req, res) => {
  try {
    const chatId = req.query.chatId || req.query.chatKey;
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'chatKey/chatId obrigatório' });
    }

    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;

    const row = await db.get(`
      SELECT * FROM chat_memories WHERE chat_id = ? AND workspace_id = ?
    `, [chatId, workspaceId]);

    if (!row) {
      return res.json({ success: true, data: null });
    }

    // Normalizar campos JSON
    const memory = {
      ...row,
      facts: (() => { try { return JSON.parse(row.facts || '[]'); } catch (_) { return []; } })(),
      interactions: (() => { try { return JSON.parse(row.interactions || '[]'); } catch (_) { return []; } })(),
      context: (() => { try { return JSON.parse(row.context || '{}'); } catch (_) { return {}; } })(),
      metrics: (() => { try { return JSON.parse(row.metrics || '{}'); } catch (_) { return {}; } })()
    };

    res.json({ success: true, data: memory });
  } catch (error) {
    logger.error('Error querying memory:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

router.get('/:chatId', authenticate, async (req, res) => {
  try {
    const { chatId } = req.params;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    const memory = await db.get(`
      SELECT * FROM chat_memories WHERE chat_id = ? AND workspace_id = ?
    `, [chatId, workspaceId]);
    
    if (!memory) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Memória não encontrada'
      });
    }
    
    res.json({
      success: true,
      memory: {
        ...memory,
        facts: JSON.parse(memory.facts || '[]'),
        interactions: JSON.parse(memory.interactions || '[]'),
        context: JSON.parse(memory.context || '{}'),
        metrics: JSON.parse(memory.metrics || '{}')
      }
    });
    
  } catch (error) {
    logger.error('Error getting memory:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/memory
 * Lista todas as memórias
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { limit = 50, offset = 0, search } = req.query;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    let query = 'SELECT * FROM chat_memories WHERE workspace_id = ?';
    const params = [workspaceId];
    
    if (search) {
      // v9.3.7: search escapado contra wildcards `%`/`_` e limitado a 100 chars
      const term = makeLikeTerm(search);
      if (term) {
        query += ` AND (chat_title LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\')`;
        params.push(term, term);
      }
    }
    
    query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const memories = await db.all(query, params);
    const total = await db.get(
      'SELECT COUNT(*) as count FROM chat_memories WHERE workspace_id = ?',
      [workspaceId]
    );
    
    res.json({
      success: true,
      memories: memories.map(m => ({
        ...m,
        facts: JSON.parse(m.facts || '[]'),
        interactions: JSON.parse(m.interactions || '[]'),
        context: JSON.parse(m.context || '{}'),
        metrics: JSON.parse(m.metrics || '{}')
      })),
      total: total.count
    });
    
  } catch (error) {
    logger.error('Error listing memories:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * DELETE /api/v1/memory/:chatId
 * Deleta memória de um chat
 * FIX PEND-HIGH-002: Requer plano premium
 */
router.delete('/:chatId', authenticate, checkSubscription('memory'), async (req, res) => {
  try {
    const { chatId } = req.params;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    await db.run(`
      DELETE FROM chat_memories WHERE chat_id = ? AND workspace_id = ?
    `, [chatId, workspaceId]);
    
    res.json({
      success: true,
      message: 'Memória deletada'
    });
    
  } catch (error) {
    logger.error('Error deleting memory:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/memory/:chatId/facts
 * Adiciona fato a uma memória
 * FIX PEND-HIGH-002: Requer plano premium
 */
router.post('/:chatId/facts', authenticate, checkSubscription('memory'), async (req, res) => {
  try {
    const { chatId } = req.params;
    const { type, value, confidence } = req.body;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    const memory = await db.get(`
      SELECT * FROM chat_memories WHERE chat_id = ? AND workspace_id = ?
    `, [chatId, workspaceId]);
    
    if (!memory) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Memória não encontrada'
      });
    }
    
    const facts = JSON.parse(memory.facts || '[]');
    
    // Verifica se já existe
    const existingIndex = facts.findIndex(f => 
      f.type === type && f.value.toLowerCase() === value.toLowerCase()
    );
    
    if (existingIndex !== -1) {
      if (confidence > facts[existingIndex].confidence) {
        facts[existingIndex].confidence = confidence;
        facts[existingIndex].updatedAt = Date.now();
      }
    } else {
      facts.push({
        id: `fact_${Date.now()}`,
        type,
        value,
        confidence: confidence || 0.8,
        extractedAt: Date.now()
      });
    }
    
    await db.run(`
      UPDATE chat_memories SET facts = ?, updated_at = ? WHERE chat_id = ? AND workspace_id = ?
    `, [JSON.stringify(facts), Date.now(), chatId, workspaceId]);
    
    res.json({
      success: true,
      facts
    });
    
  } catch (error) {
    logger.error('Error adding fact:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

module.exports = router;
