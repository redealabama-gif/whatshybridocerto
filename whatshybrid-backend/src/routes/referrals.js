/**
 * Referral System — v9.0.0
 *
 * Cada usuário tem código único (primeiros 8 chars do user_id).
 * Quem indica ganha 50.000 tokens quando o indicado completa primeiro
 * pagamento.
 *
 * Endpoints:
 *   GET  /api/v1/referrals/code      → código + URL pra compartilhar
 *   GET  /api/v1/referrals           → lista indicações do user
 *   GET  /api/v1/referrals/stats     → totais + tokens ganhos
 *
 * Hook: ao fazer signup com ?ref=ABC12345, cria registro pendente.
 * Hook: ao processar webhook de pagamento, se for primeiro pagamento
 *       do usuário e ele veio de referral, credita o referrer.
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

const db = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const REFERRAL_REWARD_TOKENS = parseInt(process.env.REFERRAL_REWARD_TOKENS, 10) || 50000;

/**
 * GET /code — retorna código único e URL pra compartilhar
 */
router.get('/code', authenticate, asyncHandler(async (req, res) => {
  const code = req.userId.substring(0, 8).toUpperCase();
  const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({
    code,
    url: `${baseUrl}/signup.html?ref=${code}`,
    reward_tokens: REFERRAL_REWARD_TOKENS,
    description: `Indique o WhatsHybrid Pro e ganhe ${REFERRAL_REWARD_TOKENS.toLocaleString('pt-BR')} tokens quando seu amigo virar cliente pagante.`,
  });
}));

/**
 * GET / — lista indicações do usuário atual
 */
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const referrals = db.all(
    `SELECT id, referred_email, status, reward_tokens, reward_paid_at, created_at
     FROM referrals
     WHERE referrer_user_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    [req.userId]
  );
  res.json({ referrals });
}));

/**
 * GET /stats — total de indicações + tokens ganhos
 */
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const total = db.get(
    `SELECT COUNT(*) as c FROM referrals WHERE referrer_user_id = ?`,
    [req.userId]
  );
  const converted = db.get(
    `SELECT COUNT(*) as c, SUM(reward_tokens) as total_tokens
     FROM referrals
     WHERE referrer_user_id = ? AND status = 'converted'`,
    [req.userId]
  );
  const pending = db.get(
    `SELECT COUNT(*) as c FROM referrals
     WHERE referrer_user_id = ? AND status IN ('pending', 'signed_up')`,
    [req.userId]
  );

  res.json({
    total: total?.c || 0,
    converted: converted?.c || 0,
    pending: pending?.c || 0,
    total_tokens_earned: converted?.total_tokens || 0,
  });
}));

/**
 * Helper: registra um referral quando alguém faz signup com ?ref=
 * Chamado a partir do /auth/signup
 */
function registerReferral(referralCode, referredEmail) {
  if (!referralCode) return null;
  const referrer = db.get(
    `SELECT id, workspace_id FROM users WHERE id LIKE ?`,
    [referralCode.toLowerCase() + '%']
  );
  if (!referrer) return null;

  const id = uuidv4();
  try {
    db.run(
      `INSERT INTO referrals (id, referrer_user_id, referrer_workspace_id, referred_email, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [id, referrer.id, referrer.workspace_id, referredEmail]
    );
    logger.info(`[Referrals] New: ${referrer.id} → ${referredEmail}`);
    return id;
  } catch (err) {
    logger.warn(`[Referrals] Insert failed: ${err.message}`);
    return null;
  }
}

/**
 * Helper: marca referral como convertido + credita tokens
 * Chamado quando webhook de pagamento processa primeiro pagamento
 */
async function processReferralConversion(payerUserId) {
  try {
    const referral = db.get(
      `SELECT r.* FROM referrals r
       JOIN users u ON u.email = r.referred_email
       WHERE u.id = ? AND r.status IN ('pending', 'signed_up')
       LIMIT 1`,
      [payerUserId]
    );
    if (!referral) return null;

    db.transaction(() => {
      db.run(
        `UPDATE referrals SET status = 'converted', reward_tokens = ?,
                              reward_paid_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [REFERRAL_REWARD_TOKENS, referral.id]
      );
    });

    // Credita tokens via TokenService
    try {
      const tokenService = require('../services/TokenService');
      await tokenService.credit(referral.referrer_workspace_id, REFERRAL_REWARD_TOKENS, {
        type: 'referral_reward',
        metadata: { referral_id: referral.id, referred_email: referral.referred_email },
      });
    } catch (tokErr) {
      logger.error(`[Referrals] Token credit failed: ${tokErr.message}`);
    }

    // Email de confirmação
    try {
      const emailService = require('../services/EmailService');
      const referrer = db.get('SELECT email, name FROM users WHERE id = ?', [referral.referrer_user_id]);
      if (referrer && emailService.isConfigured()) {
        await emailService.send({
          to: referrer.email,
          subject: `🎉 Você ganhou ${REFERRAL_REWARD_TOKENS.toLocaleString('pt-BR')} tokens!`,
          html: emailService._wrap({
            title: '🎉 Indicação convertida!',
            preheader: 'Sua indicação virou cliente pagante',
            body: `
              <p>Olá ${emailService._escape(referrer.name || '')},</p>
              <p>Que notícia boa! ${emailService._escape(referral.referred_email)} acabou de virar cliente pagante.</p>
              <p>Como agradecimento, creditamos <strong>${REFERRAL_REWARD_TOKENS.toLocaleString('pt-BR')} tokens</strong> na sua conta.</p>
              <p>Continue indicando e ganhando!</p>
            `,
            ctaLabel: 'Ver minhas indicações',
            ctaUrl: `${process.env.PUBLIC_BASE_URL}/dashboard.html#referrals`,
          }),
        });
      }
    } catch (mailErr) {
      logger.warn(`[Referrals] Email failed: ${mailErr.message}`);
    }

    logger.info(`[Referrals] Converted ${referral.id}: ${REFERRAL_REWARD_TOKENS} tokens credited to ${referral.referrer_user_id}`);
    return referral;
  } catch (err) {
    logger.error(`[Referrals] processReferralConversion error: ${err.message}`);
    return null;
  }
}

module.exports = { router, registerReferral, processReferralConversion };
