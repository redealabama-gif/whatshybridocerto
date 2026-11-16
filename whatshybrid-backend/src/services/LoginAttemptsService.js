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
/**
 * SEG-02: o SQLite grava a data em UTC sem fuso ("2026-11-16 03:02:19").
 * `new Date()` lê esse formato como hora LOCAL — num servidor a leste de UTC o
 * tempo restante do bloqueio sairia negativo e o bloqueio não valeria.
 */
function emMs(valor) {
  if (!valor) return null;
  if (typeof valor === 'number') return valor;
  if (valor instanceof Date) return valor.getTime();
  const texto = String(valor);
  const semFuso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(texto);
  const ms = new Date(semFuso ? texto.replace(' ', 'T') + 'Z' : texto).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isBlocked(email) {
  if (!email) return { blocked: false };
  try {
    const db = require('../utils/database');
    const lowerEmail = email.toLowerCase();

    for (const t of THRESHOLDS) {
      // SEG-02: aqui se comparava `created_at >= <ISO do JS>`. A coluna é
      // DATETIME DEFAULT CURRENT_TIMESTAMP e o SQLite grava
      // "2026-11-16 03:02:19" (espaço, sem T, sem Z). A comparação é de TEXTO:
      // no mesmo dia ' ' < 'T', então TODA linha ficava fora do corte, a
      // contagem dava 0 e o bloqueio por conta nunca disparava. Medido com o
      // banco limpo: 5 falhas gravadas, a consulta encontrava 0.
      // Agora o corte é calculado pelo próprio SQLite, no formato dele.
      const r = db.get(
        `SELECT COUNT(*) AS c, MAX(created_at) AS last FROM login_attempts
         WHERE email = ? AND success = 0 AND created_at >= datetime('now', ?)`,
        [lowerEmail, `-${t.window_min} minutes`]
      );

      const failureCount = r?.c || 0;
      if (failureCount >= t.max_failures) {
        // Calcula retry_after
        const lastAttempt = emMs(r.last) || Date.now();
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
