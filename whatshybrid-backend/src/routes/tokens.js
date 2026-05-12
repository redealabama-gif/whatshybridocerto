/**
 * Token Routes - v8.4.0
 *
 * Endpoints relacionados a tokens (créditos de IA) que o portal do cliente
 * usa para mostrar saldo, histórico e comprar mais.
 */

const express = require('express');
const router = express.Router();

const tokenService = require('../services/TokenService');
const { TOKEN_PACKAGES, PLAN_TOKENS } = tokenService;
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

router.use(authenticate);

/**
 * GET /api/v1/tokens/balance
 * Saldo atual + status de baixo nível
 */
router.get('/balance', asyncHandler(async (req, res) => {
  const status = tokenService.getStatus(req.workspaceId);
  res.json({ balance: status });
}));

/**
 * GET /api/v1/tokens/history
 * Histórico de transações (paginado)
 * Query: ?limit=50&offset=0&type=consume|topup|plan_grant|plan_renewal
 */
router.get('/history', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const type = req.query.type || null;

  const transactions = tokenService.history(req.workspaceId, { limit, offset, type });
  res.json({ transactions });
}));

/**
 * GET /api/v1/tokens/usage
 * Resumo de uso (para gráficos)
 * Query: ?days=30
 */
router.get('/usage', asyncHandler(async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const report = tokenService.usageReport(req.workspaceId, { days });
  res.json({ usage: report });
}));

/**
 * GET /api/v1/tokens/packages
 * Pacotes disponíveis para top-up
 */
router.get('/packages', (req, res) => {
  const packages = Object.entries(TOKEN_PACKAGES).map(([id, p]) => ({
    id,
    tokens: p.tokens,
    price_brl: p.price_brl_cents / 100,
    price_brl_cents: p.price_brl_cents,
    label: p.label,
    cost_per_1k: ((p.price_brl_cents / 100) / (p.tokens / 1000)).toFixed(3),
  }));

  res.json({
    packages,
    plan_grants: PLAN_TOKENS,
    note: 'Tokens não usados expiram no fim do ciclo mensal. Pacotes avulsos não expiram.',
  });
});

module.exports = router;
