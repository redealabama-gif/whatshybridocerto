/**
 * 🚨 AppError - Classes de erro customizadas
 * WhatsHybrid Pro v7.1.0
 */

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.timestamp = new Date();
    
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        timestamp: this.timestamp
      }
    };
  }
}

class ValidationError extends AppError {
  constructor(message, details = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        details: this.details,
        timestamp: this.timestamp
      }
    };
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.resource = resource;
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(retryAfter = 60) {
    super('Too many requests', 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

class ServiceUnavailableError extends AppError {
  constructor(service = 'Service') {
    super(`${service} is temporarily unavailable`, 503, 'SERVICE_UNAVAILABLE');
    this.service = service;
  }
}

class AIProviderError extends AppError {
  constructor(provider, message) {
    super(`AI Provider ${provider}: ${message}`, 502, 'AI_PROVIDER_ERROR');
    this.provider = provider;
  }
}

class QuotaExceededError extends AppError {
  constructor(resource = 'API calls') {
    super(`Quota exceeded for ${resource}`, 402, 'QUOTA_EXCEEDED');
    this.resource = resource;
  }
}

class PaymentRequiredError extends AppError {
  constructor(message = 'Payment required') {
    super(message, 402, 'PAYMENT_REQUIRED');
  }
}

// Error codes
const ERROR_CODES = {
  // Auth errors (1xxx)
  INVALID_CREDENTIALS: { code: 1001, message: 'Invalid credentials', status: 401 },
  TOKEN_EXPIRED: { code: 1002, message: 'Token expired', status: 401 },
  TOKEN_INVALID: { code: 1003, message: 'Invalid token', status: 401 },
  SESSION_EXPIRED: { code: 1004, message: 'Session expired', status: 401 },
  ACCOUNT_SUSPENDED: { code: 1005, message: 'Account suspended', status: 403 },
  
  // Validation errors (2xxx)
  VALIDATION_FAILED: { code: 2001, message: 'Validation failed', status: 400 },
  MISSING_REQUIRED_FIELD: { code: 2002, message: 'Missing required field', status: 400 },
  INVALID_FORMAT: { code: 2003, message: 'Invalid format', status: 400 },
  
  // Resource errors (3xxx)
  RESOURCE_NOT_FOUND: { code: 3001, message: 'Resource not found', status: 404 },
  RESOURCE_ALREADY_EXISTS: { code: 3002, message: 'Resource already exists', status: 409 },
  RESOURCE_DELETED: { code: 3003, message: 'Resource has been deleted', status: 410 },
  
  // Permission errors (4xxx)
  PERMISSION_DENIED: { code: 4001, message: 'Permission denied', status: 403 },
  INSUFFICIENT_ROLE: { code: 4002, message: 'Insufficient role', status: 403 },
  WORKSPACE_ACCESS_DENIED: { code: 4003, message: 'Workspace access denied', status: 403 },
  
  // Quota/Billing errors (5xxx)
  QUOTA_EXCEEDED: { code: 5001, message: 'Quota exceeded', status: 402 },
  SUBSCRIPTION_REQUIRED: { code: 5002, message: 'Subscription required', status: 402 },
  CREDITS_EXHAUSTED: { code: 5003, message: 'AI credits exhausted', status: 402 },
  PLAN_LIMIT_REACHED: { code: 5004, message: 'Plan limit reached', status: 402 },
  
  // External service errors (6xxx)
  AI_PROVIDER_ERROR: { code: 6001, message: 'AI provider error', status: 502 },
  WHATSAPP_ERROR: { code: 6002, message: 'WhatsApp error', status: 502 },
  WEBHOOK_DELIVERY_FAILED: { code: 6003, message: 'Webhook delivery failed', status: 502 },
  
  // Rate limit errors (7xxx)
  RATE_LIMIT_EXCEEDED: { code: 7001, message: 'Rate limit exceeded', status: 429 },
  TOO_MANY_REQUESTS: { code: 7002, message: 'Too many requests', status: 429 },
  
  // Server errors (9xxx)
  INTERNAL_ERROR: { code: 9001, message: 'Internal server error', status: 500 },
  DATABASE_ERROR: { code: 9002, message: 'Database error', status: 500 },
  SERVICE_UNAVAILABLE: { code: 9003, message: 'Service unavailable', status: 503 }
};

module.exports = {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  AIProviderError,
  QuotaExceededError,
  PaymentRequiredError,
  ERROR_CODES
};
