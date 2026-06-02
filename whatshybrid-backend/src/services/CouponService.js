// @ts-check
/**
 * CouponService — Fase 1 da cobrança real
 *
 * Sistema de cupons promocionais para descontos no signup e renovação.
 * Suporta cupons de % ou valor fixo, com escopo de planos, validade
 * temporal, limite de redenções e flag de "só primeira fatura".
 *
 * Fluxo principal:
 *   1. validate(code, plan)         → checa se cupom existe/está ativo
 *   2. previewDiscount(code, plan, amount) → calcula desconto sem aplicar
 *   3. applyToWorkspace(code, ws)   → marca o cupom no workspace (pending)
 *   4. recordRedemption(...)        → registra o uso real e incrementa
 *                                      o counter da tabela coupons
 *
 * Erros não são lançados em validate/previewDiscount — retornamos
 * { valid: false, reason: '...' } pra caller não precisar try/catch.
 * Erros de banco/inesperados sim são logados e lançados (vão pro
 * errorHandler global).
 */

const db = require('../utils/database');
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const logger = require('../utils/logger');

// Regex para sanity check do código: maiúsculas, dígitos, opcionalmente
// hífens. Rejeita injeção e mantém formato consistente.
const COUPON_CODE_REGEX = /^[A-Z0-9_-]{3,32}$/;

function normalizeCode(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim().toUpperCase();
  if (!COUPON_CODE_REGEX.test(trimmed)) return null;
  return trimmed;
}

function planAllowed(coupon, plan) {
  if (!coupon.applies_to_plans) return true; // null = todos
  const allowed = coupon.applies_to_plans
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(String(plan).toLowerCase());
}

function isWithinValidity(coupon) {
  const now = new Date();
  if (coupon.valid_from && new Date(coupon.valid_from) > now) return false;
  if (coupon.valid_until && new Date(coupon.valid_until) < now) return false;
  return true;
}

function hasRedemptionsLeft(coupon) {
  if (coupon.max_redemptions == null) return true; // ilimitado
  return Number(coupon.redeemed_count || 0) < Number(coupon.max_redemptions);
}

/**
 * @typedef {Object} ValidateSuccess
 * @property {true} valid
 * @property {any}  coupon
 *
 * @typedef {Object} ValidateFailure
 * @property {false}  valid
 * @property {string} reason
 *
 * @typedef {ValidateSuccess | ValidateFailure} ValidateResult
 */

/**
 * Valida um cupom para um plano específico. NÃO aplica nada.
 *
 * @param {string} rawCode  - código bruto (ex.: 'exit50' ou ' EXIT50 ')
 * @param {string} plan     - 'starter', 'pro', 'free'
 * @returns {ValidateResult}
 */
function validate(rawCode, plan) {
  const code = normalizeCode(rawCode);
  if (!code) return { valid: false, reason: 'invalid_format' };

  let coupon;
  try {
    coupon = db.get('SELECT * FROM coupons WHERE code = ?', [code]);
  } catch (err) {
    logger.error('[Coupon] DB error on validate:', err.message);
    return { valid: false, reason: 'db_error' };
  }

  if (!coupon) return { valid: false, reason: 'not_found' };
  if (!coupon.active) return { valid: false, reason: 'inactive' };
  if (!isWithinValidity(coupon)) return { valid: false, reason: 'expired' };
  if (!hasRedemptionsLeft(coupon)) return { valid: false, reason: 'depleted' };
  if (!planAllowed(coupon, plan)) return { valid: false, reason: 'plan_not_eligible' };

  return { valid: true, coupon };
}

/**
 * @typedef {Object} PreviewSuccess
 * @property {true}   valid
 * @property {string} code
 * @property {string} kind
 * @property {string} label
 * @property {number} originalAmount
 * @property {number} discountAmount
 * @property {number} finalAmount
 * @property {boolean} firstInvoiceOnly
 *
 * @typedef {Object} PreviewFailure
 * @property {false}  valid
 * @property {string} reason
 *
 * @typedef {PreviewSuccess | PreviewFailure} PreviewResult
 */

/**
 * Calcula o desconto que um cupom aplicaria sobre um valor. Não muda
 * nada no banco. Útil pro frontend mostrar "R$ 49,90 → R$ 24,95".
 *
 * @param {string} rawCode
 * @param {string} plan
 * @param {number} amount
 * @returns {PreviewResult}
 */
function previewDiscount(rawCode, plan, amount) {
  const v = validate(rawCode, plan);
  if (v.valid === false) return v;

  const c = v.coupon;
  const original = Number(amount);
  if (!Number.isFinite(original) || original <= 0) {
    return { valid: false, reason: 'invalid_amount' };
  }

  let discount;
  if (c.kind === 'percent') {
    // value é fração: 0.5 = 50%
    discount = original * Number(c.value);
  } else if (c.kind === 'fixed') {
    // value é R$ a abater
    discount = Math.min(Number(c.value), original);
  } else {
    return { valid: false, reason: 'unknown_kind' };
  }

  // Arredonda pra 2 casas (cents)
  discount = Math.round(discount * 100) / 100;
  const final = Math.max(0, Math.round((original - discount) * 100) / 100);

  return {
    valid: true,
    code: c.code,
    kind: c.kind,
    label: c.description || c.code,
    originalAmount: original,
    discountAmount: discount,
    finalAmount: final,
    firstInvoiceOnly: !!c.first_invoice_only,
  };
}

/**
 * Marca um cupom como pendente no workspace (chamado no signup).
 * Não conta como redenção ainda — o counter da tabela coupons só
 * sobe quando recordRedemption é chamado (no momento da fatura).
 *
 * Lança AppError-like se o cupom for inválido.
 */
function applyToWorkspace(rawCode, workspaceId, plan) {
  const v = validate(rawCode, plan);
  if (v.valid === false) {
    const err = /** @type {Error & { code: string, reason: string }} */ (
      new Error(`Cupom inválido: ${v.reason}`)
    );
    err.code = 'INVALID_COUPON';
    err.reason = v.reason;
    throw err;
  }

  try {
    db.run(
      `UPDATE workspaces
         SET coupon_code = ?,
             coupon_applied_at = CURRENT_TIMESTAMP,
             coupon_first_invoice_used_at = NULL
       WHERE id = ?`,
      [v.coupon.code, workspaceId]
    );
    logger.info(`[Coupon] ${v.coupon.code} pending on workspace ${workspaceId} (plan=${plan})`);
    return { code: v.coupon.code, label: v.coupon.description || v.coupon.code };
  } catch (err) {
    logger.error('[Coupon] Failed to attach to workspace:', err.message);
    throw err;
  }
}

/**
 * Retorna o cupom pendente do workspace (ainda não consumido na 1ª
 * invoice). Usado pelo billing.js para aplicar desconto antes de
 * chamar o gateway.
 *
 * Retorna null se: sem cupom, cupom já usado, cupom virou inválido
 * desde o signup (expirou/foi desativado/depleted).
 */
function getPendingCouponForWorkspace(workspaceId, plan) {
  const ws = db.get(
    `SELECT coupon_code, coupon_first_invoice_used_at
       FROM workspaces WHERE id = ?`,
    [workspaceId]
  );
  if (!ws || !ws.coupon_code) return null;
  if (ws.coupon_first_invoice_used_at) return null; // já consumido

  const v = validate(ws.coupon_code, plan);
  if (v.valid === false) {
    logger.info(
      `[Coupon] Pending ${ws.coupon_code} no longer valid for ws=${workspaceId} ` +
      `(reason=${v.reason}); will not apply.`
    );
    return null;
  }
  return v.coupon;
}

/**
 * Registra a aplicação efetiva do cupom em uma fatura:
 *   - cria linha em coupon_redemptions
 *   - incrementa coupons.redeemed_count atomicamente
 *   - se for first_invoice_only, marca workspaces.coupon_first_invoice_used_at
 *
 * Tudo em transação pra não dessincronizar o counter.
 *
 * @param {object} opts
 * @param {string} opts.couponCode
 * @param {string} opts.workspaceId
 * @param {string} opts.plan
 * @param {number} opts.originalAmount
 * @param {number} opts.discountAmount
 * @param {number} opts.finalAmount
 * @param {string} [opts.invoiceId]   - id da invoice gerada (se já existir)
 * @param {string} [opts.status]      - 'pending' | 'paid' | 'reversed'
 */
function recordRedemption(opts) {
  const {
    couponCode, workspaceId, plan,
    originalAmount, discountAmount, finalAmount,
    invoiceId = null, status = 'pending',
  } = opts;

  if (!couponCode || !workspaceId || !plan) {
    throw new Error('recordRedemption requires couponCode, workspaceId, plan');
  }

  const redemptionId = uuidv4();
  return db.transaction(() => {
    const coupon = db.get('SELECT * FROM coupons WHERE code = ?', [couponCode]);
    if (!coupon) {
      throw new Error(`Coupon ${couponCode} not found at redemption time`);
    }

    db.run(
      `INSERT INTO coupon_redemptions
         (id, coupon_code, workspace_id, plan,
          original_amount, discount_amount, final_amount,
          invoice_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        redemptionId, couponCode, workspaceId, plan,
        originalAmount, discountAmount, finalAmount,
        invoiceId, status,
      ]
    );

    db.run(
      `UPDATE coupons SET redeemed_count = redeemed_count + 1 WHERE code = ?`,
      [couponCode]
    );

    if (coupon.first_invoice_only) {
      db.run(
        `UPDATE workspaces SET coupon_first_invoice_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [workspaceId]
      );
    }

    logger.info(
      `[Coupon] Redeemed ${couponCode} for ws=${workspaceId} plan=${plan} ` +
      `amount ${originalAmount} → ${finalAmount} (-${discountAmount})`
    );
    return redemptionId;
  })();
}

module.exports = {
  normalizeCode,
  validate,
  previewDiscount,
  applyToWorkspace,
  getPendingCouponForWorkspace,
  recordRedemption,
  // exportados para testes
  _internal: { planAllowed, isWithinValidity, hasRedemptionsLeft },
};
