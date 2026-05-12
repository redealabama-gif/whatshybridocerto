/**
 * Templates Routes
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { category, status } = req.query;
  let sql = 'SELECT * FROM templates WHERE workspace_id = ?';
  const params = [req.workspaceId];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY usage_count DESC, created_at DESC';
  const templates = db.all(sql, params).map(t => ({ ...t, variables: JSON.parse(t.variables || '[]') }));
  res.json({ templates });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const template = db.get('SELECT * FROM templates WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  if (!template) throw new AppError('Template not found', 404);
  template.variables = JSON.parse(template.variables || '[]');
  res.json({ template });
}));

router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { name, category, content, variables, media_url } = req.body;
  const id = uuidv4();
  db.run(
    'INSERT INTO templates (id, workspace_id, name, category, content, variables, media_url, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, req.workspaceId, name, category, content, JSON.stringify(variables || []), media_url, req.userId]
  );
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar template criado
  const template = db.get('SELECT * FROM templates WHERE id = ? AND workspace_id = ?', [id, req.workspaceId]);
  template.variables = JSON.parse(template.variables);
  res.status(201).json({ template });
}));

router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const { name, category, content, variables, media_url, status } = req.body;
  const updates = [], values = [];
  if (name) { updates.push('name = ?'); values.push(name); }
  if (category) { updates.push('category = ?'); values.push(category); }
  if (content) { updates.push('content = ?'); values.push(content); }
  if (variables) { updates.push('variables = ?'); values.push(JSON.stringify(variables)); }
  if (media_url !== undefined) { updates.push('media_url = ?'); values.push(media_url); }
  if (status) { updates.push('status = ?'); values.push(status); }
  
  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id, req.workspaceId);
  db.run(`UPDATE templates SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`, values);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar template atualizado
  const template = db.get('SELECT * FROM templates WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ template });
}));

router.post('/:id/use', authenticate, asyncHandler(async (req, res) => {
  db.run('UPDATE templates SET usage_count = usage_count + 1 WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Template usage recorded' });
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  db.run('DELETE FROM templates WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Template deleted' });
}));

module.exports = router;
