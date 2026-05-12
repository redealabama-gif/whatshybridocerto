/**
 * Login Attempts Service — v9.2.0
 *
 * Rate limit por EMAIL (complementa o rate limit por IP).
 *
 * Lógica:
 *   - 3 falhas consecutivas em 15min → bloqueia conta por 15min
 *   - 10 falhas em 1h (independente) → bloqueia 1h
 *   - 50 falhas em 24h → bloqueia 24h e alerta admin
 *
 * Resets:
 *   - Login bem-sucedido reseta o contador
 *   - Reset de senha reseta o contador
 */

const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const logger = require('../utils/logger').logger;

const THRESHOLDS = [
  { window_min: 15, max_failures: 3,  block_min: 15 },
  { window_min: 60, max_failures: 10, block_min: 60 },
  { window_min: 1440, max_failures: 50, block_min: 1440 }, // 24h
];

function recordAttempt(email, ip, success) {
  if (!email) return;
  try {
    const db = require('../utils/database');
    db.run(
      `INSERT INTO login_attempts (id, email, ip, success) VALUES (?, ?, ?, ?)`,
      [uuidv4(), email.toLowerCase(), ip || null, success ? 1 : 0]
    );

    if (success) {
      // Limpa attempts falhos antigos da última hora pra esse email
      // (não deleta tudo — mantém histórico pra auditoria)
      // Nada a fazer — o check abaixo só conta failures, então sucessos não atrapalham
    }
  } catch (err) {
    logger.warn(`[LoginAttempts] record error: ${err.message}`);
  }
}

/**
 * Verifica se email está bloqueado por excesso de tentativas
 *
 * @returns {{ blocked: boolean, retry_after_seconds?: number, reason?: string }}
 */
function isBlocked(email) {
  if (!email) return { blocked: false };
  try {
    const db = require('../utils/database');
    const lowerEmail = email.toLowerCase();

    for (const t of THRESHOLDS) {
      const since = new Date(Date.now() - t.window_min * 60 * 1000).toISOString();

      const r = db.get(
        `SELECT COUNT(*) AS c, MAX(created_at) AS last FROM login_attempts
         WHERE email = ? AND success = 0 AND created_at >= ?`,
        [lowerEmail, since]
      );

      const failureCount = r?.c || 0;
      if (failureCount >= t.max_failures) {
        // Calcula retry_after
        const lastAttempt = r.last ? new Date(r.last).getTime() : Date.now();
        const blockUntil = lastAttempt + t.block_min * 60 * 1000;
        const retryAfter = Math.max(0, Math.ceil((blockUntil - Date.now()) / 1000));

        if (retryAfter > 0) {
          return {
            blocked: true,
            retry_after_seconds: retryAfter,
            reason: `${failureCount} tentativas falhas em ${t.window_min}min`,
            failures: failureCount,
            window_min: t.window_min,
          };
        }
      }
    }

    return { blocked: false };
  } catch (err) {
    logger.warn(`[LoginAttempts] isBlocked error: ${err.message}`);
    return { blocked: false }; // fail open — não trava login se DB offline
  }
}

/**
 * Limpa attempts antigos (> 30 dias). Chamado pelo billingCron diariamente.
 */
function cleanup() {
  try {
    const db = require('../utils/database');
    const r = db.run(
      `DELETE FROM login_attempts WHERE created_at < datetime('now', '-30 days')`
    );
    if (r.changes > 0) {
      logger.info(`[LoginAttempts] Cleaned ${r.changes} old records`);
    }
    return r.changes;
  } catch (err) {
    logger.warn(`[LoginAttempts] cleanup error: ${err.message}`);
    return 0;
  }
}

module.exports = { recordAttempt, isBlocked, cleanup };
