/**
 * Error Handler Middleware — v9.0.0 (com i18n auto)
 *
 * Traduz automaticamente mensagens em AppError baseado em req.locale
 * sem precisar tocar nas 113 chamadas existentes a `throw new AppError(...)`.
 */

const logger = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Mapa pt-BR/en → key i18n
const ERROR_KEY_MAP = {
  'Invalid credentials': 'errors.invalid_credentials',
  'Credenciais inválidas': 'errors.invalid_credentials',
  'Account is not active': 'errors.account_inactive',
  'Account inactive': 'errors.account_inactive',
  'Email already exists': 'errors.email_exists',
  'Email já existe': 'errors.email_exists',
  'Email already in use': 'errors.email_exists',
  'User not found': 'errors.user_not_found',
  'Usuário não encontrado': 'errors.user_not_found',
  'Workspace not found': 'errors.workspace_not_found',
  'Workspace não encontrado': 'errors.workspace_not_found',
  'Invalid token': 'errors.invalid_token',
  'Token inválido': 'errors.invalid_token',
  'Token expirado': 'errors.token_expired',
  'Token expired': 'errors.token_expired',
  'Refresh token required': 'errors.refresh_token_required',
  'Forbidden': 'errors.forbidden',
  'Permission denied': 'errors.forbidden',
  'Sem permissão para esta ação': 'errors.forbidden',
  'Not authorized': 'errors.unauthorized',
  'Você precisa estar logado': 'errors.unauthorized',
  'Validation failed': 'errors.validation_failed',
  'Dados inválidos': 'errors.validation_failed',
  'Código inválido': 'errors.invalid_code',
  'Código TOTP inválido': 'errors.invalid_totp',
  'Senha incorreta': 'errors.wrong_password',
  '2FA já está ativo': 'errors.2fa_already_enabled',
  '2FA não está ativo': 'errors.2fa_not_enabled',
  'Saldo insuficiente': 'errors.insufficient_balance',
  'Insufficient balance': 'errors.insufficient_balance',
  'Plano inválido': 'errors.invalid_plan',
  'Invalid plan': 'errors.invalid_plan',
  'Pagamento ainda não configurado': 'errors.payment_not_configured',
  'MercadoPago não configurado': 'errors.payment_not_configured',
  'Stripe não configurado nesta instância': 'errors.payment_not_configured',
  'Not found': 'errors.not_found',
  'Não encontrado': 'errors.not_found',
  'Algo deu errado': 'errors.generic',
  'Something went wrong': 'errors.generic',
  'Internal server error': 'errors.generic',
};

const EXTRA_TRANSLATIONS = {
  'pt-BR': {
    'errors.invalid_credentials': 'Credenciais inválidas',
    'errors.account_inactive': 'Conta inativa',
    'errors.email_exists': 'Este email já está cadastrado',
    'errors.user_not_found': 'Usuário não encontrado',
    'errors.workspace_not_found': 'Workspace não encontrado',
    'errors.invalid_token': 'Token inválido',
    'errors.token_expired': 'Token expirado',
    'errors.refresh_token_required': 'Refresh token obrigatório',
    'errors.forbidden': 'Sem permissão para esta ação',
    'errors.unauthorized': 'Você precisa estar logado',
    'errors.validation_failed': 'Dados inválidos',
    'errors.invalid_code': 'Código inválido',
    'errors.invalid_totp': 'Código TOTP inválido',
    'errors.wrong_password': 'Senha incorreta',
    'errors.2fa_already_enabled': '2FA já está ativo',
    'errors.2fa_not_enabled': '2FA não está ativo',
    'errors.insufficient_balance': 'Saldo insuficiente',
    'errors.invalid_plan': 'Plano inválido',
    'errors.payment_not_configured': 'Pagamento ainda não configurado',
    'errors.not_found': 'Não encontrado',
    'errors.generic': 'Algo deu errado. Tente novamente.',
  },
  'en-US': {
    'errors.invalid_credentials': 'Invalid credentials',
    'errors.account_inactive': 'Account inactive',
    'errors.email_exists': 'Email already in use',
    'errors.user_not_found': 'User not found',
    'errors.workspace_not_found': 'Workspace not found',
    'errors.invalid_token': 'Invalid token',
    'errors.token_expired': 'Token expired',
    'errors.refresh_token_required': 'Refresh token required',
    'errors.forbidden': "You don't have permission for this action",
    'errors.unauthorized': 'You must be signed in',
    'errors.validation_failed': 'Invalid data',
    'errors.invalid_code': 'Invalid code',
    'errors.invalid_totp': 'Invalid TOTP code',
    'errors.wrong_password': 'Wrong password',
    'errors.2fa_already_enabled': '2FA is already enabled',
    'errors.2fa_not_enabled': '2FA is not enabled',
    'errors.insufficient_balance': 'Insufficient balance',
    'errors.invalid_plan': 'Invalid plan',
    'errors.payment_not_configured': 'Payment not yet configured',
    'errors.not_found': 'Not found',
    'errors.generic': 'Something went wrong. Please try again.',
  },
  'es-ES': {
    'errors.invalid_credentials': 'Credenciales inválidas',
    'errors.account_inactive': 'Cuenta inactiva',
    'errors.email_exists': 'Este correo ya está registrado',
    'errors.user_not_found': 'Usuario no encontrado',
    'errors.workspace_not_found': 'Workspace no encontrado',
    'errors.invalid_token': 'Token inválido',
    'errors.token_expired': 'Token expirado',
    'errors.refresh_token_required': 'Refresh token requerido',
    'errors.forbidden': 'No tienes permiso para esta acción',
    'errors.unauthorized': 'Debes iniciar sesión',
    'errors.validation_failed': 'Datos inválidos',
    'errors.invalid_code': 'Código inválido',
    'errors.invalid_totp': 'Código TOTP inválido',
    'errors.wrong_password': 'Contraseña incorrecta',
    'errors.2fa_already_enabled': '2FA ya está activo',
    'errors.2fa_not_enabled': '2FA no está activo',
    'errors.insufficient_balance': 'Saldo insuficiente',
    'errors.invalid_plan': 'Plan inválido',
    'errors.payment_not_configured': 'Pago aún no configurado',
    'errors.not_found': 'No encontrado',
    'errors.generic': 'Algo salió mal. Inténtalo de nuevo.',
  },
};

function autoTranslateError(message, locale) {
  if (!message || !locale) return message;
  const key = ERROR_KEY_MAP[message];
  if (!key) return message;
  return EXTRA_TRANSLATIONS[locale]?.[key] ||
         EXTRA_TRANSLATIONS['pt-BR']?.[key] ||
         message;
}

function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    path: req.originalUrl
  });
}

function errorHandler(err, req, res, _next) {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  const skipLogging = err.message?.includes('refresh token') ||
                      err.message?.includes('Invalid token') ||
                      err.code === 'TOKEN_INVALID';

  if (!skipLogging) {
    logger.error({
      message: err.message,
      stack: err.stack,
      statusCode: err.statusCode,
      path: req.originalUrl,
      method: req.method,
      ip: req.ip,
      userId: req.user?.id
    });
  }

  const locale = req.locale || 'pt-BR';
  const translatedMessage = autoTranslateError(err.message, locale);

  if (process.env.NODE_ENV === 'development') {
    return res.status(err.statusCode).json({
      error: err.status,
      message: translatedMessage,
      code: err.code,
      details: err.details,
      stack: err.stack
    });
  }

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.status,
      message: translatedMessage,
      code: err.code,
      details: err.details
    });
  }

  return res.status(500).json({
    error: 'error',
    message: locale === 'en-US' ? 'Something went wrong' :
             locale === 'es-ES' ? 'Algo salió mal' :
             'Algo deu errado'
  });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function handleValidationError(errors) {
  const messages = errors.array().map(err => ({
    field: err.path,
    message: err.msg
  }));
  const e = new AppError('Validation failed', 400, 'VALIDATION_ERROR');
  e.details = messages;
  throw e;
}

module.exports = {
  AppError, notFoundHandler, errorHandler, asyncHandler,
  handleValidationError, autoTranslateError, ERROR_KEY_MAP, EXTRA_TRANSLATIONS,
};
