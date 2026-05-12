/**
 * Contacts Routes
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const { body, query, validationResult } = require('express-validator');

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const { makeLikeTerm, safeInt } = require('../utils/sql-helpers');

/**
 * @route GET /api/v1/contacts
 * @desc Get all contacts with pagination and filters
 */
router.get('/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { search, tags, labels, status, stage } = req.query;
    // v9.3.7: validar page/limit pra evitar OFFSET enorme (DoS) e LIMIT absurdo
    const page  = safeInt(req.query.page, 1, 100000);
    const limit = safeInt(req.query.limit, 50, 200);
    const offset = (page - 1) * limit;

    let sql = `SELECT * FROM contacts WHERE workspace_id = ?`;
    const params = [req.workspaceId];

    // v9.3.7: search escapado contra wildcards `%`/`_` (DoS)
    const searchTerm = makeLikeTerm(search);
    if (searchTerm) {
      sql += ` AND (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    // v9.3.2: filtro por estágio do funil (kanban view)
    if (stage) {
      sql += ` AND stage = ?`;
      params.push(stage);
    }

    // Count total
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
    const { total } = db.get(countSql, params);

    // Get paginated results
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const contacts = db.all(sql, params).map(c => ({
      ...c,
      tags: JSON.parse(c.tags || '[]'),
      labels: JSON.parse(c.labels || '[]'),
      custom_fields: JSON.parse(c.custom_fields || '{}')
    }));

    res.json({
      contacts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  })
);

/**
 * @route GET /api/v1/contacts/:id
 * @desc Get contact by ID
 */
router.get('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const contact = db.get(
      'SELECT * FROM contacts WHERE id = ? AND workspace_id = ?',
      [req.params.id, req.workspaceId]
    );

    if (!contact) {
      throw new AppError('Contact not found', 404);
    }

    contact.tags = JSON.parse(contact.tags || '[]');
    contact.labels = JSON.parse(contact.labels || '[]');
    contact.custom_fields = JSON.parse(contact.custom_fields || '{}');

    // SECURITY FIX (RISK-003): Get conversations - adicionar workspace_id filter
    const conversations = db.all(
      'SELECT * FROM conversations WHERE contact_id = ? AND workspace_id = ? ORDER BY last_message_at DESC LIMIT 10',
      [contact.id, req.workspaceId]
    );

    // SECURITY FIX (RISK-003): Get deals - adicionar workspace_id filter
    const deals = db.all(
      'SELECT * FROM deals WHERE contact_id = ? AND workspace_id = ? ORDER BY created_at DESC',
      [contact.id, req.workspaceId]
    );

    // SECURITY FIX (RISK-003): Get tasks - adicionar workspace_id filter
    const tasks = db.all(
      'SELECT * FROM tasks WHERE contact_id = ? AND workspace_id = ? AND status != "completed" ORDER BY due_date ASC',
      [contact.id, req.workspaceId]
    );

    res.json({ contact, conversations, deals, tasks });
  })
);

/**
 * @route POST /api/v1/contacts
 * @desc Create new contact
 */
router.post('/',
  authenticate,
  [
    body('phone').notEmpty().trim()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { phone, name, email, avatar, tags, labels, custom_fields, source, stage } = req.body;

    // v9.4.2 BUG #101: validação rigorosa de tamanho/tipo
    const safePhone = String(phone).trim();
    if (safePhone.length > 30) {
      throw new AppError('phone muito longo (max 30 chars)', 400);
    }
    if (name !== undefined && name !== null) {
      if (typeof name !== 'string' || name.length > 200) {
        throw new AppError('name inválido (max 200 chars)', 400);
      }
    }
    if (email !== undefined && email !== null) {
      if (typeof email !== 'string' || email.length > 200) {
        throw new AppError('email inválido (max 200 chars)', 400);
      }
    }
    if (avatar !== undefined && avatar !== null) {
      // Avatar pode ser URL (~500 chars) ou base64 (até 200KB)
      if (typeof avatar !== 'string' || avatar.length > 200_000) {
        throw new AppError('avatar inválido (max 200KB)', 400);
      }
    }
    if (tags !== undefined && tags !== null) {
      if (!Array.isArray(tags)) throw new AppError('tags deve ser array', 400);
      if (tags.length > 50) throw new AppError('tags: máximo 50 itens', 400);
      for (const t of tags) {
        if (typeof t !== 'string' || t.length > 50) {
          throw new AppError('cada tag deve ser string até 50 chars', 400);
        }
      }
    }
    if (labels !== undefined && labels !== null) {
      if (!Array.isArray(labels)) throw new AppError('labels deve ser array', 400);
      if (labels.length > 50) throw new AppError('labels: máximo 50 itens', 400);
    }
    if (custom_fields !== undefined && custom_fields !== null) {
      if (typeof custom_fields !== 'object' || Array.isArray(custom_fields)) {
        throw new AppError('custom_fields deve ser objeto', 400);
      }
      // Cap total JSON em 10KB pra prevenir DoS
      if (JSON.stringify(custom_fields).length > 10_000) {
        throw new AppError('custom_fields muito grande (max 10KB)', 400);
      }
    }

    // Check if contact exists
    const existing = db.get(
      'SELECT id FROM contacts WHERE phone = ? AND workspace_id = ?',
      [safePhone, req.workspaceId]
    );

    if (existing) {
      throw new AppError('Contact with this phone already exists', 400, 'CONTACT_EXISTS');
    }

    const id = uuidv4();

    db.run(
      `INSERT INTO contacts (id, workspace_id, phone, name, email, avatar, tags, labels, custom_fields, source, stage)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        req.workspaceId,
        safePhone,
        name || null,
        email || null,
        avatar || null,
        JSON.stringify(tags || []),
        JSON.stringify(labels || []),
        JSON.stringify(custom_fields || {}),
        source || 'manual',
        stage || 'new'
      ]
    );

    // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar contato criado
    const contact = db.get('SELECT * FROM contacts WHERE id = ? AND workspace_id = ?', [id, req.workspaceId]);
    contact.tags = JSON.parse(contact.tags);
    contact.labels = JSON.parse(contact.labels);
    contact.custom_fields = JSON.parse(contact.custom_fields);

    // Emit event via Socket.IO
    const io = req.app.get('io');
    io.to(`workspace:${req.workspaceId}`).emit('contact:created', contact);

    res.status(201).json({ message: 'Contact created', contact });
  })
);

/**
 * @route PUT /api/v1/contacts/:id
 * @desc Update contact
 */
router.put('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const contact = db.get(
      'SELECT id FROM contacts WHERE id = ? AND workspace_id = ?',
      [req.params.id, req.workspaceId]
    );

    if (!contact) {
      throw new AppError('Contact not found', 404);
    }

    const { name, email, avatar, tags, labels, custom_fields, status, stage } = req.body;

    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }
    if (tags !== undefined) { updates.push('tags = ?'); values.push(JSON.stringify(tags)); }
    if (labels !== undefined) { updates.push('labels = ?'); values.push(JSON.stringify(labels)); }
    if (custom_fields !== undefined) { updates.push('custom_fields = ?'); values.push(JSON.stringify(custom_fields)); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    // v9.3.2: stage agora persiste — antes era ignorado e perdia trabalho do kanban
    if (stage !== undefined) { updates.push('stage = ?'); values.push(stage); }

    if (updates.length === 0) {
      throw new AppError('No fields to update', 400);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.params.id, req.workspaceId);

    // SECURITY FIX (RISK-003): Adicionar workspace_id ao UPDATE
    db.run(
      `UPDATE contacts SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
      values
    );

    // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar contato atualizado
    const updatedContact = db.get('SELECT * FROM contacts WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
    updatedContact.tags = JSON.parse(updatedContact.tags);
    updatedContact.labels = JSON.parse(updatedContact.labels);
    updatedContact.custom_fields = JSON.parse(updatedContact.custom_fields);

    // Emit event
    const io = req.app.get('io');
    io.to(`workspace:${req.workspaceId}`).emit('contact:updated', updatedContact);

    res.json({ message: 'Contact updated', contact: updatedContact });
  })
);

/**
 * @route DELETE /api/v1/contacts/:id
 * @desc Delete contact
 */
router.delete('/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const contact = db.get(
      'SELECT id FROM contacts WHERE id = ? AND workspace_id = ?',
      [req.params.id, req.workspaceId]
    );

    if (!contact) {
      throw new AppError('Contact not found', 404);
    }

    // SECURITY FIX (RISK-003): Adicionar workspace_id ao DELETE
    db.run('DELETE FROM contacts WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);

    // Emit event
    const io = req.app.get('io');
    io.to(`workspace:${req.workspaceId}`).emit('contact:deleted', { id: req.params.id });

    res.json({ message: 'Contact deleted' });
  })
);

/**
 * @route POST /api/v1/contacts/import
 * @desc Bulk import contacts
 */
router.post('/import',
  authenticate,
  asyncHandler(async (req, res) => {
    const { contacts } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      throw new AppError('Contacts array required', 400);
    }
    // v9.4.2 BUG #105: cap de 5k contatos por import. Acima disso, divida em batches.
    // Sem cap, atacante mandava 1M → loop bloqueia request por minutos, memória estoura.
    if (contacts.length > 5000) {
      throw new AppError('Máximo 5.000 contatos por import. Divida em batches.', 400);
    }

    const results = { created: 0, updated: 0, errors: [] };

    db.transaction(() => {
      for (const contact of contacts) {
        try {
          if (!contact.phone) {
            results.errors.push({ contact, error: 'Phone required' });
            continue;
          }

          const existing = db.get(
            'SELECT id FROM contacts WHERE phone = ? AND workspace_id = ?',
            [contact.phone, req.workspaceId]
          );

          if (existing) {
            // Update
            db.run(
              `UPDATE contacts SET name = COALESCE(?, name), email = COALESCE(?, email), 
               updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [contact.name, contact.email, existing.id]
            );
            results.updated++;
          } else {
            // Create
            db.run(
              `INSERT INTO contacts (id, workspace_id, phone, name, email, source)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [uuidv4(), req.workspaceId, contact.phone, contact.name, contact.email, 'import']
            );
            results.created++;
          }
        } catch (error) {
          results.errors.push({ contact, error: error.message });
        }
      }
    });

    res.json({
      message: 'Import completed',
      results
    });
  })
);

module.exports = router;
