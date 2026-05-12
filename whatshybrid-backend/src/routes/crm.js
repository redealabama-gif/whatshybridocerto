/**
 * CRM Routes (Deals & Pipeline)
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const { checkSubscription, checkLimit } = require('../middleware/subscription');

// ===== DEALS =====

router.get('/deals', authenticate, asyncHandler(async (req, res) => {
  const { stage, assigned_to, contact_id } = req.query;
  let sql = `SELECT d.*, c.name as contact_name, c.phone as contact_phone FROM deals d LEFT JOIN contacts c ON d.contact_id = c.id WHERE d.workspace_id = ?`;
  const params = [req.workspaceId];
  if (stage) { sql += ' AND d.stage = ?'; params.push(stage); }
  if (assigned_to) { sql += ' AND d.assigned_to = ?'; params.push(assigned_to); }
  if (contact_id) { sql += ' AND d.contact_id = ?'; params.push(contact_id); }
  sql += ' ORDER BY d.created_at DESC';
  const deals = db.all(sql, params).map(d => ({ ...d, tags: JSON.parse(d.tags || '[]'), custom_fields: JSON.parse(d.custom_fields || '{}') }));
  res.json({ deals });
}));

router.get('/deals/:id', authenticate, asyncHandler(async (req, res) => {
  const deal = db.get('SELECT d.*, c.name as contact_name FROM deals d LEFT JOIN contacts c ON d.contact_id = c.id WHERE d.id = ? AND d.workspace_id = ?', [req.params.id, req.workspaceId]);
  if (!deal) throw new AppError('Deal not found', 404);
  deal.tags = JSON.parse(deal.tags || '[]');
  deal.custom_fields = JSON.parse(deal.custom_fields || '{}');
  // SECURITY FIX (RISK-003): Adicionar workspace_id ao buscar tasks
  const tasks = db.all('SELECT * FROM tasks WHERE deal_id = ? AND workspace_id = ? ORDER BY due_date ASC', [deal.id, req.workspaceId]);
  res.json({ deal, tasks });
}));

router.post('/deals', authenticate, checkSubscription('deals'), checkLimit('deals'), asyncHandler(async (req, res) => {
  const { contact_id, title, description, value, stage, probability, expected_close_date, assigned_to, tags, custom_fields } = req.body;
  const id = uuidv4();
  db.run(
    `INSERT INTO deals (id, workspace_id, contact_id, title, description, value, stage, probability, expected_close_date, assigned_to, tags, custom_fields, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.workspaceId, contact_id, title, description, value || 0, stage || 'lead', probability || 0, expected_close_date, assigned_to, JSON.stringify(tags || []), JSON.stringify(custom_fields || {}), req.userId]
  );
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar deal criado
  const deal = db.get('SELECT * FROM deals WHERE id = ? AND workspace_id = ?', [id, req.workspaceId]);
  const io = req.app.get('io');
  io.to(`workspace:${req.workspaceId}`).emit('deal:created', deal);
  res.status(201).json({ deal });
}));

router.put('/deals/:id', authenticate, asyncHandler(async (req, res) => {
  const { title, description, value, stage, probability, expected_close_date, assigned_to, tags, custom_fields } = req.body;
  const updates = [], values = [];
  if (title) { updates.push('title = ?'); values.push(title); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (value !== undefined) { updates.push('value = ?'); values.push(value); }
  if (stage) { updates.push('stage = ?'); values.push(stage); }
  if (probability !== undefined) { updates.push('probability = ?'); values.push(probability); }
  if (expected_close_date) { updates.push('expected_close_date = ?'); values.push(expected_close_date); }
  if (assigned_to) { updates.push('assigned_to = ?'); values.push(assigned_to); }
  if (tags) { updates.push('tags = ?'); values.push(JSON.stringify(tags)); }
  if (custom_fields) { updates.push('custom_fields = ?'); values.push(JSON.stringify(custom_fields)); }
  
  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id, req.workspaceId);
  db.run(`UPDATE deals SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`, values);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar deal atualizado
  const deal = db.get('SELECT * FROM deals WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  const io = req.app.get('io');
  io.to(`workspace:${req.workspaceId}`).emit('deal:updated', deal);
  res.json({ deal });
}));

router.delete('/deals/:id', authenticate, asyncHandler(async (req, res) => {
  db.run('DELETE FROM deals WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Deal deleted' });
}));

// ===== PIPELINE STAGES =====

router.get('/pipeline', authenticate, asyncHandler(async (req, res) => {
  const stages = db.all('SELECT * FROM pipeline_stages WHERE workspace_id = ? ORDER BY position', [req.workspaceId]);
  res.json({ stages });
}));

router.post('/pipeline/stages', authenticate, asyncHandler(async (req, res) => {
  const { name, color, position } = req.body;
  const id = uuidv4();
  db.run('INSERT INTO pipeline_stages (id, workspace_id, name, color, position) VALUES (?, ?, ?, ?, ?)', [id, req.workspaceId, name, color, position || 0]);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar stage criado
  const stage = db.get('SELECT * FROM pipeline_stages WHERE id = ? AND workspace_id = ?', [id, req.workspaceId]);
  res.status(201).json({ stage });
}));

router.put('/pipeline/stages/:id', authenticate, asyncHandler(async (req, res) => {
  const { name, color, position } = req.body;
  const updates = [], values = [];
  if (name) { updates.push('name = ?'); values.push(name); }
  if (color) { updates.push('color = ?'); values.push(color); }
  if (position !== undefined) { updates.push('position = ?'); values.push(position); }
  
  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }

  values.push(req.params.id, req.workspaceId);
  db.run(`UPDATE pipeline_stages SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`, values);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar stage atualizado
  const stage = db.get('SELECT * FROM pipeline_stages WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ stage });
}));

router.delete('/pipeline/stages/:id', authenticate, asyncHandler(async (req, res) => {
  db.run('DELETE FROM pipeline_stages WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Stage deleted' });
}));

// ===== LABELS =====

router.get('/labels', authenticate, asyncHandler(async (req, res) => {
  const labels = db.all('SELECT * FROM labels WHERE workspace_id = ?', [req.workspaceId]);
  res.json({ labels });
}));

router.post('/labels', authenticate, asyncHandler(async (req, res) => {
  const { name, color, description } = req.body;
  const id = uuidv4();
  db.run('INSERT INTO labels (id, workspace_id, name, color, description) VALUES (?, ?, ?, ?, ?)', [id, req.workspaceId, name, color, description]);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar label criado
  const label = db.get('SELECT * FROM labels WHERE id = ? AND workspace_id = ?', [id, req.workspaceId]);
  res.status(201).json({ label });
}));

router.put('/labels/:id', authenticate, asyncHandler(async (req, res) => {
  const { name, color, description } = req.body;
  db.run('UPDATE labels SET name = COALESCE(?, name), color = COALESCE(?, color), description = COALESCE(?, description) WHERE id = ? AND workspace_id = ?', [name, color, description, req.params.id, req.workspaceId]);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar label atualizado
  const label = db.get('SELECT * FROM labels WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ label });
}));

router.delete('/labels/:id', authenticate, asyncHandler(async (req, res) => {
  db.run('DELETE FROM labels WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Label deleted' });
}));

// FIX PEND-HIGH-003: Rotas /sync e /data estão corretamente posicionadas APÓS rotas específicas
// Não há conflito aqui porque todas as rotas parametrizadas são prefixadas (/deals/:id, /labels/:id)
// e não usam catch-all top-level /:id

// ===== SYNC (para extensão) =====

/**
 * POST /api/v1/crm/sync - Sincroniza dados CRM da extensão
 * Recebe: { contacts, deals, pipeline, lastSync }
 * Retorna: dados mesclados do servidor
 */
router.post('/sync', authenticate, asyncHandler(async (req, res) => {
  const { contacts = [], deals = [], pipeline, lastSync } = req.body;
  const workspaceId = req.workspaceId;
  const userId = req.userId;

  let syncedContacts = 0;
  let syncedDeals = 0;

  // Sincronizar contatos
  for (const contact of contacts) {
    const existing = db.get(
      'SELECT id, updated_at FROM contacts WHERE id = ? AND workspace_id = ?',
      [contact.id, workspaceId]
    );

    if (!existing) {
      // Inserir novo contato
      db.run(`
        INSERT INTO contacts (id, workspace_id, phone, name, email, tags, labels, custom_fields, status, stage, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        contact.id || uuidv4(),
        workspaceId,
        contact.phone,
        contact.name || '',
        contact.email || '',
        JSON.stringify(contact.tags || []),
        JSON.stringify(contact.labels || []),
        JSON.stringify(contact.customFields || {}),
        contact.status || 'active',
        contact.stage || 'new',
        contact.createdAt || new Date().toISOString(),
        contact.updatedAt || new Date().toISOString()
      ]);
      syncedContacts++;
    } else {
      // Atualizar se mais recente
      const contactUpdated = new Date(contact.updatedAt || 0);
      const existingUpdated = new Date(existing.updated_at || 0);

      if (contactUpdated > existingUpdated) {
        db.run(`
          UPDATE contacts
          SET name = ?, email = ?, tags = ?, labels = ?, custom_fields = ?, status = ?, stage = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `, [
          contact.name,
          contact.email,
          JSON.stringify(contact.tags || []),
          JSON.stringify(contact.labels || []),
          JSON.stringify(contact.customFields || {}),
          contact.status || 'active',
          contact.stage || 'new',
          contact.updatedAt,
          contact.id,
          workspaceId
        ]);
        syncedContacts++;
      }
    }
  }

  // Sincronizar deals
  for (const deal of deals) {
    const existing = db.get(
      'SELECT id, updated_at FROM deals WHERE id = ? AND workspace_id = ?',
      [deal.id, workspaceId]
    );

    if (!existing) {
      // Inserir novo deal
      db.run(`
        INSERT INTO deals (id, workspace_id, contact_id, title, description, value, stage, probability, tags, custom_fields, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        deal.id || uuidv4(),
        workspaceId,
        deal.contactId,
        deal.title,
        deal.description || '',
        deal.value || 0,
        deal.stage || 'lead',
        deal.probability || 0,
        JSON.stringify(deal.tags || []),
        JSON.stringify(deal.customFields || {}),
        deal.createdAt || new Date().toISOString(),
        deal.updatedAt || new Date().toISOString()
      ]);
      syncedDeals++;
    } else {
      // Atualizar se mais recente
      const dealUpdated = new Date(deal.updatedAt || 0);
      const existingUpdated = new Date(existing.updated_at || 0);

      if (dealUpdated > existingUpdated) {
        db.run(`
          UPDATE deals
          SET title = ?, description = ?, value = ?, stage = ?, probability = ?, tags = ?, custom_fields = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ?
        `, [
          deal.title,
          deal.description,
          deal.value,
          deal.stage,
          deal.probability,
          JSON.stringify(deal.tags || []),
          JSON.stringify(deal.customFields || {}),
          deal.updatedAt,
          deal.id,
          workspaceId
        ]);
        syncedDeals++;
      }
    }
  }

  // Retornar dados do servidor
  // v9.3.3: normalização de nomes pra match com frontend (stageId, contactId camelCase).
  // Antes: campos vinham snake_case → frontend não achava → kanban quebrava após sync.
  const serverContacts = db.all(
    'SELECT * FROM contacts WHERE workspace_id = ? ORDER BY created_at DESC',
    [workspaceId]
  ).map(c => ({
    ...c,
    tags: JSON.parse(c.tags || '[]'),
    labels: JSON.parse(c.labels || '[]'),
    customFields: JSON.parse(c.custom_fields || '{}'),
    customFieldsRaw: c.custom_fields, // mantém pra debug
  }));

  const serverDeals = db.all(
    'SELECT * FROM deals WHERE workspace_id = ? ORDER BY created_at DESC',
    [workspaceId]
  ).map(d => ({
    ...d,
    contactId: d.contact_id,            // snake → camel
    stageId: d.stage,                   // schema column → frontend field
    tags: JSON.parse(d.tags || '[]'),
    customFields: JSON.parse(d.custom_fields || '{}'),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));

  const serverPipeline = db.all(
    'SELECT * FROM pipeline_stages WHERE workspace_id = ? ORDER BY position',
    [workspaceId]
  );

  res.json({
    success: true,
    synced: {
      contacts: syncedContacts,
      deals: syncedDeals
    },
    data: {
      contacts: serverContacts,
      deals: serverDeals,
      pipeline: serverPipeline.length > 0 ? { stages: serverPipeline } : null,
      lastSync: new Date().toISOString()
    }
  });
}));

/**
 * GET /api/v1/crm/data - Busca dados CRM do servidor
 */
router.get('/data', authenticate, asyncHandler(async (req, res) => {
  const workspaceId = req.workspaceId;

  const contacts = db.all(
    'SELECT * FROM contacts WHERE workspace_id = ? ORDER BY created_at DESC',
    [workspaceId]
  ).map(c => ({
    ...c,
    tags: JSON.parse(c.tags || '[]'),
    labels: JSON.parse(c.labels || '[]'),
    customFields: JSON.parse(c.custom_fields || '{}')
    // stage já vem como coluna direta — não precisa parse
  }));

  // v9.3.2: normaliza nomes pra match com frontend (stageId, contactId camelCase)
  const deals = db.all(
    'SELECT * FROM deals WHERE workspace_id = ? ORDER BY created_at DESC',
    [workspaceId]
  ).map(d => ({
    ...d,
    contactId: d.contact_id,
    stageId: d.stage,        // frontend espera stageId, DB tem stage
    tags: JSON.parse(d.tags || '[]'),
    customFields: JSON.parse(d.custom_fields || '{}'),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  }));

  const pipeline = db.all(
    'SELECT * FROM pipeline_stages WHERE workspace_id = ? ORDER BY position',
    [workspaceId]
  );

  res.json({
    success: true,
    data: {
      contacts,
      deals,
      pipeline: pipeline.length > 0 ? { stages: pipeline } : null,
      lastSync: new Date().toISOString()
    }
  });
}));

module.exports = router;
