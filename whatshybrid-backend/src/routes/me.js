/**
 * User Self-Service — v9.0.0
 *
 * Endpoints que cumprem direitos LGPD + coleta de NPS.
 *
 * LGPD (Lei 13.709/2018, art. 18):
 *   - Direito de acesso: GET /me/export    → ZIP com todos os dados
 *   - Direito de exclusão: POST /me/delete → anonymiza dados
 *   - Direito de correção: já existem endpoints de PUT
 *   - Direito de portabilidade: o /export gera JSON estruturado
 *
 * NPS:
 *   - POST /me/nps   → registra score 0-10 + comentário
 *   - GET /me/nps    → ver últimas respostas
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const { body, validationResult } = require('express-validator');

const db = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

/**
 * POST /me/nps
 */
router.post('/nps',
  authenticate,
  [
    body('score').isInt({ min: 0, max: 10 }),
    body('comment').optional().isString().isLength({ max: 2000 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError('Score inválido (0-10)', 400);

    db.run(
      `INSERT INTO nps_responses (id, workspace_id, user_id, score, comment) VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), req.workspaceId, req.userId, req.body.score, req.body.comment || null]
    );

    logger.info(`[NPS] User ${req.userId} score=${req.body.score}`);
    res.json({ ok: true, message: 'Obrigado pelo feedback!' });
  })
);

/**
 * GET /me/nps — últimas 10 respostas do usuário
 */
router.get('/nps', authenticate, asyncHandler(async (req, res) => {
  const responses = db.all(
    `SELECT id, score, comment, created_at FROM nps_responses
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`,
    [req.userId]
  );
  res.json({ responses });
}));

/**
 * GET /me/export — direito LGPD de portabilidade
 * Retorna JSON com todos os dados do usuário e seu workspace
 */
router.get('/export', authenticate, asyncHandler(async (req, res) => {
  const userId = req.userId;
  const workspaceId = req.workspaceId;

  const data = {
    exported_at: new Date().toISOString(),
    user: db.get(
      `SELECT id, email, name, role, status, created_at, preferred_language FROM users WHERE id = ?`,
      [userId]
    ),
    workspace: db.get(
      `SELECT id, name, plan, subscription_status, created_at FROM workspaces WHERE id = ?`,
      [workspaceId]
    ),
    contacts: db.all(`SELECT * FROM contacts WHERE workspace_id = ?`, [workspaceId]),
    conversations: db.all(`SELECT * FROM conversations WHERE workspace_id = ?`, [workspaceId]),
    deals: db.all(`SELECT * FROM deals WHERE workspace_id = ?`, [workspaceId]),
    campaigns: db.all(`SELECT * FROM campaigns WHERE workspace_id = ?`, [workspaceId]),
    tasks: db.all(`SELECT * FROM tasks WHERE workspace_id = ?`, [workspaceId]),
    billing_invoices: db.all(`SELECT * FROM billing_invoices WHERE workspace_id = ?`, [workspaceId]),
    token_transactions: db.all(`SELECT * FROM token_transactions WHERE workspace_id = ? LIMIT 1000`, [workspaceId]),
    referrals: db.all(`SELECT * FROM referrals WHERE referrer_user_id = ?`, [userId]),
    nps_responses: db.all(`SELECT * FROM nps_responses WHERE user_id = ?`, [userId]),
  };

  // Sanitiza campos sensíveis
  if (data.user) delete data.user.password;
  if (data.user) delete data.user.totp_secret;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="whatshybrid-data-${userId.substring(0,8)}.json"`);
  res.json(data);

  logger.info(`[LGPD:Export] User ${userId} exported data`);
}));

/**
 * POST /me/delete-account — direito LGPD de exclusão
 * Anonymiza dados em vez de DELETE (mantém logs por obrigação legal)
 */
router.post('/delete-account',
  authenticate,
  [body('confirmation').equals('EXCLUIR_MINHA_CONTA')],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError(
        'Confirmação inválida. Envie {"confirmation": "EXCLUIR_MINHA_CONTA"} para confirmar.',
        400
      );
    }

    const userId = req.userId;
    const workspaceId = req.workspaceId;

    // Cria log de exclusão
    const deletionId = uuidv4();
    db.run(
      `INSERT INTO data_deletion_log (id, user_id, workspace_id, reason, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [deletionId, userId, workspaceId, req.body.reason || null]
    );

    try {
      db.transaction(() => {
        // Anonymiza usuário (mantém ID pra integridade referencial)
        db.run(
          `UPDATE users SET
             email = ?,
             name = 'Usuário Excluído',
             password = '',
             totp_secret = NULL,
             totp_enabled = 0,
             status = 'deleted'
           WHERE id = ?`,
          [`deleted_${userId.substring(0,8)}@deleted.local`, userId]
        );

        // Workspace: cancela subscription
        db.run(
          `UPDATE workspaces SET
             subscription_status = 'cancelled',
             auto_renew_enabled = 0,
             name = 'Workspace Excluído'
           WHERE id = ?`,
          [workspaceId]
        );

        // Anonymiza contatos e conversações (PII)
        db.run(`UPDATE contacts SET name = 'anônimo', phone = '' WHERE workspace_id = ?`, [workspaceId]);
        db.run(`UPDATE conversations SET metadata = '{}' WHERE workspace_id = ?`, [workspaceId]);

        // Revoga refresh tokens
        db.run(`DELETE FROM refresh_tokens WHERE user_id = ?`, [userId]);

        // Marca log como completo
        db.run(
          `UPDATE data_deletion_log SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [deletionId]
        );
      });
    } catch (err) {
      db.run(`UPDATE data_deletion_log SET status = 'failed' WHERE id = ?`, [deletionId]);
      throw err;
    }

    logger.warn(`[LGPD:Delete] User ${userId} deleted account (deletion_id=${deletionId})`);

    res.json({
      ok: true,
      message: 'Sua conta foi excluída e seus dados anonimizados.',
      deletion_id: deletionId,
      retention_note: 'Logs de auditoria são mantidos por 12 meses por obrigação legal. Faturas por 5 anos (Receita Federal).',
    });
  })
);

/**
 * POST /me/onboarding-complete
 */
router.post('/onboarding-complete', authenticate, asyncHandler(async (req, res) => {
  db.run(`UPDATE users SET onboarding_completed = 1 WHERE id = ?`, [req.userId]);
  res.json({ ok: true });
}));

/**
 * GET /me/onboarding-status
 */
router.get('/onboarding-status', authenticate, asyncHandler(async (req, res) => {
  const u = db.get(`SELECT onboarding_completed FROM users WHERE id = ?`, [req.userId]);
  res.json({ completed: !!u?.onboarding_completed });
}));

module.exports = router;
