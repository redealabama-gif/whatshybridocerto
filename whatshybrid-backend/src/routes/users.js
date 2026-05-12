/**
 * Users Routes
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const { body, validationResult } = require('express-validator');

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, authorize } = require('../middleware/auth');

/**
 * @route GET /api/v1/users
 * @desc Get all users in workspace
 */
router.get('/',
  authenticate,
  asyncHandler(async (req, res) => {
    const users = db.all(
      `SELECT id, email, name, avatar, role, status, created_at
       FROM users WHERE workspace_id = ?`,
      [req.workspaceId]
    );

    res.json({ users });
  })
);

/**
 * @route GET /api/v1/users/:id
 * @desc Get user by ID
 */
router.get('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = db.get(
      `SELECT id, email, name, avatar, phone, role, status, settings, created_at
       FROM users WHERE id = ? AND workspace_id = ?`,
      [req.params.id, req.workspaceId]
    );

    if (!user) {
      throw new AppError('User not found', 404);
    }

    user.settings = JSON.parse(user.settings || '{}');

    res.json({ user });
  })
);

/**
 * @route PUT /api/v1/users/:id
 * @desc Update user
 */
router.put('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    // Users can only update themselves unless admin/owner
    if (req.params.id !== req.userId && !['admin', 'owner'].includes(req.user.role)) {
      throw new AppError('Not authorized to update this user', 403);
    }

    const { name, avatar, phone, settings } = req.body;

    const updates = [];
    const values = [];

    if (name) { updates.push('name = ?'); values.push(name); }
    if (avatar) { updates.push('avatar = ?'); values.push(avatar); }
    if (phone) { updates.push('phone = ?'); values.push(phone); }
    if (settings) { updates.push('settings = ?'); values.push(JSON.stringify(settings)); }

    if (updates.length === 0) {
      throw new AppError('No fields to update', 400);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id, req.workspaceId);

    // SECURITY FIX (RISK-003): Adicionar workspace_id ao UPDATE
    db.run(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
      values
    );

    // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar user atualizado
    const user = db.get('SELECT id, email, name, avatar, phone, role, settings FROM users WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
    user.settings = JSON.parse(user.settings || '{}');

    res.json({ message: 'User updated', user });
  })
);

/**
 * @route DELETE /api/v1/users/:id
 * @desc Delete user (owner only)
 */
router.delete('/:id',
  authenticate,
  authorize('owner', 'admin'),
  asyncHandler(async (req, res) => {
    if (req.params.id === req.userId) {
      throw new AppError('Cannot delete yourself', 400);
    }

    const user = db.get(
      'SELECT id FROM users WHERE id = ? AND workspace_id = ?',
      [req.params.id, req.workspaceId]
    );

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // SECURITY FIX (RISK-003): Adicionar workspace_id ao DELETE
    db.run('DELETE FROM users WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);

    res.json({ message: 'User deleted' });
  })
);

/**
 * GET /api/v1/users/stats
 * v8.3.0 — KPIs agregados do workspace para o dashboard do cliente.
 * Conta mensagens do mês corrente, contatos, padrões aprendidos, atendentes.
 */
router.get('/stats',
  authenticate,
  asyncHandler(async (req, res) => {
    const wsId = req.workspaceId;

    // Início do mês corrente (UTC)
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Mensagens do mês — conta a partir de ai_requests (proxy razoável para uso de IA)
    let messagesThisMonth = 0;
    try {
      const r = db.get(
        `SELECT COUNT(*) AS c FROM ai_requests
         WHERE workspace_id = ? AND created_at >= ?`,
        [wsId, startOfMonth]
      );
      messagesThisMonth = r?.c || 0;
    } catch (_) {}

    // Contatos
    let contactsCount = 0;
    try {
      const r = db.get(`SELECT COUNT(*) AS c FROM contacts WHERE workspace_id = ?`, [wsId]);
      contactsCount = r?.c || 0;
    } catch (_) {}

    // Atendentes (users no workspace)
    let usersCount = 1;
    try {
      const r = db.get(`SELECT COUNT(*) AS c FROM users WHERE workspace_id = ?`, [wsId]);
      usersCount = r?.c || 1;
    } catch (_) {}

    // Padrões graduados — vem do sistema de learning
    let graduatedPatterns = 0;
    try {
      // A tabela de padrões pode ter nomes diferentes. Tenta as mais prováveis.
      const candidates = ['learning_patterns', 'ai_patterns', 'patterns'];
      for (const tbl of candidates) {
        try {
          const r = db.get(
            `SELECT COUNT(*) AS c FROM ${tbl}
             WHERE workspace_id = ? AND status = 'graduated'`,
            [wsId]
          );
          if (r) { graduatedPatterns = r.c || 0; break; }
        } catch (_) { /* tabela não existe, tenta a próxima */ }
      }
    } catch (_) {}

    // Conversas recentes (últimas 5 da IA)
    let recentActivity = [];
    try {
      recentActivity = db.all(
        `SELECT id, model, status, created_at, latency_ms
         FROM ai_requests
         WHERE workspace_id = ?
         ORDER BY created_at DESC
         LIMIT 5`,
        [wsId]
      ) || [];
    } catch (_) {}

    res.json({
      messages_this_month: messagesThisMonth,
      contacts: contactsCount,
      users_count: usersCount,
      graduated_patterns: graduatedPatterns,
      recent_activity: recentActivity,
      generated_at: new Date().toISOString(),
    });
  })
);

module.exports = router;
