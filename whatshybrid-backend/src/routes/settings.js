/**
 * Settings Routes
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const crypto = require('crypto');

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * @route GET /api/v1/settings/workspace
 * @desc Get workspace settings
 */
router.get('/workspace', authenticate, asyncHandler(async (req, res) => {
  const workspace = db.get(
    'SELECT id, name, settings, plan, created_at FROM workspaces WHERE id = ?',
    [req.workspaceId]
  );

  if (!workspace) {
    throw new AppError('Workspace not found', 404);
  }

  workspace.settings = JSON.parse(workspace.settings || '{}');

  // v9.4.6: aiKeys legacy field — sempre limpa pra não vazar nem mesmo masked.
  // Backend-Only AI desde v9.4.0; aiKeys ficou como dead field até v9.4.6.
  if (workspace.settings.aiKeys) {
    delete workspace.settings.aiKeys;
  }

  // Saldo via TokenService
  try {
    const tokenService = require('../services/TokenService');
    const balance = tokenService.getBalance(req.workspaceId);
    workspace.balance = balance?.balance || 0;
    workspace.credits = workspace.balance;  // compat de frontend antigo
  } catch (_) {
    workspace.balance = 0;
    workspace.credits = 0;
  }

  res.json({ workspace });
}));

/**
 * @route PUT /api/v1/settings/workspace
 * @desc Update workspace settings
 */
router.put('/workspace',
  authenticate,
  authorize('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { name, settings } = req.body;

    // Get current settings
    const current = db.get('SELECT settings FROM workspaces WHERE id = ?', [req.workspaceId]);
    const currentSettings = JSON.parse(current?.settings || '{}');

    // v9.4.6: aiKeys ignored — SaaS é Backend-Only AI, cliente não configura key.
    // Se vier no payload, é silenciosamente descartado.
    if (settings?.aiKeys) {
      delete settings.aiKeys;
    }

    const updates = [];
    const values = [];

    if (name) {
      updates.push('name = ?');
      values.push(name);
    }

    if (settings) {
      // Merge: novas settings sobrepõem antigas, mas aiKeys sempre é removido
      const merged = { ...currentSettings, ...settings };
      delete merged.aiKeys;
      updates.push('settings = ?');
      values.push(JSON.stringify(merged));
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(req.workspaceId);
      db.run(`UPDATE workspaces SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    const workspace = db.get('SELECT id, name, settings, plan FROM workspaces WHERE id = ?', [req.workspaceId]);
    workspace.settings = JSON.parse(workspace.settings || '{}');
    if (workspace.settings.aiKeys) delete workspace.settings.aiKeys;

    res.json({ workspace });
  })
);

/**
 * @route POST /api/v1/settings/workspace/api-key
 * @desc Generate API key for workspace
 */
router.post('/workspace/api-key',
  authenticate,
  authorize('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const apiKey = 'whl_' + crypto.randomBytes(32).toString('hex');
    
    const current = db.get('SELECT settings FROM workspaces WHERE id = ?', [req.workspaceId]);
    const settings = JSON.parse(current?.settings || '{}');
    settings.apiKey = apiKey;
    
    db.run('UPDATE workspaces SET settings = ? WHERE id = ?', [JSON.stringify(settings), req.workspaceId]);

    res.json({ apiKey });
  })
);

// v9.4.6: PUT /api/v1/settings/ai-keys REMOVIDO definitivamente.
// Endpoint era 410 Gone desde v9.4.0 — agora 404 (rota não existe).
// Backend-Only AI: api keys vivem no .env do backend.

/**
 * @route GET /api/v1/settings/user
 * @desc Get user settings
 */
router.get('/user', authenticate, asyncHandler(async (req, res) => {
  const user = db.get('SELECT settings FROM users WHERE id = ?', [req.userId]);
  const settings = JSON.parse(user?.settings || '{}');
  res.json({ settings });
}));

/**
 * @route PUT /api/v1/settings/user
 * @desc Update user settings
 */
router.put('/user', authenticate, asyncHandler(async (req, res) => {
  const { settings } = req.body;
  
  const current = db.get('SELECT settings FROM users WHERE id = ?', [req.userId]);
  const currentSettings = JSON.parse(current?.settings || '{}');
  const newSettings = { ...currentSettings, ...settings };

  db.run('UPDATE users SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
    [JSON.stringify(newSettings), req.userId]
  );

  res.json({ settings: newSettings });
}));

/**
 * @route GET /api/v1/settings/billing
 * @desc Get billing info
 *
 * v9.4.6: usa TokenService como única fonte de verdade pra saldo.
 * `workspaces.credits` (coluna legada) foi removida em favor de
 * `workspace_credits.tokens_total/tokens_used`.
 */
router.get('/billing', authenticate, asyncHandler(async (req, res) => {
  const workspace = db.get(
    'SELECT plan, settings FROM workspaces WHERE id = ?',
    [req.workspaceId]
  );

  const settings = JSON.parse(workspace?.settings || '{}');

  // Saldo via TokenService (única fonte de verdade pós-v9.4.3)
  let balance = 0;
  try {
    const tokenService = require('../services/TokenService');
    const b = tokenService.getBalance(req.workspaceId);
    balance = b?.balance || 0;
  } catch (_) {}

  res.json({
    plan: workspace?.plan || 'free',
    credits: balance,  // mantém nome `credits` na response pra compat de frontend
    balance,           // novo campo canônico
    subscription: settings.subscription || null
  });
}));

/**
 * @route POST /api/v1/settings/credits/add
 * @desc Add credits to workspace (admin only)
 *
 * v9.4.6: agora chama tokenService.credit em vez de UPDATE direto.
 * Garante audit trail (token_transactions) e consistência com idempotência.
 */
router.post('/credits/add',
  authenticate,
  authorize('admin'),
  asyncHandler(async (req, res) => {
    const { amount, workspaceId } = req.body;

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 10_000_000) {
      throw new AppError('amount inválido (1..10M)', 400);
    }

    const targetWorkspace = workspaceId || req.workspaceId;

    const tokenService = require('../services/TokenService');
    const result = tokenService.credit(targetWorkspace, amt, 'adjustment', {
      description: `Admin top-up by ${req.userId}`,
      metadata: { admin_user_id: req.userId, source: 'manual_admin_credit' },
    });

    res.json({
      credits: result.balance_after,
      balance: result.balance_after,
    });
  })
);

/**
 * @route GET /api/v1/settings/export
 * @desc Export workspace data
 */
router.get('/export',
  authenticate,
  authorize('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const contacts = db.all('SELECT * FROM contacts WHERE workspace_id = ?', [req.workspaceId]);
    const deals = db.all('SELECT * FROM deals WHERE workspace_id = ?', [req.workspaceId]);
    const tasks = db.all('SELECT * FROM tasks WHERE workspace_id = ?', [req.workspaceId]);
    const templates = db.all('SELECT * FROM templates WHERE workspace_id = ?', [req.workspaceId]);
    const labels = db.all('SELECT * FROM labels WHERE workspace_id = ?', [req.workspaceId]);
    const knowledgeBase = db.all('SELECT * FROM knowledge_base WHERE workspace_id = ?', [req.workspaceId]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      workspaceId: req.workspaceId,
      data: {
        contacts,
        deals,
        tasks,
        templates,
        labels,
        knowledgeBase
      }
    };

    res.json(exportData);
  })
);

module.exports = router;
