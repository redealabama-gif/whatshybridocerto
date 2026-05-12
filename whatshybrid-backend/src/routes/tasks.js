/**
 * Tasks Routes
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
// v9.4.2: helpers de validação de tamanho de input
const { safeString, safeEnum } = require('../utils/sql-helpers');

const TASK_TYPES = ['todo', 'call', 'meeting', 'email', 'whatsapp', 'note'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { status, priority, assigned_to, contact_id, deal_id, due_before } = req.query;
  let sql = 'SELECT t.*, c.name as contact_name FROM tasks t LEFT JOIN contacts c ON t.contact_id = c.id WHERE t.workspace_id = ?';
  const params = [req.workspaceId];
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (priority) { sql += ' AND t.priority = ?'; params.push(priority); }
  if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(assigned_to); }
  if (contact_id) { sql += ' AND t.contact_id = ?'; params.push(contact_id); }
  if (deal_id) { sql += ' AND t.deal_id = ?'; params.push(deal_id); }
  if (due_before) { sql += ' AND t.due_date <= ?'; params.push(due_before); }
  sql += ' ORDER BY t.due_date ASC NULLS LAST, t.priority DESC';
  const tasks = db.all(sql, params);
  res.json({ tasks });
}));

router.get('/overdue', authenticate, asyncHandler(async (req, res) => {
  const tasks = db.all(
    `SELECT t.*, c.name as contact_name FROM tasks t
     LEFT JOIN contacts c ON t.contact_id = c.id
     WHERE t.workspace_id = ? AND t.status != 'completed' AND t.due_date < datetime('now')
     ORDER BY t.due_date ASC`,
    [req.workspaceId]
  );
  res.json({ tasks });
}));

// FIX PEND-HIGH-003: Mover rotas /data e /sync ANTES de /:id para evitar conflito de roteamento
// ===== SYNC (para extensão) =====

/**
 * POST /api/v1/tasks/sync - Sincroniza tasks da extensão
 */
router.post('/sync', authenticate, asyncHandler(async (req, res) => {
  const { tasks: clientTasks = [] } = req.body;
  const workspaceId = req.workspaceId;
  const userId = req.userId;

  let syncedTasks = 0;

  // Sincronizar tasks
  for (const task of clientTasks) {
    const existing = db.get(
      'SELECT id, updated_at FROM tasks WHERE id = ? AND workspace_id = ?',
      [task.id, workspaceId]
    );

    if (!existing) {
      // Inserir nova task
      db.run(`
        INSERT INTO tasks (id, workspace_id, title, description, type, priority, status, contact_id, due_date, created_at, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        task.id || uuidv4(),
        workspaceId,
        task.title,
        task.description || '',
        task.type || 'other',
        task.priority || 'medium',
        task.status || 'pending',
        task.contactId || null,
        task.dueDate || null,
        task.createdAt || new Date().toISOString(),
        task.updatedAt || new Date().toISOString(),
        task.completedAt || null
      ]);
      syncedTasks++;
    } else {
      // Atualizar se mais recente
      const taskUpdated = new Date(task.updatedAt || 0);
      const existingUpdated = new Date(existing.updated_at || 0);

      if (taskUpdated > existingUpdated) {
        db.run(`
          UPDATE tasks
          SET title = ?, description = ?, type = ?, priority = ?, status = ?, due_date = ?, updated_at = ?, completed_at = ?
          WHERE id = ? AND workspace_id = ?
        `, [
          task.title,
          task.description,
          task.type,
          task.priority,
          task.status,
          task.dueDate,
          task.updatedAt,
          task.completedAt,
          task.id,
          workspaceId
        ]);
        syncedTasks++;
      }
    }
  }

  // Retornar tasks do servidor
  // v9.3.3: normalização de nomes pra match com frontend (dueDate, contactId, etc.)
  // Antes: snake_case ia direto e quebrava UI ao mostrar tasks após sync.
  const serverTasks = db.all(
    'SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at DESC',
    [workspaceId]
  ).map(t => ({
    ...t,
    contactId: t.contact_id,
    dealId: t.deal_id,
    assignedTo: t.assigned_to,
    dueDate: t.due_date,
    completedAt: t.completed_at,
    createdBy: t.created_by,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));

  res.json({
    success: true,
    synced: syncedTasks,
    data: {
      tasks: serverTasks,
      lastSync: new Date().toISOString()
    }
  });
}));

/**
 * GET /api/v1/tasks/data - Busca tasks do servidor
 */
router.get('/data', authenticate, asyncHandler(async (req, res) => {
  const workspaceId = req.workspaceId;

  const tasks = db.all(
    'SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at DESC',
    [workspaceId]
  );

  res.json({
    success: true,
    data: {
      tasks,
      lastSync: new Date().toISOString()
    }
  });
}));

// Rotas parametrizadas DEVEM vir DEPOIS de rotas específicas
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const task = db.get('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  if (!task) throw new AppError('Task not found', 404);
  res.json({ task });
}));

router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { title, description, type, priority, due_date, contact_id, deal_id, assigned_to } = req.body;

  // v9.4.2 BUG #100: validação rigorosa pra prevenir DoS via campos gigantes
  const safeTitle = safeString(title, { field: 'title', max: 500, required: true });
  const safeDescription = safeString(description, { field: 'description', max: 5000 });
  const safeType = safeEnum(type, TASK_TYPES, 'todo');
  const safePriority = safeEnum(priority, TASK_PRIORITIES, 'medium');
  // due_date: aceita ISO string até 50 chars
  const safeDueDate = safeString(due_date, { field: 'due_date', max: 50 });

  const id = uuidv4();
  db.run(
    `INSERT INTO tasks (id, workspace_id, title, description, type, priority, due_date, contact_id, deal_id, assigned_to, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.workspaceId, safeTitle, safeDescription, safeType, safePriority, safeDueDate, contact_id, deal_id, assigned_to || req.userId, req.userId]
  );
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar task criada
  const task = db.get('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?', [id, req.workspaceId]);
  const io = req.app.get('io');
  io.to(`workspace:${req.workspaceId}`).emit('task:created', task);
  res.status(201).json({ task });
}));

router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const { title, description, type, priority, status, due_date, assigned_to } = req.body;
  const updates = [], values = [];

  // v9.4.2 BUG #100: validação rigorosa em PUT também
  if (title !== undefined) {
    const safeTitle = safeString(title, { field: 'title', max: 500, required: true });
    updates.push('title = ?'); values.push(safeTitle);
  }
  if (description !== undefined) {
    const safeDescription = safeString(description, { field: 'description', max: 5000 });
    updates.push('description = ?'); values.push(safeDescription);
  }
  if (type !== undefined) {
    const safeType = safeEnum(type, TASK_TYPES, null);
    if (safeType) { updates.push('type = ?'); values.push(safeType); }
  }
  if (priority !== undefined) {
    const safePriority = safeEnum(priority, TASK_PRIORITIES, null);
    if (safePriority) { updates.push('priority = ?'); values.push(safePriority); }
  }
  if (status !== undefined) {
    const safeStatus = safeEnum(status, TASK_STATUSES, null);
    if (safeStatus) {
      updates.push('status = ?'); values.push(safeStatus);
      if (safeStatus === 'completed') updates.push('completed_at = CURRENT_TIMESTAMP');
    }
  }
  if (due_date !== undefined) {
    const safeDueDate = safeString(due_date, { field: 'due_date', max: 50 });
    updates.push('due_date = ?'); values.push(safeDueDate);
  }
  if (assigned_to !== undefined) {
    updates.push('assigned_to = ?'); values.push(assigned_to);
  }
  
  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id, req.workspaceId);
  db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`, values);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar task atualizada
  const task = db.get('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  const io = req.app.get('io');
  io.to(`workspace:${req.workspaceId}`).emit('task:updated', task);
  res.json({ task });
}));

router.post('/:id/complete', authenticate, asyncHandler(async (req, res) => {
  db.run('UPDATE tasks SET status = "completed", completed_at = CURRENT_TIMESTAMP WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar task completada
  const task = db.get('SELECT * FROM tasks WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  const io = req.app.get('io');
  io.to(`workspace:${req.workspaceId}`).emit('task:completed', task);
  res.json({ task });
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  db.run('DELETE FROM tasks WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Task deleted' });
}));

module.exports = router;
