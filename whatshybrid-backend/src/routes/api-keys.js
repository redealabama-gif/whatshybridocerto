/**
 * API Keys Routes - v8.3.0
 * 
 * Permite que clientes criem chaves de API para integrações próprias.
 * Chaves são geradas, hasheadas (SHA-256) e armazenadas só com o hash.
 * O cliente vê a chave completa UMA VEZ, no momento da criação.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * Gera uma API key no formato: whp_live_<32 chars>
 * Retorna { plain, hash, preview }
 */
function generateApiKey() {
  const random = crypto.randomBytes(24).toString('base64url');
  const plain = `whp_live_${random}`;
  const hash = crypto.createHash('sha256').update(plain).digest('hex');
  // Preview: whp_live_xxxx...xxxx (mostra início e fim)
  const preview = `${plain.slice(0, 12)}...${plain.slice(-4)}`;
  return { plain, hash, preview };
}

router.use(authenticate);

/**
 * GET /api/v1/users/api-keys
 * Lista todas as chaves do workspace (sem o hash, só preview)
 */
router.get('/', asyncHandler(async (req, res) => {
  const keys = db.all(
    `SELECT id, name, key_preview, last_used_at, revoked_at, created_at
     FROM api_keys
     WHERE workspace_id = ?
     ORDER BY created_at DESC`,
    [req.workspaceId]
  );

  res.json({
    keys: keys.map(k => ({
      ...k,
      revoked: !!k.revoked_at,
    })),
  });
}));

/**
 * POST /api/v1/users/api-keys
 * Cria uma nova chave de API. Retorna a chave em texto plano UMA ÚNICA VEZ.
 */
router.post('/', asyncHandler(async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    throw new AppError('Nome da chave precisa ter pelo menos 2 caracteres', 400);
  }
  if (name.length > 100) {
    throw new AppError('Nome muito longo (máx 100 chars)', 400);
  }

  // Limita a 10 chaves ativas por workspace
  const activeCount = db.get(
    `SELECT COUNT(*) as c FROM api_keys WHERE workspace_id = ? AND revoked_at IS NULL`,
    [req.workspaceId]
  ).c;

  if (activeCount >= 10) {
    throw new AppError('Limite de 10 chaves ativas atingido. Revogue alguma para criar nova.', 400);
  }

  const { plain, hash, preview } = generateApiKey();
  const id = uuidv4();

  db.run(
    `INSERT INTO api_keys (id, workspace_id, user_id, name, key_hash, key_preview)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, req.workspaceId, req.userId, name.trim(), hash, preview]
  );

  logger.info(`[ApiKeys] Created '${name}' for workspace ${req.workspaceId}`);

  res.status(201).json({
    id,
    name: name.trim(),
    key: plain,        // <- ÚNICA vez que aparece em texto plano
    api_key: plain,    // alias para frontends antigos
    key_preview: preview,
    created_at: new Date().toISOString(),
    warning: 'Guarde essa chave agora — você não verá novamente.',
  });
}));

/**
 * DELETE /api/v1/users/api-keys/:id
 * Revoga uma chave (marca como revogada, não deleta — preserva auditoria)
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const key = db.get(
    `SELECT id, revoked_at FROM api_keys WHERE id = ? AND workspace_id = ?`,
    [req.params.id, req.workspaceId]
  );

  if (!key) {
    throw new AppError('Chave não encontrada', 404);
  }
  if (key.revoked_at) {
    throw new AppError('Chave já revogada', 400);
  }

  db.run(
    `UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [req.params.id]
  );

  logger.info(`[ApiKeys] Revoked ${req.params.id} in workspace ${req.workspaceId}`);

  res.json({ success: true, revoked_at: new Date().toISOString() });
}));

/**
 * Helper exportado: valida uma chave de API recebida (use em middlewares).
 * Retorna { workspace_id, user_id } ou null.
 */
function validateApiKey(plainKey) {
  if (!plainKey || typeof plainKey !== 'string') return null;
  if (!plainKey.startsWith('whp_')) return null;

  const hash = crypto.createHash('sha256').update(plainKey).digest('hex');
  const row = db.get(
    `SELECT workspace_id, user_id FROM api_keys
     WHERE key_hash = ? AND revoked_at IS NULL`,
    [hash]
  );

  if (row) {
    // Atualiza last_used_at de forma assíncrona, não bloqueia
    setImmediate(() => {
      try {
        db.run(`UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ?`, [hash]);
      } catch (_) {}
    });
  }

  return row || null;
}

module.exports = router;
module.exports.validateApiKey = validateApiKey;
