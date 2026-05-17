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
    // O rate limiter geral (app.use global) usa estes valores. O default
    // antigo — 100 req / 15 min (~6/min) — era baixo demais: a extensão
    // sincroniza ~16 módulos a cada 60s (DataSyncManager) + health checks +
    // CRM/Tasks, e estourava 429 em loop. Janela de 1 min com teto generoso
    // ainda protege contra abuso real, mas comporta o cliente legítimo.
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 300
  },
  
  cors: {
    // Origin pode ser uma função quando precisamos aceitar wildcard
    // chrome-extension://* — a string "chrome-extension://*" não casa com
    // o matcher exato do middleware `cors`. Por isso retornamos uma função
    // que aceita: (a) origins explícitos do .env, (b) qualquer
    // chrome-extension:// (extensão pode trocar de ID em dev/build),
    // (c) https://web.whatsapp.com (origin do content script quando
    // aplicável). Em produção, exigir CORS_ORIGIN explícito sem wildcard.
    origin: (() => {
      const envList = process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean) || [];
      const allowWildcardExt = envList.length === 0 || envList.includes('chrome-extension://*');
      const explicitOrigins = envList.filter(o => o !== 'chrome-extension://*' && o !== '*');

      if (process.env.CORS_ORIGIN === '*') {
        if (env === 'production') {
          throw new Error('CORS_ORIGIN=* is not allowed in production. Set specific origins.');
        }
        return true;
      }

      const fallback = explicitOrigins.length ? explicitOrigins : ['http://localhost:3000'];

      return function corsOriginCheck(origin, callback) {
        // Sem Origin header (curl, server-to-server, mesma origem) → permitir.
        if (!origin) return callback(null, true);
        // Origens explícitas do .env.
        if (fallback.includes(origin)) return callback(null, true);
        // Extensões Chrome (e Edge) — IDs variam entre dev/prod/usuários.
        // Em produção só liberar se o .env explicitamente incluir chrome-extension://*.
        if (origin.startsWith('chrome-extension://') && (env !== 'production' || allowWildcardExt)) {
          return callback(null, true);
        }
        // web.whatsapp.com aparece como Origin em alguns fetches de content script.
        if (origin === 'https://web.whatsapp.com') return callback(null, true);
        return callback(new Error(`CORS bloqueado para origin: ${origin}`));
      };
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
