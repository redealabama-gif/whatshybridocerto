/**
 * Token Routes - v8.4.0
 *
 * Endpoints relacionados a tokens (créditos de IA) que o portal do cliente
 * usa para mostrar saldo, histórico e comprar mais.
 */

const express = require('express');
const router = express.Router();

const tokenService = require('../services/TokenService');
const { TOKEN_PACKAGES, PLAN_TOKENS, PLAN_RESPOSTAS } = tokenService;
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
  // listarPacotes() em vez de Object.entries(TOKEN_PACKAGES): o objeto também
  // guarda os apelidos antigos (pack_10k e cia.) apontando pros mesmos
  // pacotes, e a vitrine saía com cada um duas vezes (PKG-01).
  res.json({
    packages: tokenService.listarPacotes(),
    plan_grants: PLAN_TOKENS,
    plan_respostas: PLAN_RESPOSTAS,
    respostas_por_pacote: tokenService.listarPacotes().map((p) => p.respostas),
    note: 'A cota mensal do plano zera na renovação. Pacotes avulsos não expiram.',
  });
});

module.exports = router;
