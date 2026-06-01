/**
 * Leads (público) — captura do modal de saída da landing.
 *
 * POST /api/v1/leads  { name, phone, email, coupon?, source?, attribution? }
 *   → 201 { ok: true }            (também responde ok em falha de insert)
 *   → 400 { error: 'invalid_lead' } (campos obrigatórios ausentes/ inválidos)
 *
 * O frontend (public/index.html) dispara isto fire-and-forget no submit do
 * modal "Quero meu desconto", ANTES de redirecionar pro signup — assim o
 * contato (nome + WhatsApp + e-mail) é capturado mesmo se a pessoa não
 * concluir o cadastro. Best-effort: nunca quebra o fluxo do usuário.
 *
 * Protegido com authLimiter (mesmo das rotas /auth) pra evitar flood.
 */

const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const db = require('../utils/database');
const logger = require('../utils/logger');
const { authLimiter } = require('../middleware/rateLimiter');

router.post('/',
  authLimiter,
  [
    body('name').trim().isLength({ min: 2, max: 120 }),
    body('phone').trim().isLength({ min: 8, max: 30 }),
    body('email').isEmail().normalizeEmail(),
    body('coupon').optional({ nullable: true }).isString().isLength({ max: 32 }),
    body('source').optional({ nullable: true }).isString().isLength({ max: 60 }),
    body('attribution').optional({ nullable: true }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'invalid_lead' });
    }

    const { name, phone, email, coupon, source, attribution } = req.body;

    try {
      db.run(
        `INSERT INTO leads (id, name, phone, email, coupon_code, source, attribution, ip, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          name,
          phone,
          email,
          coupon || null,
          source || 'exit_modal',
          attribution ? JSON.stringify(attribution) : null,
          req.ip || null,
          (req.get('user-agent') || '').slice(0, 300) || null,
        ]
      );
      logger.info(`[Leads] captured ${email} (source=${source || 'exit_modal'}, coupon=${coupon || '-'})`);
    } catch (e) {
      logger.warn('[Leads] insert failed:', e.message);
      // captura é best-effort — não falha pro usuário
    }

    res.status(201).json({ ok: true });
  }
);

module.exports = router;
