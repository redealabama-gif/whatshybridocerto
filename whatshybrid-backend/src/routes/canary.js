/**
 * Canary (ingest) — recebe relatórios do canário agendado do WhatsApp Web.
 *
 * POST /api/v1/canary/report
 *   Header: X-Canary-Token: <CANARY_TOKEN>
 *   Body:   { status, source?, waVersion?, brokenCount?, degradedCount?, durationMs?, report? }
 *   → 201 { ok: true, id }   |  401/400/503 em erro
 *
 * Autenticado por segredo compartilhado (env CANARY_TOKEN) porque o canário
 * roda num host externo (VPS) com sessão real do WhatsApp — não tem login de
 * usuário. O painel admin lê via GET /api/v1/admin/canary (requireAdmin).
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const db = require('../utils/database');
const logger = require('../utils/logger');

const VALID_STATUS = new Set(['healthy', 'degraded', 'broken', 'error']);

function tokensMatch(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch (_) {
    return false;
  }
}

router.post('/report', (req, res) => {
  const expected = process.env.CANARY_TOKEN || '';
  if (!expected) {
    return res.status(503).json({ ok: false, error: 'CANARY_TOKEN não configurado no servidor' });
  }
  const token = req.get('X-Canary-Token') || '';
  if (!tokensMatch(token, expected)) {
    return res.status(401).json({ ok: false, error: 'token inválido' });
  }

  const b = req.body || {};
  const status = String(b.status || '').toLowerCase();
  if (!VALID_STATUS.has(status)) {
    return res.status(400).json({ ok: false, error: 'status inválido (healthy|degraded|broken|error)' });
  }

  const num = (v) => (Number.isFinite(v) ? v : Number.isFinite(Number(v)) ? Number(v) : 0);
  const id = uuidv4();
  try {
    db.run(
      `INSERT INTO canary_runs
         (id, status, source, wa_version, broken_count, degraded_count, duration_ms, report)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        status,
        String(b.source || 'whatsapp-web').slice(0, 60),
        b.waVersion ? String(b.waVersion).slice(0, 40) : null,
        num(b.brokenCount),
        num(b.degradedCount),
        b.durationMs != null ? num(b.durationMs) : null,
        b.report ? JSON.stringify(b.report).slice(0, 100000) : null,
      ]
    );
    logger.info(
      `[Canary] relatório recebido: status=${status} broken=${num(b.brokenCount)} degraded=${num(b.degradedCount)}`
    );
    res.status(201).json({ ok: true, id });
  } catch (e) {
    logger.error('[Canary] falha ao gravar relatório:', e.message);
    res.status(500).json({ ok: false, error: 'erro ao gravar relatório' });
  }
});

module.exports = router;
