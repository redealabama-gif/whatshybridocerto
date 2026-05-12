/**
 * Backend Logger Centralizado
 * WhatsHybrid v9.2.0 — adicionada sanitização de secrets
 */

const { v4: uuidv4 } = require('uuid'); // Assumindo wrapper ou uuid direto

// Fallback simples se uuid não estiver disponível
const genId = typeof uuidv4 === 'function' ? uuidv4 : () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// v9.2.0: campos sensíveis que NUNCA podem ir pra logs em texto puro
const SENSITIVE_FIELDS = [
  'password', 'pwd', 'pass', 'secret',
  'token', 'access_token', 'refresh_token', 'bearer', 'authorization',
  'totp_secret', 'totp', '2fa_code', 'otp',
  'api_key', 'apikey', 'apiKey', 'api-key',
  'private_key', 'privateKey',
  'cardNumber', 'card_number', 'card-number', 'cvv', 'cvc',
  'ssn', 'cpf_full', 'rg_full',
  'jwt', 'cookie', 'session',
  'stripe_secret', 'webhook_secret', 'mp_access_token',
  'sendgrid_key', 'resend_key', 'sentry_dsn',
];

/**
 * Sanitiza recursivamente um objeto, redacting valores em campos sensíveis.
 * Limita profundidade pra evitar circular refs.
 * Retorna NOVO objeto (não muta o original).
 */
function sanitize(value, depth = 0) {
  if (depth > 6) return '[depth-limit]';
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map(v => sanitize(v, depth + 1));
  }

  if (typeof value === 'object') {
    // Erros: preserva campos relevantes mas sanitiza qualquer custom prop
    if (value instanceof Error) {
      return {
        message: value.message,
        name: value.name,
        stack: value.stack,
        code: value.code,
      };
    }

    // Buffer / Stream / etc — não loga conteúdo
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`;
    if (typeof value.pipe === 'function') return '[Stream]';

    const result = {};
    for (const [k, v] of Object.entries(value)) {
      const lowerK = String(k).toLowerCase();
      const isSensitive = SENSITIVE_FIELDS.some(f =>
        lowerK === f.toLowerCase() ||
        lowerK.includes(f.toLowerCase())
      );

      if (isSensitive) {
        // Mantém só prefixo se for string longa (útil pra debug sem vazar)
        if (typeof v === 'string' && v.length > 8) {
          result[k] = `[REDACTED:${v.length}c:${v.substring(0, 4)}…]`;
        } else {
          result[k] = '[REDACTED]';
        }
      } else if (typeof v === 'string' && /^Bearer\s+/i.test(v)) {
        // Authorization header inline
        result[k] = '[REDACTED:Bearer]';
      } else {
        result[k] = sanitize(v, depth + 1);
      }
    }
    return result;
  }

  // String contendo padrão de Bearer/JWT — sanitiza
  if (typeof value === 'string') {
    if (value.length > 200) return value.substring(0, 200) + '…';
    // Não sanitiza strings simples
  }

  return value;
}

class Logger {
  constructor() {
    this.requestIdSymbol = Symbol('requestId');
  }

  // Middleware para adicionar request ID
  requestIdMiddleware() {
    return (req, res, next) => {
      req.requestId = req.headers['x-request-id'] || genId();
      res.setHeader('x-request-id', req.requestId);
      next();
    };
  }

  formatError(error, context = {}) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: error.code,
      ...sanitize(context),
      timestamp: new Date().toISOString()
    };
  }

  // v9.5.0 BUG #146: muitos callers passam string como 2º argumento (`logger.warn(msg, err.message)`).
  // O JSON.stringify({ ...sanitize(string) }) espalhava os caracteres como
  // chaves numéricas (`{"0":"C","1":"a","2":"n",…}`) → logs ilegíveis.
  // Agora normalizamos: string vira `{ detail: <string> }`, número/bool vira
  // `{ value: <v> }`, undefined/null é ignorado.
  _normalizeContext(ctx) {
    if (ctx == null) return {};
    if (typeof ctx === 'string') return { detail: ctx };
    if (typeof ctx === 'number' || typeof ctx === 'boolean') return { value: ctx };
    if (Array.isArray(ctx)) return { items: ctx };
    return ctx;
  }

  error(message, error, context = {}) {
    const formatted = error instanceof Error
      ? this.formatError(error, this._normalizeContext(context))
      : { error: sanitize(this._normalizeContext(error)), ...sanitize(this._normalizeContext(context)) };
    console.error(JSON.stringify({
      level: 'error',
      message,
      ...formatted,
      timestamp: new Date().toISOString()
    }));
  }

  warn(message, context = {}) {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      ...sanitize(this._normalizeContext(context)),
      timestamp: new Date().toISOString()
    }));
  }

  info(message, context = {}) {
    console.log(JSON.stringify({
      level: 'info',
      message,
      ...sanitize(this._normalizeContext(context)),
      timestamp: new Date().toISOString()
    }));
  }

  debug(message, context = {}) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(JSON.stringify({
        level: 'debug',
        message,
        ...sanitize(this._normalizeContext(context)),
        timestamp: new Date().toISOString()
      }));
    }
  }
}

const logger = new Logger();

// Wrapper para rotas async
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      logger.error('Route error', error, {
        requestId: req.requestId,
        path: req.path,
        method: req.method,
        userId: req.user?.id
      });
      
      res.status(500).json({
        error: 'Internal Server Error',
        requestId: req.requestId,
        // Em produção, não expor stack trace
        message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
      });
    });
  };
}

// Classe de Erro Customizada
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// v9.5.0 BUG #135: o módulo exporta a instância `logger` direto pra suportar
// ambos padrões de import sem quebrar:
//   const logger = require('./logger');             → instância (com .info/.warn/.error)
//   const { logger } = require('./logger');         → mesma instância via self-ref
//   const { asyncHandler, AppError } = require(...) → ainda funciona
// Antes a v9.4.7 só expunha `{ logger, ... }` mas ~100 arquivos faziam
// `const logger = require('./logger')` → logger.info era undefined → server
// não bootava.
module.exports = logger;
module.exports.logger = logger;
module.exports.asyncHandler = asyncHandler;
module.exports.AppError = AppError;
module.exports.sanitize = sanitize;
module.exports.SENSITIVE_FIELDS = SENSITIVE_FIELDS;