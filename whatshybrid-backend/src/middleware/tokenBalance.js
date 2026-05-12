/**
 * Token Balance Middleware — bloqueia rotas se workspace ficou sem tokens.
 *
 * Aplicado em rotas que consomem tokens AI (/ai/*, /smartbot/*).
 * Verifica se `balance >= estimated_cost` antes de processar.
 *
 * Retorna 402 Payment Required se insuficiente.
 *
 * @module middleware/tokenBalance
 */
/**
 * Token Balance Middleware - v8.4.0
 *
 * Bloqueia requests para endpoints de IA se o workspace não tem saldo
 * de tokens suficiente. Aplique em rotas que invocam LLMs.
 *
 * Comportamento:
 *   - Sem saldo → 402 Payment Required + mensagem clara para comprar mais
 *   - Saldo baixo → permite mas adiciona warning header
 *   - Saldo OK → segue normalmente
 *
 * Uso:
 *   const { checkTokenBalance } = require('../middleware/tokenBalance');
 *   router.post('/process', authenticate, checkTokenBalance(1000), handler);
 */

const tokenService = require('../services/TokenService');
const logger = require('../utils/logger');

/**
 * Cria middleware que verifica saldo mínimo de tokens.
 *
 * @param {number} [estimatedCost=500] — estimativa pessimista do custo da request.
 *   Se o cliente tem menos que isso, bloqueia. Default 500 tokens
 *   (~uma resposta curta de gpt-4o-mini).
 */
function checkTokenBalance(estimatedCost = 500) {
  return (req, res, next) => {
    if (!req.workspaceId) {
      // Sem workspace? Outros middlewares devem ter pegado, mas por segurança:
      return res.status(401).json({ error: 'Workspace não identificado' });
    }

    try {
      const status = tokenService.getStatus(req.workspaceId);

      // Bloqueia: saldo zerado
      if (status.empty) {
        return res.status(402).json({
          error: 'Tokens esgotados',
          code: 'TOKENS_EXHAUSTED',
          message: 'Seus tokens de IA acabaram. Compre um pacote para continuar usando.',
          balance: status,
          actions: {
            buy_more: '/api/v1/billing/create-token-checkout',
            view_balance: '/api/v1/tokens/balance',
          },
        });
      }

      // Bloqueia: saldo abaixo do estimado para esta request
      if (status.balance < estimatedCost) {
        return res.status(402).json({
          error: 'Saldo insuficiente para esta request',
          code: 'INSUFFICIENT_BALANCE',
          message: `Esta operação requer ~${estimatedCost} tokens, mas você tem apenas ${status.balance} disponíveis.`,
          balance: status,
          actions: {
            buy_more: '/api/v1/billing/create-token-checkout',
          },
        });
      }

      // Permite mas avisa: saldo baixo
      if (status.low_balance) {
        res.setHeader('X-Tokens-Low-Balance', 'true');
        res.setHeader('X-Tokens-Remaining', String(status.balance));
      }

      next();
    } catch (err) {
      logger.error('[checkTokenBalance] error:', err.message);
      // Em caso de erro no balance check, NÃO bloqueia — fail open.
      // Melhor cliente ter IA funcionando do que ficar travado por bug nosso.
      next();
    }
  };
}

module.exports = { checkTokenBalance };
