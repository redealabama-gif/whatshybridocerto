/**
 * Training Routes — v9.7.x
 *
 * Endpoint que a extensão (training/training.html) chama no botão "Sincronizar".
 * Antes este endpoint NÃO EXISTIA: a UI mostrava "Sincronizado com sucesso!"
 * mas o backend retornava 404 silenciosamente (front mostrava sucesso só
 * porque a chamada não throw — só verificava `response?.success`).
 *
 * O que precisamos persistir:
 *  - examples     → tabela `training_examples` (poucas centenas / workspace)
 *  - faqs         → tabela `faqs`
 *  - products     → tabela `products`
 *  - businessInfo → tabela `workspace_knowledge` (JSON blob `business`)
 *
 * Estratégia de sync: full-replace por workspace. Cliente sempre envia o
 * estado completo (training.js mantém arrays em memória), então DELETE+INSERT
 * dentro de transação é mais simples que diff e evita drift entre cliente e
 * servidor. Como o volume é baixo (< 5k registros), custo é desprezível.
 *
 * Depois do sync, o AIOrchestrator lê essas tabelas em cada processMessage()
 * e injeta no prompt como knowledge — fechando o loop entre treinamento e
 * inteligência (caminho principal /api/v2/ai/process).
 */

const express = require('express');
const router = express.Router();

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');
const logger = require('../utils/logger');
const { v4: uuid } = require('../utils/uuid-wrapper');

router.use(authenticate);

/**
 * POST /api/v1/training/sync
 * Body: { examples?: [...], faqs?: [...], products?: [...], businessInfo?: {...} }
 * Cada campo é opcional — só substitui o que vier no payload.
 */
router.post('/sync',
  authorize('owner', 'admin', 'agent'),
  asyncHandler(async (req, res) => {
    const { examples, faqs, products, businessInfo } = req.body || {};
    const workspaceId = req.workspaceId;
    const userId = req.userId;

    if (!workspaceId) throw new AppError('workspace missing', 401);

    const stats = { examples: 0, faqs: 0, products: 0, businessInfo: false };
    const errors = [];

    // ── examples → training_examples ──────────────────────────────
    if (Array.isArray(examples)) {
      try {
        db.run('DELETE FROM training_examples WHERE workspace_id = ?', [workspaceId]);
        for (const ex of examples) {
          if (!ex || typeof ex !== 'object') continue;
          const input  = (ex.input  || ex.user     || '').toString().slice(0, 5000);
          const output = (ex.output || ex.response || '').toString().slice(0, 5000);
          if (!input || !output) continue;

          db.run(
            `INSERT INTO training_examples
               (id, workspace_id, user_id, input, output, context, category, tags, usage_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
              uuid(), workspaceId, userId,
              input, output,
              (ex.intent || '').toString().slice(0, 200),
              (ex.category || 'geral').toString().slice(0, 100),
              JSON.stringify(Array.isArray(ex.tags) ? ex.tags.slice(0, 20) : []),
              Number.isFinite(ex.usageCount) ? ex.usageCount : 0,
            ]
          );
          stats.examples++;
        }
      } catch (e) {
        errors.push(`examples: ${e.message}`);
        logger.warn(`[training/sync] examples failed: ${e.message}`);
      }
    }

    // ── faqs → faqs ────────────────────────────────────────────────
    if (Array.isArray(faqs)) {
      try {
        db.run('DELETE FROM faqs WHERE workspace_id = ?', [workspaceId]);
        for (const f of faqs) {
          if (!f || typeof f !== 'object') continue;
          const question = (f.question || '').toString().slice(0, 1000);
          const answer   = (f.answer   || '').toString().slice(0, 5000);
          if (!question || !answer) continue;

          db.run(
            `INSERT INTO faqs
               (id, workspace_id, question, answer, category, keywords, is_active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
              uuid(), workspaceId,
              question, answer,
              (f.category || 'general').toString().slice(0, 100),
              JSON.stringify(Array.isArray(f.keywords) ? f.keywords.slice(0, 30) : []),
            ]
          );
          stats.faqs++;
        }
      } catch (e) {
        errors.push(`faqs: ${e.message}`);
        logger.warn(`[training/sync] faqs failed: ${e.message}`);
      }
    }

    // ── products → products ────────────────────────────────────────
    if (Array.isArray(products)) {
      try {
        db.run('DELETE FROM products WHERE workspace_id = ?', [workspaceId]);
        for (const p of products) {
          if (!p || typeof p !== 'object') continue;
          const name = (p.name || '').toString().slice(0, 300);
          if (!name) continue;

          db.run(
            `INSERT INTO products
               (id, workspace_id, name, description, short_description, sku, category,
                price, price_original, currency, stock_status, tags, is_active,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [
              uuid(), workspaceId,
              name,
              (p.description || '').toString().slice(0, 5000),
              (p.shortDescription || p.short_description || '').toString().slice(0, 500),
              (p.sku || '').toString().slice(0, 100),
              (p.category || '').toString().slice(0, 200),
              Number.isFinite(p.price) ? p.price : (Number.isFinite(p.promoPrice) ? p.promoPrice : 0),
              Number.isFinite(p.price) ? p.price : null,
              (p.currency || 'BRL').toString().slice(0, 10),
              (p.availability || p.stock_status || 'available').toString().slice(0, 50),
              JSON.stringify(Array.isArray(p.tags) ? p.tags.slice(0, 30) : []),
            ]
          );
          stats.products++;
        }
      } catch (e) {
        errors.push(`products: ${e.message}`);
        logger.warn(`[training/sync] products failed: ${e.message}`);
      }
    }

    // ── businessInfo → workspace_knowledge (JSON blob) ─────────────
    // Guardamos como JSON pra preservar a estrutura aninhada (paymentMethods
    // como array, customInstructions como string longa, etc) sem precisar
    // de schema rígido. Orchestrator depois lê e formata pro prompt.
    if (businessInfo && typeof businessInfo === 'object') {
      try {
        const now = Date.now();
        const safe = JSON.stringify(businessInfo).slice(0, 50000); // cap defensivo

        const existing = db.get(
          'SELECT id, version FROM workspace_knowledge WHERE workspace_id = ?',
          [workspaceId]
        );

        if (existing) {
          db.run(
            `UPDATE workspace_knowledge
                SET data = ?, version = ?, updated_at = ?
              WHERE workspace_id = ?`,
            [safe, (existing.version || 1) + 1, now, workspaceId]
          );
        } else {
          db.run(
            `INSERT INTO workspace_knowledge
               (id, workspace_id, data, version, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, ?)`,
            [uuid(), workspaceId, safe, now, now]
          );
        }
        stats.businessInfo = true;
      } catch (e) {
        errors.push(`businessInfo: ${e.message}`);
        logger.warn(`[training/sync] businessInfo failed: ${e.message}`);
      }
    }

    logger.info(`[training/sync] workspace=${workspaceId} examples=${stats.examples} faqs=${stats.faqs} products=${stats.products} business=${stats.businessInfo}`);

    res.json({
      success: errors.length === 0,
      synced: stats,
      errors: errors.length ? errors : undefined,
    });
  })
);

/**
 * GET /api/v1/training/sync
 * Devolve o estado atual do treinamento — útil pro cliente fazer pull e
 * reconciliar com o estado local (multi-device).
 */
router.get('/sync',
  asyncHandler(async (req, res) => {
    const workspaceId = req.workspaceId;

    const examples = db.all(
      `SELECT id, input, output, context as intent, category, tags, usage_count
         FROM training_examples
        WHERE workspace_id = ?
        ORDER BY updated_at DESC
        LIMIT 1000`,
      [workspaceId]
    ) || [];

    const faqs = db.all(
      `SELECT id, question, answer, category, keywords
         FROM faqs
        WHERE workspace_id = ? AND is_active = 1
        ORDER BY updated_at DESC
        LIMIT 500`,
      [workspaceId]
    ) || [];

    const products = db.all(
      `SELECT id, name, description, short_description, sku, category, price, currency,
              stock_status, tags
         FROM products
        WHERE workspace_id = ? AND is_active = 1
        ORDER BY updated_at DESC
        LIMIT 500`,
      [workspaceId]
    ) || [];

    let businessInfo = {};
    try {
      const wk = db.get('SELECT data FROM workspace_knowledge WHERE workspace_id = ?', [workspaceId]);
      if (wk?.data) businessInfo = JSON.parse(wk.data);
    } catch (_) {}

    // Reidrata tags/keywords (gravados como JSON)
    const safeParse = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
    examples.forEach(e => { e.tags = safeParse(e.tags); });
    faqs.forEach(f => { f.keywords = safeParse(f.keywords); });
    products.forEach(p => { p.tags = safeParse(p.tags); });

    res.json({
      examples,
      faqs,
      products,
      businessInfo,
    });
  })
);

module.exports = router;
