/**
 * 2FA TOTP Routes — v9.0.0
 *
 * Implementa Time-based One-Time Password seguindo RFC 6238.
 * Compatível com Google Authenticator, Authy, 1Password, etc.
 *
 * Fluxo:
 *   1. POST /2fa/setup       → gera secret + URL QR code
 *   2. POST /2fa/verify      → confirma código, ATIVA 2FA
 *   3. POST /2fa/disable     → desativa (precisa senha + código)
 *
 * Login com 2FA ativo:
 *   1. POST /auth/login     → retorna { requires_totp, pre_auth_token }
 *   2. POST /auth/login/totp → valida pre_auth_token + código → JWT
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');

const db = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// ── TOTP implementation ───────────────────────────────────────
// Implementação manual (RFC 6238) pra evitar dep. Funciona bem.

const ALGORITHM = 'sha1';
const DIGITS = 6;
const PERIOD = 30; // seconds

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.replace(/=+$/, '').toUpperCase();
  const bytes = [];
  let bits = 0, value = 0;
  for (const c of str) {
    const idx = alphabet.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTOTP(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 1000 / PERIOD);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(ALGORITHM, base32Decode(secret));
  hmac.update(counterBuf);
  const digest = hmac.digest();

  const offset = digest[digest.length - 1] & 0x0f;
  const code = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) % Math.pow(10, DIGITS);

  return code.toString().padStart(DIGITS, '0');
}

function verifyTOTP(secret, code, window = 1) {
  // Aceita ±1 período de tolerância (clock drift)
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    if (generateTOTP(secret, now + i * PERIOD * 1000) === code) {
      return true;
    }
  }
  return false;
}

function generateProvisioningURI(label, issuer, secret) {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: ALGORITHM.toUpperCase(),
    digits: DIGITS,
    period: PERIOD,
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}

// ── Routes ────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/2fa/setup
 * Gera secret e retorna URI pra QR code (cliente desenha o QR no browser)
 */
router.post('/setup', authenticate, asyncHandler(async (req, res) => {
  const user = db.get('SELECT id, email, totp_enabled FROM users WHERE id = ?', [req.userId]);
  if (!user) throw new AppError('User not found', 404);

  if (user.totp_enabled) {
    throw new AppError('2FA já está ativo. Desative primeiro para reconfigurar.', 400);
  }

  const secret = generateSecret();

  // Salva temporariamente (não ativa ainda — só ativa em /verify)
  db.run('UPDATE users SET totp_secret = ? WHERE id = ?', [secret, user.id]);

  const uri = generateProvisioningURI(user.email, 'WhatsHybrid Pro', secret);

  res.json({
    secret, // mostra pro user salvar como backup
    uri,    // QR code: o cliente desenha o QR usando a URI
    digits: DIGITS,
    period: PERIOD,
  });
}));

/**
 * POST /api/v1/auth/2fa/verify
 * Confirma que o usuário configurou o app authenticator e ativa 2FA
 */
router.post('/verify',
  authenticate,
  // v9.3.8 SECURITY: authLimiter previne brute-force do código TOTP de 6 dígitos
  // (1M combinações). Sem rate limit, atacante com sessão válida poderia
  // forçar ativação de 2FA com código gerado em outra máquina.
  authLimiter,
  [body('code').isLength({ min: 6, max: 6 }).isNumeric()],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError('Código inválido', 400);

    const user = db.get('SELECT id, totp_secret, totp_enabled FROM users WHERE id = ?', [req.userId]);
    if (!user || !user.totp_secret) {
      throw new AppError('Setup 2FA primeiro via /2fa/setup', 400);
    }
    if (user.totp_enabled) {
      throw new AppError('2FA já está ativo', 400);
    }

    if (!verifyTOTP(user.totp_secret, req.body.code)) {
      throw new AppError('Código inválido', 400);
    }

    db.run('UPDATE users SET totp_enabled = 1 WHERE id = ?', [user.id]);
    logger.info(`[2FA] Activated for user ${user.id}`);

    res.json({ ok: true, message: '2FA ativado com sucesso' });
  })
);

/**
 * POST /api/v1/auth/2fa/disable
 * Desativa 2FA. Precisa senha + código TOTP atual.
 */
router.post('/disable',
  authenticate,
  authLimiter,
  [
    body('password').isString().notEmpty(),
    body('code').isLength({ min: 6, max: 6 }).isNumeric(),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new AppError('Dados inválidos', 400);

    const user = db.get('SELECT id, password, totp_secret, totp_enabled FROM users WHERE id = ?', [req.userId]);
    if (!user || !user.totp_enabled) throw new AppError('2FA não está ativo', 400);

    const passwordOk = await bcrypt.compare(req.body.password, user.password);
    if (!passwordOk) throw new AppError('Senha incorreta', 401);

    if (!verifyTOTP(user.totp_secret, req.body.code)) {
      throw new AppError('Código TOTP inválido', 401);
    }

    db.run('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [user.id]);
    logger.info(`[2FA] Disabled for user ${user.id}`);

    res.json({ ok: true, message: '2FA desativado' });
  })
);

/**
 * GET /api/v1/auth/2fa/status
 * Status do 2FA do usuário atual
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const user = db.get('SELECT totp_enabled FROM users WHERE id = ?', [req.userId]);
  res.json({ enabled: !!user?.totp_enabled });
}));

module.exports = { router, verifyTOTP, generateSecret, generateProvisioningURI };
