/**
 * 🚀 WhatsHybrid Backend Server
 * Enterprise API for WhatsHybrid Pro
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const { version: packageVersion } = require('../package.json');

// Credenciais e paths via ambiente
const JWT_SECRET = process.env.JWT_SECRET;

// CRIT-005: Exigir JWT_SECRET em TODOS os ambientes (sem fallback previsível)
if (!JWT_SECRET) {
  // eslint-disable-next-line no-console
  logger.error('═══════════════════════════════════════════════════════════');
  // eslint-disable-next-line no-console
  logger.error('FATAL: JWT_SECRET não configurado!');
  // eslint-disable-next-line no-console
  logger.error('Defina a variável de ambiente JWT_SECRET antes de iniciar o servidor.');
  // eslint-disable-next-line no-console
  logger.error('Ex.: export JWT_SECRET=<sua-chave-secreta-de-32-caracteres-ou-mais>');
  // eslint-disable-next-line no-console
  logger.error('═══════════════════════════════════════════════════════════');
  process.exit(1);
}

if (String(JWT_SECRET).length < 32) {
  // eslint-disable-next-line no-console
  logger.error('FATAL: JWT_SECRET deve ter pelo menos 32 caracteres');
  process.exit(1);
}

const FORBIDDEN_SECRETS = ['dev-only-change-in-production', 'secret', 'jwt-secret', 'my-secret', 'change-me'];
if (FORBIDDEN_SECRETS.some(s => String(JWT_SECRET).toLowerCase().includes(s))) {
  // eslint-disable-next-line no-console
  logger.error('FATAL: JWT_SECRET contém valor inseguro');
  process.exit(1);
}

const config = require('../config');
const logger = require('./utils/logger');
const database = require('./utils/database');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');
const jwt = require('jsonwebtoken');

// Routes
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const contactsRoutes = require('./routes/contacts');
const conversationsRoutes = require('./routes/conversations');
const campaignsRoutes = require('./routes/campaigns');
const analyticsRoutes = require('./routes/analytics');
const crmRoutes = require('./routes/crm');
const tasksRoutes = require('./routes/tasks');
const templatesRoutes = require('./routes/templates');
const webhooksRoutes = require('./routes/webhooks');
const aiRoutes = require('./routes/ai');
const aiV2Routes = require('./routes/ai-v2');
const settingsRoutes = require('./routes/settings');
const smartbotRoutes = require('./routes/smartbot');
const smartbotExtendedRoutes = require('./routes/smartbot-extended');
const smartbotAIPlusRoutes = require('./routes/smartbot-ai-plus');
const autopilotRoutes = require('./routes/autopilot');
const examplesRoutes = require('./routes/examples');
const recoverRoutes = require('./routes/recover');
const recoverSyncRoutes = require('./routes/recover-sync');
const aiIngestRoutes = require('./routes/ai-ingest');
const syncRoutes = require('./routes/sync');
const adminRoutes = require('./routes/admin');
const adminKillSwitchRoutes = require('./routes/admin-killswitch');
const paymentWebhooksRoutes = require('./routes/webhooks-payment');

// v8.3.0 - SaaS billing & customer portal
const apiKeysRoutes = require('./routes/api-keys');
const subscriptionRoutes = require('./routes/subscription');
const extensionRoutes = require('./routes/extension');
const billingRoutes = require('./routes/billing');
const aiSettingsRoutes = require('./routes/ai-settings');
const webhooksPaymentSaasRoutes = require('./routes/webhooks-payment-saas');
// v8.4.0 - Tokens system + email transactional
const tokensRoutes = require('./routes/tokens');
const jobsRoutes = require('./routes/jobs');
const memoryRoutes = require('./routes/memory');
const knowledgeRoutes = require('./routes/knowledge');
const speechRoutes = require('./routes/speech');
const intelligenceRoutes = require('./routes/intelligence'); // v10.1: commercial intelligence dashboard
const metricsRoutes = require('./routes/metrics'); // v8.1.0: operational dashboard endpoints
const JobsRunner = require('./jobs/JobsRunner');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ── v9.0.0: Sentry error tracking (no-op se SENTRY_DSN ausente) ──
const sentry = require('./observability/sentry');
sentry.init(app);

// ── v9.0.0: Prometheus metrics ──
const prometheus = require('./observability/prometheus');
prometheus.init();
app.use(prometheus.middleware());

// ── v9.0.0: i18n ──
const i18n = require('./utils/i18n');
app.use(i18n.middleware());

// ── v9.2.0: extension version compat + audit log middleware ──
const extVersion = require('./middleware/extensionVersion');
app.use(extVersion.middleware());
const auditLog = require('./services/AuditLogService');
app.use(auditLog.middleware());
const server = http.createServer(app);

// v9.3.4: timeouts pra evitar conexões penduradas eternamente.
//   - requestTimeout: tempo máximo entre headers e body completos
//   - headersTimeout: tempo pra receber headers (proteção slowloris)
//   - keepAliveTimeout: idle keep-alive (5s default — adequado pra tráfego web)
// Sem isso, um cliente lento ou travado segura conexão indefinidamente,
// esgotando o pool de conexões e bloqueando outros usuários.
server.requestTimeout = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 5 * 60 * 1000;  // 5min (uploads grandes ok)
server.headersTimeout = parseInt(process.env.HEADERS_TIMEOUT_MS, 10) || 60 * 1000;      // 60s
server.keepAliveTimeout = 65 * 1000;  // 65s — > load balancer típico (60s)

// Socket.IO for real-time updates
const io = new Server(server, {
  cors: {
    origin: config.cors.origin,
    methods: ['GET', 'POST']
  },
  // Heartbeat explícito (reduz risco de conexões "zumbis" em redes instáveis)
  pingInterval: 25000,
  pingTimeout: 60000
});

// Make io available in routes
app.set('io', io);

// ============================================
// MIDDLEWARE
// ============================================

// Security
// FIX: helmet padrão (v7) aplica CSP restritivo ('script-src self') que quebra
// o admin panel (usa onclick inline). Configuração:
//   - API endpoints: helmet padrão (forte)
//   - /admin: helmet sem contentSecurityPolicy (admin é authenticated, baixo risco)
const helmetDefault = helmet({
  // FIX v8.0.5 SEC: headers extras de defesa em profundidade
  crossOriginEmbedderPolicy: { policy: 'require-corp' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
});
const helmetForAdmin = helmet({
  contentSecurityPolicy: false, // permite inline handlers do admin
  crossOriginEmbedderPolicy: false, // admin pode embed iframes para dashboards
  // mantém X-Frame-Options, X-Content-Type-Options, HSTS, etc.
});

// v9.0.0: CSP strict pra portal autenticado (login, dashboard, etc.)
const helmetForPortal = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // necessário pra inline scripts existentes do portal
        "https://unpkg.com",
        "https://cdn.jsdelivr.net",
        "https://browser.sentry-cdn.com",
        "https://js.stripe.com",
      ],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      frameSrc: ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'", "https://*.mercadopago.com.br", "https://checkout.stripe.com"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // permite Stripe / fontes externas
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
});

app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) {
    return helmetForAdmin(req, res, next);
  }
  // v9.0.0: páginas HTML públicas usam CSP strict
  const isPortalPage = /\.(html?)$/.test(req.path) ||
                       req.path === '/' ||
                       req.path.startsWith('/dashboard') ||
                       req.path.startsWith('/login') ||
                       req.path.startsWith('/signup');
  if (isPortalPage) {
    return helmetForPortal(req, res, next);
  }
  return helmetDefault(req, res, next);
});

// FIX v8.0.5 SEC: Permissions-Policy desabilita features que a API não usa.
// Reduz superfície de ataque mesmo se algum endpoint servir HTML acidentalmente.
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()'
  );
  next();
});

// CORS
app.use(cors({
  origin: config.cors.origin,
  credentials: true
}));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (config.env !== 'test') {
  app.use(morgan('combined', { stream: logger.stream }));
}

// AUDIT-NEW-017: Request ID middleware for structured logging
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('x-request-id', req.id);
  next();
});

// Rate limiting
app.use(rateLimiter);

// ============================================
// ROUTES
// ============================================

// Health check (simples — para load balancer)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: packageVersion,
    uptime: process.uptime()
  });
});

// v8.5.0: Deep health — verifica DB, Redis, providers de IA
app.get('/health/deep', async (req, res) => {
  const checks = {
    db: { status: 'unknown' },
    redis: { status: 'unknown' },
    ai_providers: { status: 'unknown' },
    email: { status: 'unknown' },
    webhook_inbox_pending: { status: 'unknown' },
    email_outbox_pending: { status: 'unknown' },
  };

// v9.3.9 SECURITY FIX: sanitiza error.message em /health/deep pra evitar leak
// de paths internos / colunas de DB pra atacante.
// Em dev mantém útil pra debug, em produção retorna apenas tipo do erro.
const sanitizeHealthError = (e) => {
  if (process.env.NODE_ENV === 'production') {
    return { name: e?.name || 'Error' };
  }
  return { error: e?.message };
};

  // Database check
  try {
    const db = require('./utils/database');
    const r = db.get('SELECT 1 as ok');
    checks.db = { status: r?.ok === 1 ? 'ok' : 'error' };
  } catch (e) { checks.db = { status: 'error', ...sanitizeHealthError(e) }; }

  // Redis check (se configurado)
  try {
    if (process.env.REDIS_URL && process.env.REDIS_DISABLED !== 'true') {
      const { createClient } = require('redis');
      const client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 2000 } });
      await client.connect();
      await client.ping();
      await client.quit();
      checks.redis = { status: 'ok' };
    } else {
      checks.redis = { status: 'disabled' };
    }
  } catch (e) { checks.redis = { status: 'error', ...sanitizeHealthError(e) }; }

  // AI providers check
  try {
    const router = require('./ai/services/AIRouterService');
    const stats = typeof router.getStats === 'function' ? router.getStats() : {};
    const providersOk = (stats.activeProviders || 0) > 0;
    checks.ai_providers = {
      status: providersOk ? 'ok' : 'warning',
      active: stats.activeProviders || 0,
      total: stats.totalProviders || 0,
    };
  } catch (e) { checks.ai_providers = { status: 'error', ...sanitizeHealthError(e) }; }

  // Email service
  try {
    const emailService = require('./services/EmailService');
    checks.email = {
      status: emailService.isConfigured() ? 'ok' : 'disabled',
      mode: emailService.dryRun ? 'dry-run' : 'live',
    };
  } catch (e) { checks.email = { status: 'error', ...sanitizeHealthError(e) }; }

  // Webhook inbox: alertar se houver muitos pendentes/falhos
  try {
    const db = require('./utils/database');
    const pending = db.get(
      `SELECT COUNT(*) as c FROM webhook_inbox WHERE status IN ('received', 'processing', 'failed') AND received_at > datetime('now', '-1 hour')`
    );
    const count = pending?.c || 0;
    checks.webhook_inbox_pending = {
      status: count > 50 ? 'warning' : 'ok',
      count,
    };
  } catch (e) { checks.webhook_inbox_pending = { status: 'unknown', ...sanitizeHealthError(e) }; }

  // Email outbox
  try {
    const db = require('./utils/database');
    const pending = db.get(`SELECT COUNT(*) as c FROM email_outbox WHERE status IN ('pending', 'failed')`);
    const count = pending?.c || 0;
    checks.email_outbox_pending = {
      status: count > 100 ? 'warning' : 'ok',
      count,
    };
  } catch (e) { checks.email_outbox_pending = { status: 'unknown', ...sanitizeHealthError(e) }; }

  // Status global = error se qualquer crítico falhou
  const critical = ['db'];
  const hasError = critical.some(k => checks[k].status === 'error');
  const hasWarning = Object.values(checks).some(c => c.status === 'warning');
  const overallStatus = hasError ? 'error' : (hasWarning ? 'degraded' : 'ok');

  res.status(hasError ? 503 : 200).json({
    status: overallStatus,
    version: packageVersion,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
  });
});

// v8.1.0: Operational metrics — /metrics/system e /metrics/health-deep são públicos.
// /metrics/tenants, /metrics/cost, /metrics/errors, /metrics/learning exigem JWT admin.
// v9.0.0: Prometheus metrics endpoint (público mas só local IP em prod)
app.get('/metrics/prometheus', prometheus.handleMetricsRequest);

app.use('/metrics', metricsRoutes);

// API Routes
app.use('/api/v1/auth', authRoutes);
// v9.0.0: 2FA TOTP
const auth2faModule = require('./routes/auth-2fa');
app.use('/api/v1/auth/2fa', auth2faModule.router);
app.use('/api/v1/users', usersRoutes);
// v8.3.0 - SaaS billing & customer portal routes
// IMPORTANTE: api-keys precisa vir ANTES porque é uma sub-rota de /users
app.use('/api/v1/users/api-keys', apiKeysRoutes);
app.use('/api/v1/subscription', subscriptionRoutes);
app.use('/api/v1/extension', extensionRoutes);
app.use('/api/v1/billing', billingRoutes);
app.use('/api/v1/ai-settings', aiSettingsRoutes);
// v9.0.0: Funnel tracking
app.use('/api/v1/funnel', require('./routes/funnel'));
// v9.0.0: Referrals
app.use('/api/v1/referrals', require('./routes/referrals').router);
// v9.0.0: User self-service (NPS, LGPD export/delete, onboarding)
app.use('/api/v1/me', require('./routes/me'));

// v9.2.0: Selector telemetry da extensão
app.use('/api/v1/telemetry', require('./routes/telemetry'));

// v9.0.0: OpenAPI spec
app.get('/openapi.json', (_req, res) => {
  try {
    const spec = require('../openapi.json');
    res.json(spec);
  } catch (e) {
    res.status(500).json({ error: 'OpenAPI spec not found' });
  }
});

// v9.0.0: Servir locales estáticos pra frontend i18n
app.get('/locales/:locale/:ns.json', (req, res) => {
  const { locale, ns } = req.params;
  // Validação contra path traversal
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(locale) || !/^[a-z][a-z_-]*$/i.test(ns)) {
    return res.status(400).json({ error: 'Invalid locale or namespace' });
  }
  const localePath = require('path').join(__dirname, '..', 'locales', locale, `${ns}.json`);
  if (!require('fs').existsSync(localePath)) {
    return res.status(404).json({ error: 'Locale not found' });
  }
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(localePath);
});

// v9.0.0: Public config (injeta vars públicas no frontend)
app.get('/config.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.set('Cache-Control', 'public, max-age=300'); // 5min cache
  const safeConfig = {
    APP_VERSION: require('../package.json').version,
    CRISP_WEBSITE_ID: process.env.CRISP_WEBSITE_ID || null,
    SENTRY_DSN_BROWSER: process.env.SENTRY_DSN_BROWSER || null,
    UMAMI_WEBSITE_ID: process.env.UMAMI_WEBSITE_ID || null,
    UMAMI_HOST: process.env.UMAMI_HOST || null,
    STRIPE_PUBLISHABLE_KEY: process.env.STRIPE_PUBLISHABLE_KEY || null,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || null,
  };
  res.send(`window.WHL_CONFIG = ${JSON.stringify(safeConfig)};`);
});
app.use('/api/v1/webhooks/payment', webhooksPaymentSaasRoutes);
// v9.0.0: Stripe webhooks
app.use('/api/v1/webhooks/payment', require('./routes/webhooks-stripe'));
// v8.4.0 - Tokens (saldo, histórico, pacotes)
app.use('/api/v1/tokens', tokensRoutes);
app.use('/api/v1/contacts', contactsRoutes);
app.use('/api/v1/conversations', conversationsRoutes);
app.use('/api/v1/campaigns', campaignsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/crm', crmRoutes);
app.use('/api/v1/tasks', tasksRoutes);
app.use('/api/v1/templates', templatesRoutes);
app.use('/api/v1/webhooks', webhooksRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v2/ai', aiV2Routes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/smartbot', smartbotRoutes);
app.use('/api/v1/smartbot-extended', smartbotExtendedRoutes);
app.use('/api/v1/smartbot-ai-plus', smartbotAIPlusRoutes);
// v9.3.0: maturity tracking — graduação training → ready → live (mount antes de /autopilot pra ter precedência)
app.use('/api/v1/autopilot/maturity', require('./routes/autopilot-maturity'));
app.use('/api/v1/autopilot', autopilotRoutes);
app.use('/api/v1/examples', examplesRoutes);
app.use('/api/v1/recover', recoverRoutes);
app.use('/api/recover', recoverSyncRoutes);
app.use('/api/v1/ai/learn', aiIngestRoutes); // Pilar 2: Endpoint de ingestão para aprendizado contínuo
app.use('/api/v1/sync', syncRoutes); // Sincronização bidirecional de dados
app.use('/api/v1/admin/kill-switch', adminKillSwitchRoutes);
app.use('/api/v1/admin', adminRoutes); // Painel Admin
app.use('/api/v1/subscription', paymentWebhooksRoutes); // Webhooks de pagamento e validação
app.use('/webhooks', paymentWebhooksRoutes); // Webhooks alternativos
app.use('/api/v1/jobs', jobsRoutes); // Jobs Runner API
app.use('/api/v1/memory', memoryRoutes); // Memória Híbrida "Leão"
// v9.3.3: embeddings — antes extensão chamava e dava 404, agora endpoint real com cache
app.use('/api/v1/embeddings', require('./routes/embeddings'));
app.use('/api/v1/knowledge', knowledgeRoutes); // Knowledge Management
app.use('/api/v1/speech', speechRoutes); // Speech-to-Text API
app.use('/api/v2/intelligence', intelligenceRoutes); // v10.1: commercial intelligence dashboard

// ============================================
// ADMIN PANEL WITH AUTHENTICATION
// ============================================

// Admin authentication middleware
const adminAuthMiddleware = (req, res, next) => {
  // AUDIT-NEW-007: Only accept token from Authorization header, NOT query string
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Admin Panel - Authentication Required</title></head>
      <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1>🔒 Authentication Required</h1>
        <p>Include the token in the Authorization header: <code>Bearer YOUR_JWT</code></p>
      </body>
      </html>
    `);
  }
  
  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    
    // Only owner and admin roles can access
    if (payload.role !== 'owner' && payload.role !== 'admin') {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Admin Panel - Forbidden</title></head>
        <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
          <h1>⛔ Access Denied</h1>
          <p>Admin or Owner role required to access this panel.</p>
        </body>
        </html>
      `);
    }
    
    // Store user info for potential use
    req.user = payload;
    next();
  } catch (err) {
    const safeMsg = String(err.message || 'Unknown error')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Admin Panel - Invalid Token</title></head>
      <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center;">
        <h1>❌ Invalid or Expired Token</h1>
        <p>${safeMsg}</p>
        <p>Please obtain a valid JWT token and try again.</p>
      </body>
      </html>
    `);
  }
};

// Admin Panel (arquivos estáticos) - NOW WITH AUTH!
app.use('/admin', adminAuthMiddleware, express.static(path.join(__dirname, '../admin')));
app.get('/admin', adminAuthMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/index.html'));
});

// v8.2.0: Public site (landing, login, signup, customer portal)
// Servido sem autenticação — o portal usa client-side JS para gate.
const PUBLIC_DIR = path.join(__dirname, '../public');
app.use(express.static(PUBLIC_DIR, {
  // não cachear HTML (sempre revalidar) — caching agressivo em CSS/JS
  setHeaders: (res, filepath) => {
    if (filepath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (filepath.match(/\.(css|js|png|jpg|svg|woff2?)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 24h
    }
  },
  extensions: ['html'],
}));

// Aliases sem .html (mais limpo na URL)
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html')));

// API Documentation
app.get('/api', (req, res) => {
  res.json({
    name: 'WhatsHybrid API',
    version: packageVersion,
    documentation: '/api/docs',
    endpoints: {
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      contacts: '/api/v1/contacts',
      conversations: '/api/v1/conversations',
      campaigns: '/api/v1/campaigns',
      analytics: '/api/v1/analytics',
      crm: '/api/v1/crm',
      tasks: '/api/v1/tasks',
      templates: '/api/v1/templates',
      webhooks: '/api/v1/webhooks',
      ai: '/api/v1/ai',
      settings: '/api/v1/settings',
      smartbot: '/api/v1/smartbot',
      'smartbot-extended': '/api/v1/smartbot-extended',
      'smartbot-ai-plus': '/api/v1/smartbot-ai-plus',
      'autopilot': '/api/v1/autopilot'
    }
  });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use(notFoundHandler);
// ── v9.0.0: Sentry captura erros 500+ ANTES do errorHandler do app ──
sentry.applyErrorHandler(app);

app.use(errorHandler);

// ============================================
// SOCKET.IO EVENTS WITH AUTHENTICATION
// ============================================

// Socket.IO authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  try {
    const payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    socket.userId = payload.userId;
    socket.workspaceId = payload.workspaceId;
    socket.userRole = payload.role;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id} (user: ${socket.userId})`);

  socket.on('join:user', (userId) => {
    // Only allow joining own room
    if (userId !== socket.userId) {
      logger.warn(`User ${socket.userId} attempted to join room for user ${userId}`);
      socket.emit('error', { message: 'Cannot join another user\'s room' });
      return;
    }
    socket.join(`user:${userId}`);
    logger.debug(`User ${userId} joined room`);
  });

  socket.on('join:workspace', (workspaceId) => {
    // Only allow joining own workspace
    if (workspaceId !== socket.workspaceId) {
      logger.warn(`User ${socket.userId} attempted to join workspace ${workspaceId} (owns ${socket.workspaceId})`);
      socket.emit('error', { message: 'Cannot join another workspace' });
      return;
    }
    socket.join(`workspace:${workspaceId}`);
    logger.debug(`Socket joined workspace ${workspaceId}`);
  });

  socket.on('disconnect', () => {
    logger.debug(`Socket disconnected: ${socket.id}`);
  });
});

// ============================================
// STARTUP
// ============================================

async function startServer() {
  try {
    // Initialize UUID module (ESM compatibility)
    const { initUUID } = require('./utils/uuid-wrapper');
    await initUUID();
    logger.info('UUID module initialized');

    // Initialize database
    await database.initialize();
    logger.info('Database initialized');

    // v9.5.0 BUG #148: rodar migrations explicitamente. Antes, o schema só
    // era aplicado quando código legado chamava database-legacy.initialize();
    // o server.js só chamava database.initialize() (driver) que só abre a
    // conexão. Resultado: tabelas (users, login_attempts, ...) não existiam,
    // qualquer endpoint authentication crashava com "no such table: users".
    try {
      await database.runMigrations();
      logger.info('Migrations applied');
    } catch (migErr) {
      logger.error('Falha ao aplicar migrations:', migErr);
      throw migErr;
    }

    // Initialize Jobs Runner
    // v9.5.0 BUG #145: passar `database` (wrapper com .run/.get/.all async) e
    // não `database.getDb()` (better-sqlite3 raw que expõe .prepare). Antes
    // crashava no boot com "db.all is not a function" e o catch escondia.
    try {
      await JobsRunner.initSchema(database);
      await JobsRunner.start(database);
      logger.info('Jobs Runner initialized');
    } catch (jobsError) {
      logger.warn(`Jobs Runner initialization skipped: ${jobsError.message}`);
    }

    // v9.5.0 BUG #142: seed-user.js nunca existiu. Try/catch escondia mas
    // gerava warning poluído todo boot em dev. Removido — não há seeds.
    // Schema é seedado via migrations + database-legacy.

    // Start server
    const PORT = config.port;
    server.listen(PORT, () => {
      logger.info(`
╔══════════════════════════════════════════════════╗
║   🚀 WhatsHybrid Backend Server                  ║
║   Version: ${packageVersion.padEnd(31)}║
║   Environment: ${config.env.padEnd(32)}║
║   Port: ${String(PORT).padEnd(39)}║
║   Database: better-sqlite3 (WAL, nativo)         ║
╚══════════════════════════════════════════════════╝
      `);

      // v8.3.0 - Inicia cron de billing (trial expiration, renewal check)
      try {
        const billingCron = require('./jobs/billingCron');
        billingCron.start();
      } catch (err) {
        logger.error('[Server] Falha ao iniciar billingCron:', err.message);
      }

      // v8.4.0 - Configura listeners de email transacional
      try {
        const emailListeners = require('./utils/emailListeners');
        emailListeners.setup();
      } catch (err) {
        logger.error('[Server] Falha ao configurar emailListeners:', err.message);
      }
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
// FIX v8.0.5: timeout forçado para garantir que o processo saia mesmo se
// alguma conexão HTTP ficar pendurada (long polling, websocket cliente travado).
const SHUTDOWN_TIMEOUT_MS = 30 * 1000;

function gracefulShutdown(signal) {
  logger.info(`${signal} received. Shutting down gracefully...`);
  
  // Limpar intervalos de webhooks de pagamento
  if (paymentWebhooksRoutes?.cleanup) {
    try {
      paymentWebhooksRoutes.cleanup();
    } catch (err) {
      logger.warn('Erro ao limpar intervalos de webhooks:', err.message);
    }
  }

  // v8.3.0 - Para o cron de billing
  try {
    require('./jobs/billingCron').stop();
  } catch (_) {}

  // Force exit if server.close() não retornar em 30s
  const forceExitTimer = setTimeout(() => {
    logger.error('Server did not close within 30s. Forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  if (forceExitTimer.unref) forceExitTimer.unref();

  server.close(() => {
    clearTimeout(forceExitTimer);
    logger.info('Server closed');
    // CORREÇÃO P1: Limpar OrchestratorRegistry no shutdown
    try {
      const orchReg = require('./registry/OrchestratorRegistry');
      orchReg.destroy();
    } catch (_) {}
    database.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// v8.1.0: alertas para erros não-tratados.
// Sem isso, o Node faz log silencioso e você descobre o crash horas depois.
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException:', err);
  try {
    const alertManager = require('./observability/alertManager');
    alertManager.send('critical', 'Uncaught Exception', {
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 8).join('\n'),
    });
  } catch (_) {}
  // Em produção: deixa o processo morrer e o orchestrator (PM2/Docker) reinicia.
  // Não tente continuar — o estado está incerto.
  if (process.env.NODE_ENV === 'production') {
    setTimeout(() => process.exit(1), 1000); // dá 1s para o alerta sair
  }
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('unhandledRejection at:', promise, 'reason:', reason);
  try {
    const alertManager = require('./observability/alertManager');
    alertManager.send('error', 'Unhandled Promise Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack?.split('\n').slice(0, 8).join('\n') : null,
    });
  } catch (_) {}
});

// Start
startServer();

module.exports = { app, server, io };