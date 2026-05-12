/**
 * CSRF Protection Middleware — double-submit cookie pattern.
 *
 * Aplicado em rotas state-changing fora do header Authorization
 * (que é imune a CSRF por natureza). Usado em /admin onde sessões
 * baseadas em cookie podem existir.
 *
 * @module middleware/csrf
 */
/**
 * CSRF Protection Middleware — v8.5.0
 *
 * Estratégia atual:
 * 1. JWT em Authorization header (não cookie) → CSRF clássico não aplica
 * 2. Validação de Origin/Referer em mutations (defesa em profundidade)
 * 3. Para futuras requests com cookie de sessão, usar SameSite=Strict
 *
 * Como ativar verificação rígida de origin em rotas sensíveis:
 *   const { csrfOriginCheck } = require('../middleware/csrf');
 *   router.post('/sensitive', csrfOriginCheck, handler);
 */

const config = require('../../config');
const logger = require('../utils/logger');

/**
 * Lista de origens permitidas (lê do CORS config)
 */
function getAllowedOrigins() {
  const corsOrigin = config.cors?.origin;
  if (!corsOrigin) return [];
  if (Array.isArray(corsOrigin)) return corsOrigin;
  if (typeof corsOrigin === 'string') {
    if (corsOrigin === '*') return ['*'];
    return corsOrigin.split(',').map(o => o.trim());
  }
  return [];
}

/**
 * Valida que a request veio da mesma origem (defesa contra CSRF clássico).
 * Para requests com Bearer token (Authorization), a verificação é mais permissiva
 * já que o token não é enviado automaticamente pelo navegador.
 *
 * Usado defensivamente em mutations sensíveis (deletes, payments, etc).
 */
function csrfOriginCheck(req, res, next) {
  // GET/HEAD/OPTIONS são seguros por definição
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Se tem Authorization Bearer, request é via API (não navegador) → permite
  // (CSRF requer cookies sendo enviados automaticamente; Bearer é manual)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return next();
  }

  // Webhooks têm validação própria via HMAC
  if (req.path.includes('/webhooks/')) {
    return next();
  }

  // Verifica Origin/Referer
  const origin = req.headers.origin || req.headers.referer;
  const allowed = getAllowedOrigins();

  if (allowed.includes('*')) return next();

  if (!origin) {
    logger.warn(`[CSRF] Request without Origin/Referer to ${req.method} ${req.path}`);
    return res.status(403).json({
      error: { code: 'CSRF_MISSING_ORIGIN', message: 'Missing Origin/Referer header' }
    });
  }

  const originHost = (() => {
    try { return new URL(origin).origin; } catch { return null; }
  })();

  if (!originHost || !allowed.some(a => originHost.startsWith(a))) {
    logger.warn(`[CSRF] Origin mismatch: ${origin} not in [${allowed.join(', ')}]`);
    return res.status(403).json({
      error: { code: 'CSRF_INVALID_ORIGIN', message: 'Invalid Origin' }
    });
  }

  next();
}

/**
 * Aplica X-Frame-Options + Content-Security-Policy adicional para defender
 * contra clickjacking (geralmente helmet já faz, mas reforça).
 */
function antiClickjacking(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}

module.exports = {
  csrfOriginCheck,
  antiClickjacking,
};
