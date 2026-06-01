/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const { body, validationResult } = require('express-validator');

const config = require('../../config');
const db = require('../utils/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { authLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

// Preços mensais (BRL) usados para o `value` dos eventos de StartTrial.
// Mantenha em sincronia com whatshybrid-backend/public/index.html (Pricing
// section) e MercadoPagoService.PLAN_PRICES.
const PLAN_MONTHLY_PRICE_BRL = {
  free: 0,
  starter: 49.90,
  pro: 99.90,
};

/**
 * Dispara eventos Meta CAPI após signup bem-sucedido (manual ou Google).
 * Retorna { complete_registration, start_trial? } com event_ids para o
 * front-end ECOAR via `fbq('track', evt, data, { eventID: id })` — sem
 * isso, browser pixel + CAPI são contabilizados em dobro.
 */
async function fireSignupCapi({
  email, name, plan, userId, attribution, req, includeStartTrial,
}) {
  const capi = require('../services/MetaCapiService');
  const ids = { complete_registration: uuidv4() };
  if (includeStartTrial) ids.start_trial = uuidv4();

  // Sem env vars do CAPI, retornamos os IDs mesmo assim (o browser pixel
  // ainda pode usá-los) mas pulamos o HTTP call.
  if (!capi.isConfigured()) return ids;

  // Split do nome em fn/ln (melhora match rate)
  const parts = String(name || '').trim().split(/\s+/);
  const firstName = parts[0] || undefined;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;

  const baseUserData = capi.buildUserData({
    email,
    firstName,
    lastName,
    externalId: userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    ...capi.userDataFromAttribution(attribution),
  });

  const sourceUrl = req.headers.referer ||
    `https://${req.headers.host || 'whatshybrid.com.br'}/signup.html`;

  // Disparos paralelos — não bloqueia resposta. Erros são logados pelo service.
  capi.sendEvent({
    eventName: 'CompleteRegistration',
    eventId: ids.complete_registration,
    eventSourceUrl: sourceUrl,
    userData: baseUserData,
    customData: {
      content_name: 'Plano ' + plan,
      content_category: 'signup',
      status: true,
      currency: 'BRL',
      value: 0,
    },
  });

  if (includeStartTrial) {
    const monthly = PLAN_MONTHLY_PRICE_BRL[plan] || 0;
    capi.sendEvent({
      eventName: 'StartTrial',
      eventId: ids.start_trial,
      eventSourceUrl: sourceUrl,
      userData: baseUserData,
      customData: {
        content_name: 'Plano ' + plan,
        content_category: 'trial',
        currency: 'BRL',
        value: monthly,
        predicted_ltv: monthly * 12,
      },
    });
  }

  return ids;
}

// Generate tokens
function generateTokens(userId) {
  const accessToken = jwt.sign(
    { userId },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  // v8.5.0 — armazena hash SHA-256 do refresh (não plaintext)
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  db.run(
    'INSERT INTO refresh_tokens (id, user_id, token, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), userId, refreshToken, tokenHash, expiresAt.toISOString()]
  );

  return { accessToken, refreshToken };
}

/**
 * @route POST /api/v1/auth/register
 * @desc Register new user
 */
router.post('/register',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('name').trim().notEmpty()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name } = req.body;

    // Check if user exists
    const existingUser = db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      throw new AppError('Email already registered', 400, 'EMAIL_EXISTS');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create workspace
    const workspaceId = uuidv4();
    const userId = uuidv4();

    db.transaction(() => {
      // Create user
      db.run(
        `INSERT INTO users (id, email, password, name, role, workspace_id) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, email, hashedPassword, name, 'owner', workspaceId]
      );

      // Create workspace
      db.run(
        `INSERT INTO workspaces (id, name, owner_id, credits) 
         VALUES (?, ?, ?, ?)`,
        [workspaceId, `${name}'s Workspace`, userId, 100]
      );

      // Create default pipeline stages
      const stages = [
        { name: 'Lead', color: '#3b82f6', position: 0 },
        { name: 'Qualificado', color: '#8b5cf6', position: 1 },
        { name: 'Proposta', color: '#f59e0b', position: 2 },
        { name: 'Negociação', color: '#ef4444', position: 3 },
        { name: 'Fechado', color: '#10b981', position: 4 }
      ];

      stages.forEach(stage => {
        db.run(
          'INSERT INTO pipeline_stages (id, workspace_id, name, color, position) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), workspaceId, stage.name, stage.color, stage.position]
        );
      });

      // Create default labels
      const labels = [
        { name: 'VIP', color: '#fbbf24' },
        { name: 'Novo', color: '#3b82f6' },
        { name: 'Recorrente', color: '#10b981' },
        { name: 'Pendente', color: '#ef4444' }
      ];

      labels.forEach(label => {
        db.run(
          'INSERT INTO labels (id, workspace_id, name, color) VALUES (?, ?, ?, ?)',
          [uuidv4(), workspaceId, label.name, label.color]
        );
      });
    });

    // Generate tokens
    const tokens = generateTokens(userId);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: userId,
        email,
        name,
        workspaceId
      },
      ...tokens
    });
  })
);

/**
 * @route POST /api/v1/auth/signup
 * @desc v8.2.0 — Signup público com seleção de plano e trial automático.
 * Aceita campos extras (company, plan) que /register não tem, e configura
 * trial de 7 dias. Usado pelo signup.html.
 */
router.post('/signup',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('name').trim().notEmpty(),
    body('company').trim().isLength({ min: 2, max: 100 }),
    body('plan').optional().isIn(['starter', 'pro', 'free']),
    body('coupon').optional().isString().isLength({ min: 3, max: 32 }),
    body('attribution').optional().isObject(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array(), error: errors.array()[0]?.msg });
    }

    const { email, password, name, company, plan = 'pro', coupon, attribution } = req.body;

    // Email já existe?
    const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      throw new AppError('Email já cadastrado', 400, 'EMAIL_EXISTS');
    }

    // Valida cupom ANTES de criar a conta. Se for inválido, não falha o
    // signup — só ignora silenciosamente (UX importa mais que a promo).
    // Plano 'free' ignora cupom porque não cobra nada.
    let validatedCoupon = null;
    if (coupon && plan !== 'free') {
      try {
        const couponService = require('../services/CouponService');
        const v = couponService.validate(coupon, plan);
        if (v.valid) {
          validatedCoupon = {
            code: v.coupon.code,
            label: v.coupon.description || v.coupon.code,
          };
        } else {
          // Log mas não falha — usuário não deve perder o signup por isso
          require('../utils/logger').info(
            `[Signup] Coupon "${coupon}" ignored: ${v.reason} (email=${email})`
          );
        }
      } catch (e) {
        require('../utils/logger').warn('[Signup] Coupon validation error:', e.message);
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const workspaceId = uuidv4();
    const userId = uuidv4();

    // Trial de 7 dias
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7);
    const trialEndISO = trialEnd.toISOString();

    const attributionJson = attribution ? JSON.stringify(attribution) : null;

    db.transaction(() => {
      db.run(
        `INSERT INTO users (id, email, password, name, role, workspace_id, signup_attribution)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, email, hashedPassword, name, 'owner', workspaceId, attributionJson]
      );

      // workspaces.coupon_code é populado já na criação se tiver cupom
      // válido. coupon_applied_at = agora; coupon_first_invoice_used_at
      // permanece NULL até a 1ª invoice ser gerada.
      if (validatedCoupon) {
        db.run(
          `INSERT INTO workspaces (id, name, owner_id, plan, trial_end_at,
             subscription_status, credits, coupon_code, coupon_applied_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [workspaceId, company, userId, plan, trialEndISO, 'trialing', 100,
           validatedCoupon.code]
        );
      } else {
        db.run(
          `INSERT INTO workspaces (id, name, owner_id, plan, trial_end_at, subscription_status, credits)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [workspaceId, company, userId, plan, trialEndISO, 'trialing', 100]
        );
      }

      // Pipeline stages padrão (mesmo que /register)
      const stages = [
        { name: 'Lead', color: '#3b82f6', position: 0 },
        { name: 'Qualificado', color: '#8b5cf6', position: 1 },
        { name: 'Proposta', color: '#f59e0b', position: 2 },
        { name: 'Negociação', color: '#ef4444', position: 3 },
        { name: 'Fechado', color: '#10b981', position: 4 }
      ];
      stages.forEach(stage => {
        db.run(
          'INSERT INTO pipeline_stages (id, workspace_id, name, color, position) VALUES (?, ?, ?, ?, ?)',
          [uuidv4(), workspaceId, stage.name, stage.color, stage.position]
        );
      });

      // Labels padrão
      ['VIP', 'Novo', 'Recorrente', 'Pendente'].forEach((labelName, i) => {
        const colors = ['#fbbf24', '#3b82f6', '#10b981', '#ef4444'];
        db.run(
          'INSERT INTO labels (id, workspace_id, name, color) VALUES (?, ?, ?, ?)',
          [uuidv4(), workspaceId, labelName, colors[i]]
        );
      });
    });

    const tokens = generateTokens(userId);

    // Tenta enviar alerta para o owner do SaaS (você) sobre novo signup
    try {
      const alertManager = require('../observability/alertManager');
      alertManager.send('info', '🎉 Novo signup', {
        email, company, plan,
        coupon: validatedCoupon ? validatedCoupon.code : null,
      });
    } catch (_) {}

    // v8.4.0 — concede tokens iniciais do plano para o trial
    try {
      const tokenService = require('../services/TokenService');
      tokenService.resetMonthlyForPlan(workspaceId, plan);
    } catch (e) {
      // Não bloqueia signup se o TokenService falhar
    }

    // v8.4.0 — emite evento user.signup para enviar welcome email
    try {
      const events = require('../utils/events');
      events.emit('user.signup', { email, name, plan, trialDays: 7, workspace_id: workspaceId });
    } catch (_) {}

    // Meta Conversions API: dispara CompleteRegistration (sempre) + StartTrial
    // (planos pagos). Event IDs são retornados para o front-end usar como
    // `eventID` no fbq() do browser e a Meta deduplicar. Não-blocking — falhas
    // de marketing não devem afetar a criação da conta.
    const metaEventIds = await fireSignupCapi({
      email, name, plan, userId, attribution, req,
      includeStartTrial: plan === 'starter' || plan === 'pro',
    });

    res.status(201).json({
      message: 'Conta criada com sucesso',
      user: { id: userId, email, name, workspaceId, role: 'owner' },
      workspace: { id: workspaceId, name: company, plan, trial_end_at: trialEndISO },
      coupon: validatedCoupon, // null se não houve cupom ou se foi inválido
      meta_event_ids: metaEventIds,
      ...tokens,
    });
  })
);

/**
 * @route POST /api/v1/auth/login
 * @desc Login user
 */
router.post('/login',
  authLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // ── v9.2.0: rate limit por email (defesa contra distributed brute force) ──
    const loginAttempts = require('../services/LoginAttemptsService');
    const blockCheck = loginAttempts.isBlocked(email);
    if (blockCheck.blocked) {
      try {
        require('../services/AuditLogService').log({
          action: 'security.rate_limit_hit',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: { email_hash: require('crypto').createHash('sha256').update(email).digest('hex').substring(0, 16), reason: blockCheck.reason },
          outcome: 'denied',
        });
      } catch (_) {}
      res.set('Retry-After', String(blockCheck.retry_after_seconds));
      throw new AppError(
        req.t ? req.t('errors.too_many_attempts') : `Muitas tentativas. Tente novamente em ${Math.ceil(blockCheck.retry_after_seconds / 60)} minutos.`,
        429,
        'TOO_MANY_ATTEMPTS'
      );
    }

    // Find user
    const user = db.get(
      'SELECT id, email, password, name, role, workspace_id, status, totp_enabled FROM users WHERE email = ?',
      [email]
    );

    if (!user) {
      loginAttempts.recordAttempt(email, req.ip, false);
      try {
        require('../services/AuditLogService').log({
          action: 'user.login_failed',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          metadata: { reason: 'user_not_found' },
          outcome: 'failure',
        });
      } catch (_) {}
      throw new AppError(req.t ? req.t('errors.invalid_credentials') : 'Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    if (user.status !== 'active') {
      loginAttempts.recordAttempt(email, req.ip, false);
      try {
        require('../services/AuditLogService').log({
          userId: user.id, workspaceId: user.workspace_id,
          action: 'user.login_failed',
          ip: req.ip, userAgent: req.headers['user-agent'],
          metadata: { reason: 'account_inactive', status: user.status },
          outcome: 'denied',
        });
      } catch (_) {}
      throw new AppError(req.t ? req.t('errors.account_inactive') : 'Account is not active', 403, 'ACCOUNT_INACTIVE');
    }

    // Check password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      loginAttempts.recordAttempt(email, req.ip, false);
      try {
        require('../services/AuditLogService').log({
          userId: user.id, workspaceId: user.workspace_id,
          action: 'user.login_failed',
          ip: req.ip, userAgent: req.headers['user-agent'],
          metadata: { reason: 'wrong_password' },
          outcome: 'failure',
        });
      } catch (_) {}
      throw new AppError(req.t ? req.t('errors.invalid_credentials') : 'Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    // ── v9.0.0: 2FA TOTP ──
    if (user.totp_enabled) {
      // Gera pre_auth_token válido por 5 minutos
      const preAuthToken = jwt.sign(
        { userId: user.id, type: 'pre_auth_2fa' },
        config.jwt.secret,
        { expiresIn: '5m' }
      );
      return res.json({
        requires_totp: true,
        pre_auth_token: preAuthToken,
        message: 'Insira o código do seu app authenticator',
      });
    }

    // Login bem-sucedido — registra
    loginAttempts.recordAttempt(email, req.ip, true);
    try {
      require('../services/AuditLogService').log({
        userId: user.id, workspaceId: user.workspace_id,
        action: 'user.login',
        ip: req.ip, userAgent: req.headers['user-agent'],
        metadata: { method: 'password' },
        outcome: 'success',
      });
    } catch (_) {}

    // Generate tokens
    const tokens = generateTokens(user.id);

    // Get workspace info
    const workspace = db.get(
      'SELECT id, name, plan FROM workspaces WHERE id = ?',
      [user.workspace_id]
    );

    // v9.4.6: balance via TokenService (workspaces.credits removido)
    if (workspace) {
      try {
        const tokenService = require('../services/TokenService');
        const balance = tokenService.getBalance(user.workspace_id);
        workspace.balance = balance?.balance || 0;
        workspace.credits = workspace.balance; // compat de frontend antigo
      } catch (_) {
        workspace.balance = 0;
        workspace.credits = 0;
      }
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workspaceId: user.workspace_id
      },
      workspace,
      ...tokens
    });
  })
);

/**
 * @route POST /api/v1/auth/login/totp
 * @desc Step 2 do login quando 2FA está ativo
 */
router.post('/login/totp',
  authLimiter,
  [
    body('pre_auth_token').isString().notEmpty(),
    body('code').isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError(req.t ? req.t('errors.validation_failed') : 'Dados inválidos', 400);

    const { pre_auth_token, code } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(pre_auth_token, config.jwt.secret, { algorithms: ['HS256'] });
    } catch (e) {
      throw new AppError(req.t ? req.t('errors.pre_auth_token_invalid') : 'pre_auth_token inválido ou expirado', 401);
    }

    if (decoded.type !== 'pre_auth_2fa') {
      throw new AppError(req.t ? req.t('errors.pre_auth_token_invalid') : 'Token type inválido', 400);
    }

    const user = db.get(
      'SELECT id, email, name, role, workspace_id, totp_secret FROM users WHERE id = ?',
      [decoded.userId]
    );
    if (!user || !user.totp_secret) throw new AppError(req.t ? req.t('errors.user_not_found') : 'Conta inválida', 401);

    const { verifyTOTP } = require('./auth-2fa');
    if (!verifyTOTP(user.totp_secret, code)) {
      throw new AppError(req.t ? req.t('errors.totp_invalid') : 'Código TOTP inválido', 401);
    }

    const tokens = generateTokens(user.id);
    const workspace = db.get(
      'SELECT id, name, plan FROM workspaces WHERE id = ?',
      [user.workspace_id]
    );

    // v9.4.6: balance via TokenService
    if (workspace) {
      try {
        const tokenService = require('../services/TokenService');
        const balance = tokenService.getBalance(user.workspace_id);
        workspace.balance = balance?.balance || 0;
        workspace.credits = workspace.balance;
      } catch (_) {
        workspace.balance = 0;
        workspace.credits = 0;
      }
    }

    res.json({
      message: 'Login successful',
      user: {
        id: user.id, email: user.email, name: user.name,
        role: user.role, workspaceId: user.workspace_id,
      },
      workspace,
      ...tokens,
    });
  })
);

/**
 * @route POST /api/v1/auth/refresh
 * @desc Refresh access token
 */
router.post('/refresh',
  // v9.3.8 SECURITY: authLimiter pra prevenir brute force de refresh tokens.
  // Antes: endpoint sem rate limit — atacante com lista de tokens vazados podia
  // tentar milhares por minuto até achar um válido.
  authLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError('Refresh token required', 400);
    }

    // Verify JWT signature
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.secret, { algorithms: ['HS256'] });
    } catch (jwtError) {
      throw new AppError('Invalid refresh token', 401, 'TOKEN_INVALID');
    }

    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 400);
    }

    // v8.5.0 — usa hash do token no DB (não armazena plano)
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    const storedToken = db.get(
      `SELECT * FROM refresh_tokens
       WHERE (token_hash = ? OR token = ?) AND user_id = ?`,
      [tokenHash, refreshToken, decoded.userId]
    );

    if (!storedToken) {
      // Token JWT válido mas não está no DB — pode ser:
      // (a) já foi rotacionado (reuso) → ataque potencial, invalida TUDO
      // (b) revogado por logout
      logger.warn(`[Auth] Refresh token reuse detected for user ${decoded.userId} - invalidating all sessions`);
      db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [decoded.userId]);

      // v9.2.0: alerta crítico — possível comprometimento de conta
      try {
        const targetUser = db.get('SELECT id, email, name, workspace_id FROM users WHERE id = ?', [decoded.userId]);
        if (targetUser) {
          // Audit log
          require('../services/AuditLogService').log({
            userId: targetUser.id, workspaceId: targetUser.workspace_id,
            action: 'user.refresh_token_reuse_detected',
            ip: req.ip, userAgent: req.headers['user-agent'],
            metadata: { all_sessions_revoked: true },
            outcome: 'denied',
          });

          // Email pro user
          (async () => {
            try {
              const emailService = require('../services/EmailService');
              if (emailService.isConfigured()) {
                await emailService.send({
                  to: targetUser.email,
                  subject: '🛡️ Atividade suspeita detectada na sua conta',
                  html: emailService._wrap({
                    title: 'Detectamos atividade suspeita',
                    preheader: 'Por segurança, suas sessões foram revogadas',
                    body: `
                      <p>Olá ${emailService._escape(targetUser.name || '')},</p>
                      <p>Detectamos uso de um token de autenticação que já havia sido usado.
                         Isso é uma forte indicação de tentativa de comprometimento da conta.</p>
                      <p><strong>Ação tomada:</strong> Por segurança, revogamos todas as sessões ativas
                         da sua conta. Você precisará fazer login novamente em todos os dispositivos.</p>
                      <p><strong>Recomendado:</strong></p>
                      <ul>
                        <li>Trocar sua senha imediatamente</li>
                        <li>Ativar 2FA se ainda não está ativo</li>
                        <li>Revisar dispositivos com acesso (em Configurações)</li>
                      </ul>
                      <p>Se foi você quem usou um token velho (ex: navegador antigo), pode ignorar.
                         Se não foi você, troque a senha agora.</p>
                      <p><strong>IP detectado:</strong> ${emailService._escape(req.ip || '?')}<br>
                         <strong>Quando:</strong> ${new Date().toLocaleString('pt-BR')}</p>
                    `,
                    ctaLabel: 'Trocar senha agora',
                    ctaUrl: `${process.env.PUBLIC_BASE_URL}/forgot-password.html`,
                  }),
                });
              }
            } catch (emailErr) {
              logger.warn(`[Auth] Reuse email failed: ${emailErr.message}`);
            }
          })();

          // Discord alert
          try {
            const alertManager = require('../observability/alertManager');
            alertManager?.send?.('warning', '🛡️ Refresh token reuse detectado', {
              user_id: targetUser.id,
              user_email_hash: require('crypto').createHash('sha256').update(targetUser.email).digest('hex').substring(0, 16),
              ip: req.ip,
              workspace_id: targetUser.workspace_id,
            });
          } catch (_) {}
        }
      } catch (alertErr) {
        logger.warn(`[Auth] Reuse alert chain failed: ${alertErr.message}`);
      }

      throw new AppError('Token reutilizado — todas as sessões foram invalidadas por segurança', 401, 'TOKEN_REUSE');
    }

    // Check expiration
    if (new Date(storedToken.expires_at) < new Date()) {
      db.run('DELETE FROM refresh_tokens WHERE id = ?', [storedToken.id]);
      throw new AppError('Refresh token expired', 401);
    }

    // Delete old token (rotação obrigatória)
    db.run('DELETE FROM refresh_tokens WHERE id = ?', [storedToken.id]);

    // Generate new tokens (que JÁ insere hash via generateTokens)
    const tokens = generateTokens(decoded.userId);

    res.json({
      message: 'Token refreshed',
      ...tokens
    });
  })
);

/**
 * @route POST /api/v1/auth/logout
 * @desc Logout user
 */
router.post('/logout',
  authenticate,
  asyncHandler(async (req, res) => {
    // Delete all refresh tokens for user
    db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [req.userId]);

    res.json({
      message: 'Logged out successfully'
    });
  })
);

/**
 * @route GET /api/v1/auth/me
 * @desc Get current user
 */
router.get('/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = db.get(
      `SELECT u.id, u.email, u.name, u.avatar, u.phone, u.role, u.workspace_id, u.settings,
              w.name as workspace_name, w.plan, w.credits,
              w.trial_end_at, w.subscription_status, w.next_billing_at,
              w.payment_provider, w.mp_preapproval_id, w.stripe_subscription_id,
              w.auto_renew_enabled, w.past_due_since, w.dunning_attempts
       FROM users u
       JOIN workspaces w ON u.workspace_id = w.id
       WHERE u.id = ?`,
      [req.userId]
    );

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        phone: user.phone,
        role: user.role,
        settings: JSON.parse(user.settings || '{}')
      },
      workspace: {
        id: user.workspace_id,
        name: user.workspace_name,
        plan: user.plan,
        credits: user.credits,
        trial_end_at: user.trial_end_at,
        subscription_status: user.subscription_status,
        next_billing_at: user.next_billing_at,
        payment_provider: user.payment_provider || null,
        mp_preapproval_id: user.mp_preapproval_id || null,
        stripe_subscription_id: user.stripe_subscription_id || null,
        auto_renew_enabled: user.auto_renew_enabled === 1,
        past_due_since: user.past_due_since || null,
        dunning_attempts: user.dunning_attempts || 0,
      }
    });
  })
);

/**
 * @route PUT /api/v1/auth/password
 * @desc Change password
 */
router.put('/password',
  authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 })
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;

    const user = db.get('SELECT password FROM users WHERE id = ?', [req.userId]);

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new AppError('Current password is incorrect', 400);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    db.run('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedPassword, req.userId]
    );

    // Invalidate all refresh tokens
    db.run('DELETE FROM refresh_tokens WHERE user_id = ?', [req.userId]);

    res.json({
      message: 'Password changed successfully'
    });
  })
);

/**
 * @route POST /api/v1/auth/forgot-password — v8.5.0
 * Solicita link de redefinição de senha. SEMPRE retorna 200, mesmo que email
 * não exista, para não vazar informação sobre quais emails estão cadastrados
 * (proteção contra ataques de enumeração).
 */
router.post('/forgot-password',
  authLimiter,
  [body('email').isEmail().normalizeEmail()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Mesmo se email inválido, retorna 200 (segurança)
      return res.json({ ok: true, message: 'Se o email existir, link foi enviado' });
    }

    const { email } = req.body;
    const user = db.get('SELECT id, name, email FROM users WHERE email = ?', [email]);

    if (user) {
      // Gera token de reset (válido por 1 hora)
      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      try {
        db.run(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at)
           VALUES (?, ?, ?, ?, NULL)`,
          [uuidv4(), user.id, tokenHash, expiresAt]
        );

        // Envia email com link
        try {
          const emailService = require('../services/EmailService');
          const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
          const resetUrl = `${baseUrl}/reset-password.html?token=${resetToken}`;

          const html = emailService._wrap({
            title: '🔑 Redefinir sua senha',
            preheader: 'Link válido por 1 hora',
            body: `
              <p>Olá ${emailService._escape(user.name)},</p>
              <p>Recebemos um pedido para redefinir sua senha do WhatsHybrid Pro.</p>
              <p>Este link expira em <strong>1 hora</strong>. Se você não solicitou, ignore este email.</p>
            `,
            ctaLabel: 'Redefinir senha',
            ctaUrl: resetUrl,
          });

          await emailService.send({
            to: user.email,
            subject: 'Redefinir senha — WhatsHybrid Pro',
            html,
          });
        } catch (emailErr) {
          logger.warn(`[ForgotPassword] Email failed: ${emailErr.message}`);
        }
      } catch (dbErr) {
        logger.error(`[ForgotPassword] DB error: ${dbErr.message}`);
      }
    }

    // Sempre retorna sucesso (segurança)
    res.json({ ok: true, message: 'Se o email existir, link de redefinição foi enviado' });
  })
);

/**
 * @route POST /api/v1/auth/reset-password — v8.5.0
 * Redefine senha usando token recebido por email.
 */
router.post('/reset-password',
  authLimiter,
  [
    body('token').isLength({ min: 32, max: 128 }).isHexadecimal(),
    body('password').isLength({ min: 8 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Dados inválidos', 400);
    }

    const { token, password } = req.body;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetRecord = db.get(
      `SELECT id, user_id, expires_at, used_at
       FROM password_reset_tokens
       WHERE token_hash = ?`,
      [tokenHash]
    );

    if (!resetRecord) throw new AppError('Token inválido', 400);
    if (resetRecord.used_at) throw new AppError('Token já utilizado', 400);
    if (new Date(resetRecord.expires_at) < new Date()) {
      throw new AppError('Token expirado. Solicite um novo link.', 400);
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    db.transaction(() => {
      db.run(`UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [hashedPassword, resetRecord.user_id]);
      db.run(`UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [resetRecord.id]);
      // Revoga todos os refresh tokens (logout em todos os devices)
      db.run(`DELETE FROM refresh_tokens WHERE user_id = ?`, [resetRecord.user_id]);
    });

    logger.info(`[ResetPassword] Password reset for user ${resetRecord.user_id}`);

    res.json({ ok: true, message: 'Senha redefinida com sucesso' });
  })
);

/**
 * POST /api/v1/auth/master-token
 *
 * Troca a master key (env SUBSCRIPTION_MASTER_KEY, default 'Cristi@no123')
 * por um JWT enterprise. Não exige email/senha — destinado a uso pelo dono
 * do app pra destravar a extensão sem fluxo de signup.
 *
 * Cria (ou reutiliza) uma workspace "dev" e um user "owner" associado.
 * Idempotente: chamadas subsequentes retornam o JWT pro mesmo user.
 *
 * Body: { code: string }
 * Retorna: { accessToken, refreshToken, user, workspace }
 *
 * Segurança: a master key vive em env. Em produção, defina algo forte
 * em SUBSCRIPTION_MASTER_KEY ou setando MASTER_TOKEN_ENABLED=false desabilita.
 */
router.post('/master-token', authLimiter, asyncHandler(async (req, res) => {
  if (process.env.MASTER_TOKEN_ENABLED === 'false') {
    throw new AppError('Master token desabilitado', 403, 'MASTER_DISABLED');
  }
  const code = String(req.body?.code || '').trim();
  if (!code) throw new AppError('code obrigatório', 400);

  // SECURITY: fallback hardcoded só em dev. Em prod sem
  // SUBSCRIPTION_MASTER_KEY definida, o endpoint rejeita qualquer code
  // — evita que a master key vazada no source habilite enterprise pra
  // qualquer um.
  const MASTER_KEY = process.env.SUBSCRIPTION_MASTER_KEY
    || (process.env.NODE_ENV === 'production' ? '' : 'Cristi@no123');
  if (!MASTER_KEY) {
    throw new AppError('Master token desabilitado: SUBSCRIPTION_MASTER_KEY não configurada', 403, 'MASTER_DISABLED');
  }
  // Constant-time compare
  const a = Buffer.from(code);
  const b = Buffer.from(MASTER_KEY);
  const ok = a.length === b.length && (() => {
    try { return crypto.timingSafeEqual(a, b); } catch (_) { return false; }
  })();
  if (!ok) {
    // Pausa pra desencorajar brute-force (authLimiter já cobre via rate-limit).
    await new Promise(r => setTimeout(r, 500));
    throw new AppError('Master key inválida', 401, 'MASTER_INVALID');
  }

  // Verifica se workspace "dev" já existe
  let workspace = db.get(
    `SELECT id, name, owner_id, plan, credits FROM workspaces WHERE name = ? LIMIT 1`,
    ['Master Workspace']
  );
  let user;
  if (workspace) {
    user = db.get('SELECT id, email, name, role, workspace_id FROM users WHERE id = ?', [workspace.owner_id]);
  }

  if (!workspace || !user) {
    // Criação idempotente: cria workspace+user enterprise
    const userId = uuidv4();
    const workspaceId = uuidv4();
    // Senha aleatória — não é usada (login é via master-token, não senha)
    const randomPwd = crypto.randomBytes(32).toString('hex');
    const hashedPwd = await bcrypt.hash(randomPwd, 12);

    // sqlite-driver.transaction(fn) já executa fn() e retorna o resultado.
    // Chamar com () de novo dispara "db.transaction(...) is not a function"
    // e quebra TODO o fluxo do master-token (extensão fica sem JWT, todos
    // os módulos caem em "Backend não configurado").
    db.transaction(() => {
      db.run(
        `INSERT INTO users (id, email, password, name, role, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, 'master@whatshybrid.local', hashedPwd, 'Master', 'owner', workspaceId]
      );
      db.run(
        `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status, credits)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [workspaceId, 'Master Workspace', userId, 'enterprise', 'active', 999999]
      );
    });
    workspace = { id: workspaceId, name: 'Master Workspace', owner_id: userId, plan: 'enterprise', credits: 999999 };
    user = { id: userId, email: 'master@whatshybrid.local', name: 'Master', role: 'owner', workspace_id: workspaceId };

    // Sem isso, /ai/complete rejeita com 402 INSUFFICIENT_CREDITS porque
    // workspaces.credits (legado) ≠ workspace_credits (TokenService = fonte
    // da verdade). Crédito 999M = praticamente ilimitado pra dev/master.
    try {
      const tokenService = require('../services/TokenService');
      tokenService.credit(workspaceId, 999_000_000, 'plan_grant', {
        description: 'Master workspace bootstrap (enterprise)'
      });
    } catch (e) {
      logger.warn('[Auth] master-token: falha ao alocar tokens (continua):', e?.message || e);
    }
    logger.info('[Auth] Master workspace + user created (enterprise tokens credited)');
  }

  const tokens = generateTokens(user.id);
  logger.info(`[Auth] Master token issued for user=${user.id}`);
  res.json({
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user,
    workspace: { id: workspace.id, plan: workspace.plan || 'enterprise', credits: workspace.credits || 999999 }
  });
}));

// ─────────────────────────────────────────────────────────────────────
// Google OAuth (Sign in with Google)
// ─────────────────────────────────────────────────────────────────────

let googleClient = null;
function getGoogleClient() {
  if (!config.googleOAuth.clientId) return null;
  if (!googleClient) {
    const { OAuth2Client } = require('google-auth-library');
    googleClient = new OAuth2Client(config.googleOAuth.clientId);
  }
  return googleClient;
}

/**
 * @route GET /api/v1/auth/google/config
 * @desc Public Google client ID for the frontend to initialize GIS.
 *       Returns { clientId: null } when not configured so the frontend
 *       hides the button gracefully.
 */
router.get('/google/config', (req, res) => {
  res.json({ clientId: config.googleOAuth.clientId || null });
});

/**
 * @route POST /api/v1/auth/google
 * @desc Login or signup via Google id_token. Single endpoint handles both:
 *       - existing user (matched by google_sub, then by email) → log in
 *         (and link google_sub on first time if matched by email)
 *       - new user → create account + workspace + trial (mirrors /signup)
 *
 * Body: { credential: string, plan?: 'free'|'starter'|'pro' }
 *   - `credential` is the JWT id_token returned by Google Identity Services
 *   - `plan` is only used when creating a new account; defaults to 'free'
 */
router.post('/google',
  authLimiter,
  [
    body('credential').isString().notEmpty(),
    body('plan').optional().isIn(['free', 'starter', 'pro']),
    body('attribution').optional().isObject(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new AppError('Dados inválidos', 400);
    }

    const client = getGoogleClient();
    if (!client) {
      throw new AppError(
        'Login com Google não está configurado neste servidor',
        503,
        'GOOGLE_OAUTH_DISABLED'
      );
    }

    const { credential, plan = 'free', attribution } = req.body;

    // Verify id_token with Google. verifyIdToken checks signature, expiry,
    // and `aud` claim against our clientId.
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: config.googleOAuth.clientId,
      });
      payload = ticket.getPayload();
    } catch (err) {
      logger.warn(`Google id_token verification failed: ${err.message}`);
      throw new AppError('Credencial Google inválida', 401, 'GOOGLE_TOKEN_INVALID');
    }

    if (!payload || !payload.sub || !payload.email) {
      throw new AppError('Credencial Google sem dados necessários', 401, 'GOOGLE_TOKEN_INVALID');
    }
    if (payload.email_verified === false) {
      throw new AppError('Email Google não verificado', 403, 'GOOGLE_EMAIL_UNVERIFIED');
    }

    const googleSub = payload.sub;
    const email = String(payload.email).toLowerCase();
    const name = payload.name || email.split('@')[0];

    // Resolve user: google_sub first (canonical), then email (linking case).
    let user = db.get(
      'SELECT id, email, name, role, workspace_id, status, google_sub FROM users WHERE google_sub = ?',
      [googleSub]
    );
    let linkedByEmail = false;
    if (!user) {
      user = db.get(
        'SELECT id, email, name, role, workspace_id, status, google_sub FROM users WHERE email = ?',
        [email]
      );
      if (user) {
        db.run('UPDATE users SET google_sub = ? WHERE id = ?', [googleSub, user.id]);
        user.google_sub = googleSub;
        linkedByEmail = true;
      }
    }

    let isNewUser = false;
    if (user) {
      if (user.status !== 'active') {
        throw new AppError('Conta inativa', 403, 'ACCOUNT_INACTIVE');
      }
      try {
        require('../services/AuditLogService').log({
          userId: user.id, workspaceId: user.workspace_id,
          action: 'user.login',
          ip: req.ip, userAgent: req.headers['user-agent'],
          metadata: { method: 'google', linked_by_email: linkedByEmail },
          outcome: 'success',
        });
      } catch (_) {}
    } else {
      // New account — mirror /signup
      isNewUser = true;
      const userId = uuidv4();
      const workspaceId = uuidv4();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 7);
      const trialEndISO = trialEnd.toISOString();

      // users.password is NOT NULL. Store bcrypt of random bytes so any
      // password-based login attempt against this account is impossible.
      // User must keep using Google or go through forgot-password.
      const placeholderPassword = await bcrypt.hash(
        crypto.randomBytes(32).toString('hex'),
        12
      );

      const workspaceName = name && name.trim() ? name.trim() : email.split('@')[0];

      const googleAttributionJson = attribution ? JSON.stringify(attribution) : null;

      db.transaction(() => {
        db.run(
          `INSERT INTO users (id, email, password, name, role, workspace_id, google_sub, signup_attribution)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, email, placeholderPassword, name, 'owner', workspaceId, googleSub, googleAttributionJson]
        );
        db.run(
          `INSERT INTO workspaces (id, name, owner_id, plan, trial_end_at, subscription_status, credits)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [workspaceId, workspaceName, userId, plan, trialEndISO, 'trialing', 100]
        );

        const stages = [
          { name: 'Lead', color: '#3b82f6', position: 0 },
          { name: 'Qualificado', color: '#8b5cf6', position: 1 },
          { name: 'Proposta', color: '#f59e0b', position: 2 },
          { name: 'Negociação', color: '#ef4444', position: 3 },
          { name: 'Fechado', color: '#10b981', position: 4 },
        ];
        stages.forEach(stage => {
          db.run(
            'INSERT INTO pipeline_stages (id, workspace_id, name, color, position) VALUES (?, ?, ?, ?, ?)',
            [uuidv4(), workspaceId, stage.name, stage.color, stage.position]
          );
        });
        ['VIP', 'Novo', 'Recorrente', 'Pendente'].forEach((labelName, i) => {
          const colors = ['#fbbf24', '#3b82f6', '#10b981', '#ef4444'];
          db.run(
            'INSERT INTO labels (id, workspace_id, name, color) VALUES (?, ?, ?, ?)',
            [uuidv4(), workspaceId, labelName, colors[i]]
          );
        });
      });

      try {
        const tokenService = require('../services/TokenService');
        tokenService.resetMonthlyForPlan(workspaceId, plan);
      } catch (_) {}

      try {
        const events = require('../utils/events');
        events.emit('user.signup', {
          email, name, plan, trialDays: 7, workspace_id: workspaceId, method: 'google',
        });
      } catch (_) {}

      try {
        const alertManager = require('../observability/alertManager');
        alertManager.send('info', '🎉 Novo signup (Google)', { email, name, plan });
      } catch (_) {}

      try {
        require('../services/AuditLogService').log({
          userId, workspaceId,
          action: 'user.signup',
          ip: req.ip, userAgent: req.headers['user-agent'],
          metadata: { method: 'google', plan },
          outcome: 'success',
        });
      } catch (_) {}

      user = { id: userId, email, name, role: 'owner', workspace_id: workspaceId };
    }

    const tokens = generateTokens(user.id);

    const workspace = db.get(
      'SELECT id, name, plan FROM workspaces WHERE id = ?',
      [user.workspace_id]
    );
    if (workspace) {
      try {
        const tokenService = require('../services/TokenService');
        const balance = tokenService.getBalance(user.workspace_id);
        workspace.balance = balance?.balance || 0;
        workspace.credits = workspace.balance;
      } catch (_) {
        workspace.balance = 0;
        workspace.credits = 0;
      }
    }

    // Meta CAPI: só dispara para signups novos (não login). Mesma lógica do
    // /signup manual — IDs retornados para dedup com browser pixel.
    let metaEventIds;
    if (isNewUser) {
      metaEventIds = await fireSignupCapi({
        email: user.email,
        name: user.name,
        plan: workspace?.plan || plan,
        userId: user.id,
        attribution,
        req,
        includeStartTrial: (workspace?.plan || plan) === 'starter' ||
                           (workspace?.plan || plan) === 'pro',
      });
    }

    res.status(isNewUser ? 201 : 200).json({
      message: isNewUser ? 'Conta criada com sucesso via Google' : 'Login realizado via Google',
      isNewUser,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        workspaceId: user.workspace_id,
      },
      workspace,
      ...(metaEventIds && { meta_event_ids: metaEventIds }),
      ...tokens,
    });
  })
);

module.exports = router;
