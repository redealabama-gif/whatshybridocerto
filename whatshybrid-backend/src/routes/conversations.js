/**
 * Conversations Routes
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');

/**
 * @route GET /api/v1/conversations
 */
router.get('/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 50, status, assigned_to } = req.query;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT c.*, ct.name as contact_name, ct.phone as contact_phone, ct.avatar as contact_avatar
      FROM conversations c
      LEFT JOIN contacts ct ON c.contact_id = ct.id
      WHERE c.workspace_id = ?
    `;
    const params = [req.workspaceId];

    if (status) {
      sql += ` AND c.status = ?`;
      params.push(status);
    }

    if (assigned_to) {
      sql += ` AND c.assigned_to = ?`;
      params.push(assigned_to);
    }

    sql += ` ORDER BY c.last_message_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const conversations = db.all(sql, params).map(c => ({
      ...c,
      tags: JSON.parse(c.tags || '[]'),
      metadata: JSON.parse(c.metadata || '{}')
    }));

    res.json({ conversations });
  })
);

/**
 * @route GET /api/v1/conversations/:id
 */
router.get('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const conversation = db.get(
      `SELECT c.*, ct.name as contact_name, ct.phone as contact_phone
       FROM conversations c
       LEFT JOIN contacts ct ON c.contact_id = ct.id
       WHERE c.id = ? AND c.workspace_id = ?`,
      [req.params.id, req.workspaceId]
    );

    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    conversation.tags = JSON.parse(conversation.tags || '[]');
    conversation.metadata = JSON.parse(conversation.metadata || '{}');

    // SECURITY FIX (RISK-003): Validar messages via workspace_id da conversation
    // Get messages - já garantido por conversation.workspace_id = req.workspaceId acima
    const messages = db.all(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversation.id]
    ).map(m => ({ ...m, metadata: JSON.parse(m.metadata || '{}') }));

    res.json({ conversation, messages });
  })
);

/**
 * @route POST /api/v1/conversations/:id/messages
 */
router.post('/:id/messages',
  authenticate,
  asyncHandler(async (req, res) => {
    const { content, message_type = 'text', media_url } = req.body;

    // v9.4.2 BUG #104: validação de tamanho/tipo
    if (!content || typeof content !== 'string') {
      throw new AppError('content é obrigatório (string)', 400);
    }
    // WhatsApp limite ~4096. Cap em 10k pra acomodar formatos extensos.
    if (content.length > 10_000) {
      throw new AppError('content muito longo (max 10k chars — WhatsApp aceita 4096)', 400);
    }
    const ALLOWED_TYPES = ['text', 'image', 'audio', 'video', 'document', 'sticker', 'location'];
    if (!ALLOWED_TYPES.includes(message_type)) {
      throw new AppError(`message_type inválido (permitido: ${ALLOWED_TYPES.join(', ')})`, 400);
    }
    if (media_url !== undefined && media_url !== null) {
      if (typeof media_url !== 'string' || media_url.length > 2000) {
        throw new AppError('media_url inválido (max 2000 chars)', 400);
      }
      // Só aceita http/https/data URLs (data: pra base64 inline)
      if (!/^(https?:\/\/|data:)/.test(media_url)) {
        throw new AppError('media_url deve começar com http://, https:// ou data:', 400);
      }
    }

    const conversation = db.get(
      'SELECT id FROM conversations WHERE id = ? AND workspace_id = ?',
      [req.params.id, req.workspaceId]
    );

    if (!conversation) {
      throw new AppError('Conversation not found', 404);
    }

    const messageId = uuidv4();

    db.run(
      `INSERT INTO messages (id, conversation_id, sender_type, sender_id, content, message_type, media_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [messageId, req.params.id, 'user', req.userId, content, message_type, media_url]
    );

    // SECURITY FIX (RISK-003): Adicionar workspace_id ao UPDATE
    db.run(
      'UPDATE conversations SET last_message_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?',
      [req.params.id, req.workspaceId]
    );

    // SECURITY FIX (RISK-003): Messages pertencem a conversation já validada
    const message = db.get('SELECT * FROM messages WHERE id = ?', [messageId]);

    // Emit via Socket.IO
    const io = req.app.get('io');
    io.to(`workspace:${req.workspaceId}`).emit('message:created', message);

    res.status(201).json({ message });
  })
);

/**
 * @route PUT /api/v1/conversations/:id
 */
router.put('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const { status, assigned_to, tags } = req.body;

    const updates = [];
    const values = [];

    if (status) { updates.push('status = ?'); values.push(status); }
    if (assigned_to) { updates.push('assigned_to = ?'); values.push(assigned_to); }
    if (tags) { updates.push('tags = ?'); values.push(JSON.stringify(tags)); }

    if (updates.length === 0) {
      throw new AppError('No fields to update', 400);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id, req.workspaceId);

    db.run(
      `UPDATE conversations SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
      values
    );

    // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar conversation atualizada
    const conversation = db.get('SELECT * FROM conversations WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);

    res.json({ conversation });
  })
);

module.exports = router;
