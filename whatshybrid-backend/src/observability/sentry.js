/**
 * Sentry Integration — v9.0.0
 *
 * Captura erros no backend e envia pra Sentry.io
 *
 * Ativação: defina SENTRY_DSN env var.
 * Sem DSN, o módulo é no-op (não quebra nada).
 *
 * Como criar DSN:
 *   1. Cria conta em https://sentry.io (free tier 5k errors/mês)
 *   2. Cria projeto Node.js
 *   3. Copia DSN do Settings → Client Keys
 *   4. Define SENTRY_DSN=https://xxx@sentry.io/yyy
 */

const logger = require('../utils/logger');

let Sentry = null;

function init(app) {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    logger.info('[Sentry] SENTRY_DSN não definido — error tracking desabilitado');
    return null;
  }

  try {
    Sentry = require('@sentry/node');
  } catch (e) {
    logger.warn('[Sentry] Pacote @sentry/node não instalado. Run: npm install @sentry/node');
    return null;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.APP_VERSION || require('../../package.json').version,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,

    // Sanitiza dados sensíveis antes de enviar
    beforeSend(event, hint) {
      try {
        // Remove body de requests com dados sensíveis
        if (event.request?.data) {
          if (typeof event.request.data === 'object') {
            // Lista negra de campos que NUNCA podem ir pra Sentry
            const sensitive = ['password', 'token', 'refreshToken', 'secret',
              'authorization', 'cardNumber', 'cvv', 'totp_secret'];
            for (const k of Object.keys(event.request.data)) {
              if (sensitive.some(s => k.toLowerCase().includes(s))) {
                event.request.data[k] = '[REDACTED]';
              }
            }
          } else if (typeof event.request.data === 'string') {
            // Pode ser JSON serializado
            event.request.data = '[REDACTED-BODY]';
          }
        }

        // Remove Authorization header
        if (event.request?.headers) {
          for (const k of Object.keys(event.request.headers)) {
            if (k.toLowerCase() === 'authorization' ||
                k.toLowerCase() === 'cookie') {
              event.request.headers[k] = '[REDACTED]';
            }
          }
        }

        // Remove cookies
        if (event.request?.cookies) delete event.request.cookies;

        return event;
      } catch (err) {
        // Em erro de sanitização, não envia
        return null;
      }
    },

    // Ignora erros que não são acionáveis
    ignoreErrors: [
      // Browsers errors irrelevantes (mais usado no frontend, mas constante aqui)
      'NetworkError',
      'Connection lost',
      'ECONNRESET',
      'EPIPE',
    ],
  });

  if (app) {
    // Request handler antes de TODAS as rotas
    if (Sentry.Handlers?.requestHandler) {
      app.use(Sentry.Handlers.requestHandler({
        user: ['id', 'email'],
        request: ['method', 'url', 'headers', 'data'],
      }));
    }

    if (Sentry.Handlers?.tracingHandler) {
      app.use(Sentry.Handlers.tracingHandler());
    }
  }

  logger.info(`[Sentry] Initialized (env=${process.env.NODE_ENV}, release=${require('../../package.json').version})`);
  return Sentry;
}

/**
 * Aplica error handler do Sentry. Deve ser chamado APÓS todas as rotas
 * mas ANTES do errorHandler do app.
 */
function applyErrorHandler(app) {
  if (!Sentry) return;
  if (Sentry.Handlers?.errorHandler) {
    app.use(Sentry.Handlers.errorHandler({
      shouldHandleError(error) {
        // Reporta apenas 500+
        return !error.statusCode || error.statusCode >= 500;
      },
    }));
  }
}

/**
 * Marca usuário no scope (chamado após auth)
 */
function setUser(user, workspaceId) {
  if (!Sentry || !user) return;
  try {
    const scope = Sentry.getCurrentScope?.();
    if (scope) {
      scope.setUser({
        id: user.id,
        email: user.email, // OK porque sanitização vai remover dados sensíveis se necessário
      });
      if (workspaceId) {
        scope.setTag('workspace_id', workspaceId);
      }
    }
  } catch (_) {}
}

/**
 * Captura exceção manualmente (com contexto extra)
 */
function captureException(err, context = {}) {
  if (!Sentry) {
    logger.error('[Captured]', err.message, context);
    return;
  }
  Sentry.captureException(err, { extra: context });
}

module.exports = {
  init, applyErrorHandler, setUser, captureException,
  get instance() { return Sentry; },
};
