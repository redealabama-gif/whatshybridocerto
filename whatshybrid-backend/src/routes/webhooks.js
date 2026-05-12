/**
 * Webhooks Routes
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const crypto = require('crypto');
const axios = require('axios');

// Middleware de verificação de assinatura (HMAC)
function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.warn('[Webhooks] WEBHOOK_SECRET não configurado');
    return next(); // Em dev, permitir mas avisar
  }

  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  try {
    const payload = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    // FIX HIGH: comparação direta com !== é vulnerável a timing attack.
    // crypto.timingSafeEqual roda em tempo constante, prevenindo descoberta
    // byte-a-byte da assinatura por análise de tempo de resposta.
    const sigBuf = Buffer.from(String(signature), 'hex');
    const expBuf = Buffer.from(expectedSignature, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
}

const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authenticate, apiKeyAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

// Generate webhook secret
function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Sign payload
function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

// IMPORTANTE:
// A verificação de assinatura deve ser aplicada APENAS aos endpoints de entrada (incoming),
// nunca aos endpoints internos (CRUD/test) que já são protegidos por authenticate/apiKeyAuth.
// Caso contrário, quando WEBHOOK_SECRET existir em produção, chamadas internas sem
// `x-webhook-signature` falhariam com 401 e quebrariam o painel/integração.

// v9.5.0 BUG #154: GET retornava `secret` em texto puro pra qualquer user autenticado
// no workspace. Secret só sai uma vez no /regenerate-secret. Aqui mascaramos
// (mostra prefixo + len pra UI poder indicar "segredo configurado").
function _redactWebhookSecret(w) {
  if (!w) return w;
  const s = w.secret;
  if (typeof s === 'string' && s.length > 0) {
    return { ...w, secret: `${s.substring(0, 4)}…${s.length}c`, has_secret: true };
  }
  return { ...w, secret: undefined, has_secret: false };
}

router.get('/', authenticate, asyncHandler(async (req, res) => {
  const webhooks = db.all('SELECT * FROM webhooks WHERE workspace_id = ?', [req.workspaceId])
    .map(w => _redactWebhookSecret({ ...w, events: JSON.parse(w.events || '[]'), headers: JSON.parse(w.headers || '{}') }));
  res.json({ webhooks });
}));

router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const webhook = db.get('SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  if (!webhook) throw new AppError('Webhook not found', 404);
  webhook.events = JSON.parse(webhook.events || '[]');
  webhook.headers = JSON.parse(webhook.headers || '{}');
  const redacted = _redactWebhookSecret(webhook);
  const logs = db.all('SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 20', [webhook.id]);
  res.json({ webhook: redacted, logs });
}));

router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { name, url, events, headers } = req.body;
  const id = uuidv4();
  const secret = generateSecret();
  db.run(
    'INSERT INTO webhooks (id, workspace_id, name, url, events, headers, secret) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, req.workspaceId, name, url, JSON.stringify(events || []), JSON.stringify(headers || {}), secret]
  );
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar webhook criado
  const webhook = db.get('SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?', [id, req.workspaceId]);
  webhook.events = JSON.parse(webhook.events);
  webhook.headers = JSON.parse(webhook.headers);
  res.status(201).json({ webhook });
}));

router.put('/:id', authenticate, asyncHandler(async (req, res) => {
  const { name, url, events, headers, status } = req.body;
  const updates = [], values = [];
  if (name) { updates.push('name = ?'); values.push(name); }
  if (url) { updates.push('url = ?'); values.push(url); }
  if (events) { updates.push('events = ?'); values.push(JSON.stringify(events)); }
  if (headers) { updates.push('headers = ?'); values.push(JSON.stringify(headers)); }
  if (status) { updates.push('status = ?'); values.push(status); }
  
  if (updates.length === 0) {
    throw new AppError('No fields to update', 400);
  }
  
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.params.id, req.workspaceId);
  db.run(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`, values);
  // SECURITY FIX (RISK-003): Validar workspace_id ao recuperar webhook atualizado
  const webhook = db.get('SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ webhook });
}));

router.post('/:id/regenerate-secret', authenticate, asyncHandler(async (req, res) => {
  const secret = generateSecret();
  db.run('UPDATE webhooks SET secret = ? WHERE id = ? AND workspace_id = ?', [secret, req.params.id, req.workspaceId]);
  res.json({ secret });
}));

router.post('/:id/test', authenticate, asyncHandler(async (req, res) => {
  const webhook = db.get('SELECT * FROM webhooks WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  if (!webhook) throw new AppError('Webhook not found', 404);

  const payload = { event: 'test', timestamp: new Date().toISOString(), data: { message: 'Test webhook' } };
  const signature = signPayload(payload, webhook.secret);
  const headers = { ...JSON.parse(webhook.headers || '{}'), 'X-Webhook-Signature': signature, 'Content-Type': 'application/json' };

  try {
    const startTime = Date.now();
    const response = await axios.post(webhook.url, payload, { headers, timeout: 10000 });
    const duration = Date.now() - startTime;
    
    db.run(
      'INSERT INTO webhook_logs (id, webhook_id, event_type, request_body, response_status, response_body, duration_ms, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), webhook.id, 'test', JSON.stringify(payload), response.status, JSON.stringify(response.data).substring(0, 1000), duration, 1]
    );
    
    res.json({ success: true, status: response.status, duration });
  } catch (error) {
    db.run(
      'INSERT INTO webhook_logs (id, webhook_id, event_type, request_body, response_status, response_body, duration_ms, success) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [uuidv4(), webhook.id, 'test', JSON.stringify(payload), error.response?.status || 0, error.message, 0, 0]
    );
    res.json({ success: false, error: error.message });
  }
}));

router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  db.run('DELETE FROM webhook_logs WHERE webhook_id = ?', [req.params.id]);
  db.run('DELETE FROM webhooks WHERE id = ? AND workspace_id = ?', [req.params.id, req.workspaceId]);
  res.json({ message: 'Webhook deleted' });
}));

// Incoming webhook endpoint (for external services)
router.post('/incoming/:workspaceId', verifyWebhookSignature, apiKeyAuth, asyncHandler(async (req, res) => {
  const { event, data } = req.body;
  
  // Log incoming webhook
  db.run(
    'INSERT INTO analytics_events (id, workspace_id, event_type, event_data) VALUES (?, ?, ?, ?)',
    [uuidv4(), req.workspaceId, `webhook:${event}`, JSON.stringify(data)]
  );
  
  // Emit to connected clients
  const io = req.app.get('io');
  io.to(`workspace:${req.workspaceId}`).emit(`webhook:${event}`, data);

  // v10.2: Fechar ciclo de aprendizado — notificar AIOrchestrator que cliente respondeu
  if (event === 'message:received' && data?.chatId && data?.body) {
    try {
      // CORREÇÃO P1: OrchestratorRegistry singleton
      const _orchReg = require('../registry/OrchestratorRegistry');
      const tenantId = req.workspaceId;
      const _orch = _orchReg.get(tenantId);
      if (_orch && _orch.onClientMessage) _orch.onClientMessage(data.chatId, data.body);
    } catch (e) { /* best-effort — não bloqueia o webhook */ }
  }
  
  res.json({ received: true });
}));

module.exports = router;
