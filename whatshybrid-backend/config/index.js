/**
 * Configuration
 */

const env = process.env.NODE_ENV || 'development';

// v7.9.13: Exigir secrets em TODOS os ambientes (sem fallback previsível)
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error('JWT_SECRET é obrigatório (defina a variável de ambiente JWT_SECRET)');
}
if (String(jwtSecret).length < 32) {
  throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres');
}
const FORBIDDEN_SECRETS = ['dev-only-change-in-production', 'secret', 'jwt-secret', 'my-secret', 'change-me', 'change_this', 'placeholder', 'example', 'test', 'testing', 'demo', 'sample'];
if (FORBIDDEN_SECRETS.some(s => String(jwtSecret).toLowerCase().includes(s))) {
  throw new Error('JWT_SECRET contém valor inseguro');
}

const webhookSecret = process.env.WEBHOOK_SECRET;
if (!webhookSecret) {
  throw new Error('WEBHOOK_SECRET é obrigatório (defina a variável de ambiente WEBHOOK_SECRET)');
}
if (String(webhookSecret).length < 16) {
  throw new Error('WEBHOOK_SECRET deve ter pelo menos 16 caracteres');
}

module.exports = {
  env,
  port: parseInt(process.env.PORT, 10) || 3000,
  
  database: {
    path: process.env.DATABASE_PATH || './data/whatshybrid.db'
  },
  
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d'
  },
  
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100
  },
  
  cors: {
    origin: (() => {
      if (process.env.CORS_ORIGIN === '*') {
        if (env === 'production') {
          throw new Error('CORS_ORIGIN=* is not allowed in production. Set specific origins.');
        }
        return true;
      }
      return process.env.CORS_ORIGIN?.split(',').map(s => s.trim()) || ['http://localhost:3000'];
    })(),
    credentials: true
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  
  ai: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      // Modelo padrão (pode ser sobrescrito por AI_DEFAULT_MODEL no .env)
      defaultModel: process.env.AI_DEFAULT_MODEL || 'gpt-4o'
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultModel: 'claude-3-5-sonnet-20241022'
    },
    venice: {
      apiKey: process.env.VENICE_API_KEY,
      defaultModel: 'llama-3.3-70b'
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY,
      defaultModel: 'llama-3.3-70b-versatile'
    },
    google: {
      apiKey: process.env.GOOGLE_API_KEY,
      defaultModel: 'gemini-2.0-flash-exp'
    }
  },
  
  webhook: {
    secret: webhookSecret
  },
  
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM
  }
};
