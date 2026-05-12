/**
 * Campaigns Routes
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const { checkSubscription, checkLimit } = require('../middleware/subscription');

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const campaigns = db.all(
    `SELECT * FROM campaigns WHERE workspace_id = ? ORDER BY created_at DESC`,
    [req.workspaceId]
  ).map(c => ({ ...c, target_contacts: JSON.parse(c.target_contacts || '[]'), settings: JSON.parse(c.settings || '{}') }));
  res.json({ campaigns });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const campaign = db.get('SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  if (!campaign) throw new AppError('Campaign not found', 404);
  campaign.target_contacts = JSON.parse(campaign.target_contacts || '[]');
  campaign.settings = JSON.parse(campaign.settings || '{}');
  res.json({ campaign });
}));

router.post('/', authenticate, checkSubscription('campaigns'), checkLimit('campaigns'), asyncHandler(async (req, res) => {
  const { name, description, type, template_id, target_contacts, settings, scheduled_at } = req.body;

  // Validação mínima (padronizada via AppError + details)
  if (!name || typeof name !== 'string' || !name.trim()) {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'name', message: 'name é obrigatório' }];
    throw e;
  }
  // v9.4.0 BUG #88: limite de 200 chars pra name
  if (name.length > 200) {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'name', message: 'name muito longo (max 200 chars)' }];
    throw e;
  }
  // v9.4.0 BUG #88: limite de 2000 chars pra description
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string') {
      const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      e.details = [{ field: 'description', message: 'description deve ser string' }];
      throw e;
    }
    if (description.length > 2000) {
      const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      e.details = [{ field: 'description', message: 'description muito longa (max 2000 chars)' }];
      throw e;
    }
  }
  if (target_contacts !== undefined && target_contacts !== null && !Array.isArray(target_contacts)) {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'target_contacts', message: 'target_contacts deve ser um array' }];
    throw e;
  }
  // v9.4.0 BUG #87: limite de 50k contatos por campanha. Acima disso, criar várias.
  // 50k contatos × 100 bytes/contato ≈ 5MB JSON — limite saudável pra SQLite TEXT.
  if (Array.isArray(target_contacts) && target_contacts.length > 50000) {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'target_contacts', message: 'Máximo 50.000 contatos por campanha. Divida em múltiplas.' }];
    throw e;
  }
  if (settings !== undefined && settings !== null && typeof settings !== 'object') {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'settings', message: 'settings deve ser um objeto' }];
    throw e;
  }
  // v9.4.0: limita total do payload settings (~500KB) — message + image_url + variáveis
  const settingsJson = JSON.stringify(settings || {});
  if (settingsJson.length > 500_000) {
    const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
    e.details = [{ field: 'settings', message: 'settings muito grande (max 500KB)' }];
    throw e;
  }

  const id = uuidv4();
  db.run(
    `INSERT INTO campaigns (id, workspace_id, name, description, type, template_id, target_contacts, settings, scheduled_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.workspaceId, name, description, type || 'broadcast', template_id, JSON.stringify(target_contacts || []), JSON.stringify(settings || {}), scheduled_at, req.userId]
  );
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar campaign criada
  const campaign = db.get('SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?', [id, req.workspaceId]);
  const io = req.app.get('io');
  io.to(`workspace:${req.workspaceId}`).emit('campaign:created', campaign);
  res.status(201).json({ campaign });
}));

router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const { status, sent_count, delivered_count, read_count, failed_count } = req.body;

  // v9.4.0 BUG #89: valida que counters são inteiros não-negativos.
  // Antes: cliente mandava sent_count: 999999999 e backend aceitava — métricas falsas.
  // Cap em 1M (limite de target_contacts × 20x margem) impede inflação maliciosa.
  const validateCount = (value, field) => {
    if (value === undefined) return;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
      const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      e.details = [{ field, message: `${field} deve ser inteiro entre 0 e 1.000.000` }];
      throw e;
    }
  };
  validateCount(sent_count, 'sent_count');
  validateCount(delivered_count, 'delivered_count');
  validateCount(read_count, 'read_count');
  validateCount(failed_count, 'failed_count');

  // v9.4.0: status deve ser whitelist
  if (status !== undefined) {
    const ALLOWED_STATUS = ['draft', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled'];
    if (!ALLOWED_STATUS.includes(status)) {
      const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      e.details = [{ field: 'status', message: `status deve ser um de: ${ALLOWED_STATUS.join(', ')}` }];
      throw e;
    }
  }

  const updates = [], values = [];
  if (status) {
    updates.push('status = ?');
    values.push(status);
    if (status === 'running') updates.push('started_at = CURRENT_TIMESTAMP');
    if (status === 'completed') updates.push('completed_at = CURRENT_TIMESTAMP');
  }
  if (sent_count !== undefined) { updates.push('sent_count = ?'); values.push(Number(sent_count)); }
  if (delivered_count !== undefined) { updates.push('delivered_count = ?'); values.push(Number(delivered_count)); }
  if (read_count !== undefined) { updates.push('read_count = ?'); values.push(Number(read_count)); }
  if (failed_count !== undefined) { updates.push('failed_count = ?'); values.push(Number(failed_count)); }
  
  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id, req.workspaceId);
  db.run(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`, values);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar campaign atualizada
  const campaign = db.get('SELECT * FROM campaigns WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  const io = req.app.get('io');
  io.to(`workspace:${req.workspaceId}`).emit('campaign:updated', campaign);
  res.json({ campaign });
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  db.run('DELETE FROM campaigns WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Campaign deleted' });
}));

module.exports = router;
