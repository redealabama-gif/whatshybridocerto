/**
 * Knowledge Routes - API para Knowledge Management
 */

const express = require('express');
const router = express.Router();
const { authenticate, apiKeyAuth } = require('../middleware/auth');
const { makeLikeTerm } = require('../utils/sql-helpers');
const database = require('../utils/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/v1/knowledge/sync
 * Sincroniza conhecimento completo
 */
router.post('/sync', authenticate, async (req, res) => {
  try {
    const { action, knowledge } = req.body;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    if (action === 'sync') {
      // Busca conhecimento existente
      const existing = await db.get(`
        SELECT * FROM workspace_knowledge WHERE workspace_id = ?
      `, [workspaceId]);
      
      if (existing) {
        // Merge inteligente
        const existingData = JSON.parse(existing.data || '{}');
        const mergedData = mergeKnowledge(existingData, knowledge);
        
        await db.run(`
          UPDATE workspace_knowledge SET
            data = ?,
            version = version + 1,
            updated_at = ?
          WHERE workspace_id = ?
        `, [JSON.stringify(mergedData), Date.now(), workspaceId]);
        
        res.json({
          success: true,
          knowledge: mergedData,
          merged: true
        });
      } else {
        // Cria novo
        await db.run(`
          INSERT INTO workspace_knowledge (id, workspace_id, data, version, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?)
        `, [uuidv4(), workspaceId, JSON.stringify(knowledge), Date.now(), Date.now()]);
        
        res.json({
          success: true,
          knowledge,
          created: true
        });
      }
    } else {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Action inválida'
      });
    }
    
  } catch (error) {
    logger.error('Error syncing knowledge:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }

});

/**
 * GET /api/v1/knowledge/sync
 * Retorna conhecimento completo (alias para clients que chamam /sync)
 */
router.get('/sync', authenticate, async (req, res) => {
  try {
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;

    const row = await db.get(`
      SELECT * FROM workspace_knowledge WHERE workspace_id = ?
    `, [workspaceId]);

    if (!row) {
      return res.json({ success: true, data: null, version: 0 });
    }

    let data = null;
    try {
      data = row.data ? JSON.parse(row.data) : null;
    } catch (_) {
      data = null;
    }

    res.json({ success: true, data, version: row.version || 0, updatedAt: row.updated_at || row.updatedAt || null });
  } catch (error) {
    logger.error('Error getting knowledge sync:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

/**
 * GET /api/v1/knowledge
 * Obtém conhecimento completo
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    const knowledge = await db.get(`
      SELECT * FROM workspace_knowledge WHERE workspace_id = ?
    `, [workspaceId]);
    
    if (!knowledge) {
      return res.json({
        success: true,
        knowledge: null
      });
    }
    
    res.json({
      success: true,
      knowledge: JSON.parse(knowledge.data || '{}'),
      version: knowledge.version,
      updatedAt: knowledge.updated_at
    });
    
  } catch (error) {
    logger.error('Error getting knowledge:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PRODUTOS
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/knowledge/products
 */
router.get('/products', authenticate, async (req, res) => {
  try {
    const { search, category, limit = 50 } = req.query;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    let query = 'SELECT * FROM products WHERE workspace_id = ?';
    const params = [workspaceId];
    
    if (search) {
      // v9.3.7: makeLikeTerm escapa `%`/`_` e valida tamanho
      const term = makeLikeTerm(search);
      if (term) {
        query += ` AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR sku LIKE ? ESCAPE '\\')`;
        params.push(term, term, term);
      }
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY name ASC LIMIT ?';
    params.push(parseInt(limit));
    
    const products = await db.all(query, params);
    
    res.json({
      success: true,
      products: products.map(p => ({
        ...p,
        specifications: JSON.parse(p.specifications || '{}'),
        tags: JSON.parse(p.tags || '[]'),
        variants: JSON.parse(p.variants || '[]')
      }))
    });
    
  } catch (error) {
    logger.error('Error listing products:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/knowledge/products
 */
router.post('/products', authenticate, async (req, res) => {
  try {
    const productData = req.body;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;

    // v9.4.2: validação rigorosa
    if (!productData.name || typeof productData.name !== 'string' || productData.name.length > 300) {
      return res.status(400).json({ error: 'name obrigatório (max 300 chars)' });
    }
    const validateOptStr = (v, field, max) => {
      if (v === undefined || v === null || v === '') return true;
      if (typeof v !== 'string' || v.length > max) {
        res.status(400).json({ error: `${field} inválido (max ${max} chars)` });
        return false;
      }
      return true;
    };
    if (!validateOptStr(productData.description, 'description', 5000)) return;
    if (!validateOptStr(productData.shortDescription, 'shortDescription', 500)) return;
    if (!validateOptStr(productData.sku, 'sku', 100)) return;
    if (!validateOptStr(productData.category, 'category', 100)) return;
    if (!validateOptStr(productData.currency, 'currency', 10)) return;

    // Caps em arrays/objetos JSON
    if (productData.specifications && typeof productData.specifications === 'object') {
      if (JSON.stringify(productData.specifications).length > 10_000) {
        return res.status(400).json({ error: 'specifications muito grande (max 10KB)' });
      }
    }
    if (Array.isArray(productData.tags) && productData.tags.length > 50) {
      return res.status(400).json({ error: 'tags: máximo 50 itens' });
    }
    if (Array.isArray(productData.variants) && productData.variants.length > 100) {
      return res.status(400).json({ error: 'variants: máximo 100 itens' });
    }
    // Valida price/stock numéricos
    if (productData.price !== undefined && (!Number.isFinite(Number(productData.price)) || Number(productData.price) < 0)) {
      return res.status(400).json({ error: 'price deve ser número não-negativo' });
    }
    if (productData.stock !== undefined && productData.stock !== null
        && (!Number.isInteger(Number(productData.stock)) || Number(productData.stock) < 0)) {
      return res.status(400).json({ error: 'stock deve ser inteiro não-negativo' });
    }

    const id = uuidv4();
    
    await db.run(`
      INSERT INTO products (
        id, workspace_id, name, description, short_description, sku,
        category, price, price_original, currency, stock, stock_status,
        specifications, tags, variants, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      workspaceId,
      productData.name,
      productData.description || '',
      productData.shortDescription || '',
      productData.sku || '',
      productData.category || '',
      productData.price || 0,
      productData.priceOriginal || null,
      productData.currency || 'BRL',
      productData.stock ?? null,
      productData.stockStatus || 'available',
      JSON.stringify(productData.specifications || {}),
      JSON.stringify(productData.tags || []),
      JSON.stringify(productData.variants || []),
      productData.isActive !== false ? 1 : 0,
      Date.now(),
      Date.now()
    ]);
    
    res.status(201).json({
      success: true,
      product: { id, ...productData }
    });
    
  } catch (error) {
    logger.error('Error creating product:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FAQs
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/knowledge/faqs
 */
router.get('/faqs', authenticate, async (req, res) => {
  try {
    const { search, category, limit = 50 } = req.query;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    let query = 'SELECT * FROM faqs WHERE workspace_id = ?';
    const params = [workspaceId];
    
    if (search) {
      // v9.3.7: makeLikeTerm
      const term = makeLikeTerm(search);
      if (term) {
        query += ` AND (question LIKE ? ESCAPE '\\' OR answer LIKE ? ESCAPE '\\')`;
        params.push(term, term);
      }
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY views DESC, created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const faqs = await db.all(query, params);
    
    res.json({
      success: true,
      faqs: faqs.map(f => ({
        ...f,
        keywords: JSON.parse(f.keywords || '[]')
      }))
    });
    
  } catch (error) {
    logger.error('Error listing FAQs:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/knowledge/faqs
 */
router.post('/faqs', authenticate, async (req, res) => {
  try {
    const faqData = req.body;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;

    // v9.4.2 BUG #102: validação rigorosa.
    // FAQs vão pra prompt do autopilot — sem limite, cliente cria FAQ de 9MB e
    // a cada chamada IA, o prompt fica gigante → custo OpenAI multiplicado.
    if (!faqData.question || typeof faqData.question !== 'string') {
      return res.status(400).json({ error: 'question é obrigatório (string)' });
    }
    if (faqData.question.length > 500) {
      return res.status(400).json({ error: 'question muito longa (max 500 chars)' });
    }
    if (!faqData.answer || typeof faqData.answer !== 'string') {
      return res.status(400).json({ error: 'answer é obrigatório (string)' });
    }
    if (faqData.answer.length > 5000) {
      return res.status(400).json({ error: 'answer muito longa (max 5000 chars)' });
    }
    if (faqData.category !== undefined) {
      if (typeof faqData.category !== 'string' || faqData.category.length > 100) {
        return res.status(400).json({ error: 'category inválida (max 100 chars)' });
      }
    }
    if (faqData.keywords !== undefined && faqData.keywords !== null) {
      if (!Array.isArray(faqData.keywords)) {
        return res.status(400).json({ error: 'keywords deve ser array' });
      }
      if (faqData.keywords.length > 30) {
        return res.status(400).json({ error: 'keywords: máximo 30 itens' });
      }
      for (const k of faqData.keywords) {
        if (typeof k !== 'string' || k.length > 100) {
          return res.status(400).json({ error: 'cada keyword deve ser string até 100 chars' });
        }
      }
    }

    const id = uuidv4();
    
    // Auto-extrai keywords
    let keywords = faqData.keywords || [];
    if (keywords.length === 0) {
      keywords = extractKeywords(faqData.question + ' ' + faqData.answer);
    }
    
    await db.run(`
      INSERT INTO faqs (
        id, workspace_id, question, answer, category, keywords,
        views, helpful, not_helpful, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
    `, [
      id,
      workspaceId,
      faqData.question,
      faqData.answer,
      faqData.category || 'general',
      JSON.stringify(keywords),
      faqData.isActive !== false ? 1 : 0,
      Date.now(),
      Date.now()
    ]);
    
    res.status(201).json({
      success: true,
      faq: { id, ...faqData, keywords }
    });
    
  } catch (error) {
    logger.error('Error creating FAQ:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/knowledge/faqs/search
 * Busca FAQs relevantes para uma query
 */
router.post('/faqs/search', authenticate, async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
    const db = database;
    
    // Busca todas as FAQs ativas
    const faqs = await db.all(`
      SELECT * FROM faqs WHERE workspace_id = ? AND is_active = 1
    `, [workspaceId]);
    
    // Ranking por relevância
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    
    const scored = faqs.map(faq => {
      let score = 0;
      const keywords = JSON.parse(faq.keywords || '[]');
      
      // Match exato na pergunta
      if (faq.question.toLowerCase().includes(queryLower)) {
        score += 10;
      }
      
      // Match em keywords
      keywords.forEach(kw => {
        if (queryLower.includes(kw.toLowerCase())) {
          score += 5;
        }
      });
      
      // Match parcial
      queryWords.forEach(word => {
        if (word.length > 2) {
          if (faq.question.toLowerCase().includes(word)) score += 2;
          if (faq.answer.toLowerCase().includes(word)) score += 1;
        }
      });
      
      return { ...faq, score, keywords };
    }).filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    // SECURITY FIX (RISK-003): Incrementa views com validação de workspace_id
    for (const faq of scored) {
      await db.run('UPDATE faqs SET views = views + 1 WHERE id = ? AND workspace_id = ?', [faq.id, workspaceId]);
    }
    
    res.json({
      success: true,
      faqs: scored
    });
    
  } catch (error) {
    logger.error('Error searching FAQs:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════

/**
 * POST /api/v1/knowledge/search — v9.3.3
 *
 * Busca semântica genérica que combina FAQs, produtos e workspace_knowledge.
 * Antes essa rota não existia — extensão (request-batcher.js, rag-local.js)
 * chamava aqui e batia 404.
 *
 * Body: { query: string, limit?: number, types?: string[] }
 *   types: ['faqs', 'products', 'workspace'] — default todos
 */
router.post('/search', authenticate, async (req, res) => {
  try {
    const { query, limit = 5, types = ['faqs', 'products', 'workspace'] } = req.body;
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }

    const workspaceId = req.workspaceId || req.user?.workspace_id;
    if (!workspaceId) {
      return res.status(401).json({ error: 'workspace_id missing in session' });
    }

    const db = database;
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    const results = [];

    // ─── FAQs ─────────────────────────────────────────────────────────
    if (types.includes('faqs')) {
      try {
        const faqs = await db.all(
          `SELECT * FROM faqs WHERE workspace_id = ? AND is_active = 1`,
          [workspaceId]
        );
        for (const faq of faqs || []) {
          let score = 0;
          if (faq.question?.toLowerCase().includes(queryLower)) score += 10;
          for (const word of queryWords) {
            if (faq.question?.toLowerCase().includes(word)) score += 2;
            if (faq.answer?.toLowerCase().includes(word)) score += 1;
          }
          if (score > 0) {
            results.push({
              type: 'faq',
              id: faq.id,
              title: faq.question,
              content: faq.answer,
              score,
            });
          }
        }
      } catch (e) {
        logger.warn('[knowledge/search] FAQs query failed:', e.message);
      }
    }

    // ─── Products ─────────────────────────────────────────────────────
    if (types.includes('products')) {
      try {
        const products = await db.all(
          `SELECT * FROM products WHERE workspace_id = ?`,
          [workspaceId]
        );
        for (const p of products || []) {
          let score = 0;
          if (p.name?.toLowerCase().includes(queryLower)) score += 10;
          if (p.description?.toLowerCase().includes(queryLower)) score += 5;
          for (const word of queryWords) {
            if (p.name?.toLowerCase().includes(word)) score += 2;
            if (p.description?.toLowerCase().includes(word)) score += 1;
          }
          if (score > 0) {
            results.push({
              type: 'product',
              id: p.id,
              title: p.name,
              content: p.description,
              price: p.price,
              score,
            });
          }
        }
      } catch (e) {
        logger.warn('[knowledge/search] Products query failed:', e.message);
      }
    }

    // ─── Workspace knowledge (texto livre) ────────────────────────────
    if (types.includes('workspace')) {
      try {
        const wsk = await db.get(
          `SELECT data FROM workspace_knowledge WHERE workspace_id = ?`,
          [workspaceId]
        );
        if (wsk?.data) {
          const parsed = JSON.parse(wsk.data);
          // Se tem campo `entries` ou similar, busca neles
          const entries = Array.isArray(parsed) ? parsed
                       : Array.isArray(parsed?.entries) ? parsed.entries
                       : [];
          for (const entry of entries) {
            const text = `${entry.title || ''} ${entry.content || entry.text || ''}`.toLowerCase();
            let score = 0;
            if (text.includes(queryLower)) score += 8;
            for (const word of queryWords) {
              if (text.includes(word)) score += 1;
            }
            if (score > 0) {
              results.push({
                type: 'workspace',
                id: entry.id || null,
                title: entry.title || '(sem título)',
                content: entry.content || entry.text || '',
                score,
              });
            }
          }
        }
      } catch (e) {
        logger.warn('[knowledge/search] Workspace knowledge query failed:', e.message);
      }
    }

    // Ordena por score e retorna top N
    results.sort((a, b) => b.score - a.score);
    res.json({
      success: true,
      query,
      total: results.length,
      results: results.slice(0, limit),
    });

  } catch (error) {
    logger.error('[knowledge/search] Error:', error);
    res.status(500).json({ error: 'Internal Server Error', message: error.message });
  }
});

function mergeKnowledge(existing, incoming) {
  // Deep merge com preferência para dados mais recentes
  const result = { ...existing };
  
  for (const key in incoming) {
    if (Array.isArray(incoming[key])) {
      // Merge de arrays (produtos, FAQs, etc.)
      result[key] = mergeArrays(existing[key] || [], incoming[key]);
    } else if (typeof incoming[key] === 'object' && incoming[key] !== null) {
      // Merge recursivo de objetos
      result[key] = mergeKnowledge(existing[key] || {}, incoming[key]);
    } else {
      // Valor simples - usa o incoming
      result[key] = incoming[key];
    }
  }
  
  return result;
}

function mergeArrays(existing, incoming) {
  const map = new Map();
  
  // Adiciona existentes
  existing.forEach(item => {
    if (item.id) {
      map.set(item.id, item);
    }
  });
  
  // Sobrescreve/adiciona incoming
  incoming.forEach(item => {
    if (item.id) {
      map.set(item.id, item);
    }
  });
  
  return Array.from(map.values());
}

function extractKeywords(text) {
  const stopWords = ['de', 'da', 'do', 'em', 'para', 'com', 'por', 'uma', 'um', 'os', 'as', 'que', 'é', 'o', 'a', 'e'];
  const words = text.toLowerCase()
    .replace(/[^\w\sáéíóúâêîôûãõç]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w));
  
  return [...new Set(words)].slice(0, 10);
}

module.exports = router;
