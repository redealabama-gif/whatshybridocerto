/**
 * Coupons (public) — Fase 1 da cobrança real
 *
 * Endpoint público para o frontend (signup.html) confirmar se um cupom
 * é válido antes de submeter o formulário. Não persiste nada; só faz
 * lookup + preview de desconto.
 *
 * Protegido com authLimiter (mesmo da rota /auth) pra evitar
 * enumeração de códigos por brute-force.
 *
 * GET  /api/v1/coupons/validate/:code?plan=starter&amount=49.90
 *   → 200 { valid: true, code, label, discount, finalAmount, kind, firstInvoiceOnly }
 *   → 200 { valid: false, reason: 'not_found' | 'expired' | 'inactive'
 *           | 'depleted' | 'plan_not_eligible' | 'invalid_format' }
 *
 * Nunca retorna 4xx pra cupom inválido — sempre 200 + valid:false. Isso
 * simplifica o frontend (não precisa de try/catch) e dificulta scraping.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const router = express.Router();

const { authLimiter } = require('../middleware/rateLimiter');
const db = require('../utils/database');
const logger = require('../utils/logger');
const couponService = require('../services/CouponService');
const mpModule = require('../services/MercadoPagoService');

// Limiter dedicado à captura de lead (mais brando que o authLimiter, mas
// segura spam). 30 req / 10 min por IP — uma pessoa preenche 1x.
const leadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
});
// MercadoPagoService exporta instância como default; PLAN_PRICES vem
// anexado ao módulo (não desestrutura, pra evitar valor cached errado).

// PLAN_PRICES é a fonte canônica de preços (em MercadoPagoService).
// Se algo der errado no require, cai num fallback alinhado com a landing.
const FALLBACK_PRICES = { starter: 49.90, pro: 99.90 };

function priceFor(plan) {
  const planPrices = mpModule.PLAN_PRICES || {};
  if (typeof planPrices[plan] === 'number') return planPrices[plan];
  return FALLBACK_PRICES[plan];
}

router.get('/validate/:code', authLimiter, (req, res) => {
  const { code } = req.params;
  const plan = (req.query.plan || 'starter').toLowerCase();
  const explicitAmount = req.query.amount ? Number(req.query.amount) : null;

  // Plano free não tem o que descontar
  if (plan === 'free') {
    return res.json({ valid: false, reason: 'plan_not_eligible' });
  }

  const baseAmount = explicitAmount && Number.isFinite(explicitAmount) && explicitAmount > 0
    ? explicitAmount
    : priceFor(plan);

  if (!baseAmount) {
    return res.json({ valid: false, reason: 'plan_not_eligible' });
  }

  const result = couponService.previewDiscount(code, plan, baseAmount);
  if (!result.valid) {
    return res.json({ valid: false, reason: result.reason });
  }

  res.json({
    valid: true,
    code: result.code,
    label: result.label,
    kind: result.kind,
    firstInvoiceOnly: result.firstInvoiceOnly,
    plan,
    originalAmount: result.originalAmount,
    discountAmount: result.discountAmount,
    finalAmount: result.finalAmount,
  });
});

/**
 * POST /api/v1/coupons/lead
 *
 * Captura o lead do modal de cupom (exit-intent) da landing: nome, e-mail e
 * telefone (WhatsApp). Público — o visitante não está autenticado. Chamado
 * via navigator.sendBeacon no submit do modal (não bloqueia o redirect).
 *
 * Body: { name, email, phone, coupon?, source? }
 * → 200 { success: true }  |  400 { success:false, error }
 */
router.post('/lead', leadLimiter, (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim();
  const coupon = req.body?.coupon ? String(req.body.coupon).trim().toUpperCase().slice(0, 40) : null;
  const source = req.body?.source ? String(req.body.source).trim().slice(0, 60) : 'exit-modal';

  const nameOk = name.length >= 2 && name.length <= 120;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 160;
  const phoneDigits = phone.replace(/\D/g, '');
  const phoneOk = phoneDigits.length >= 10 && phoneDigits.length <= 15;

  if (!nameOk || !emailOk || !phoneOk) {
    return res.status(400).json({ success: false, error: 'Nome, e-mail e telefone válidos são obrigatórios' });
  }

  try {
    const id = `lead_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    db.run(
      `INSERT INTO coupon_leads (id, name, email, phone, coupon, source, referrer, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name.slice(0, 120),
        email,
        phone.slice(0, 40),
        coupon,
        source,
        String(req.headers.referer || '').slice(0, 300),
        String(req.headers['user-agent'] || '').slice(0, 300),
        req.ip,
      ]
    );
    logger.info(`[Coupons] Lead capturado: ${email} (${coupon || 'sem cupom'})`);
    res.json({ success: true });
  } catch (err) {
    logger.error('[Coupons] Falha ao salvar lead:', err.message);
    res.status(500).json({ success: false, error: 'Erro ao salvar lead' });
  }
});

module.exports = router;
