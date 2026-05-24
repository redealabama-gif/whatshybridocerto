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
const router = express.Router();

const { authLimiter } = require('../middleware/rateLimiter');
const couponService = require('../services/CouponService');
const mpModule = require('../services/MercadoPagoService');
// MercadoPagoService exporta instância como default; PLAN_PRICES vem
// anexado ao módulo (não desestrutura, pra evitar valor cached errado).

// PLAN_PRICES é a fonte canônica de preços (em MercadoPagoService).
// Se algo der errado no require, cai num fallback alinhado com a landing.
const FALLBACK_PRICES = { starter: 49.90, pro: 99.90, agency: 199.90 };

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

module.exports = router;
