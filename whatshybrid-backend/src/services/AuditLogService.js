/**
 * Audit Log Service — v9.2.0
 *
 * Registro imutável de ações sensíveis. Cumpre LGPD + apoia investigação
 * de incidentes.
 *
 * Uso:
 *   const audit = require('./AuditLogService');
 *   audit.log({
 *     userId: req.userId,
 *     workspaceId: req.workspaceId,
 *     action: 'user.login',
 *     ip: req.ip,
 *     userAgent: req.headers['user-agent'],
 *     metadata: { method: '2fa' },
 *     outcome: 'success',
 *   });
 *
 * Actions canônicas (use estas, não invente):
 *   user.login, user.login_failed, user.logout,
 *   user.password_changed, user.password_reset_requested,
 *   user.2fa_enabled, user.2fa_disabled,
 *   user.signup, user.account_deleted, user.email_changed,
 *   user.refresh_token_reuse_detected,
 *   billing.plan_changed, billing.payment_succeeded, billing.payment_failed,
 *   billing.subscription_cancelled,
 *   admin.login, admin.user_modified, admin.workspace_modified,
 *   workspace.member_added, workspace.member_removed,
 *   data.export_requested, data.deletion_requested,
 *   ai.settings_changed,
 *   security.suspicious_activity, security.rate_limit_hit
 */

const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const logger = require('../utils/logger').logger;

function safeStringify(obj) {
  if (obj == null) return null;
  try {
    const { sanitize } = require('../utils/logger');
    return JSON.stringify(sanitize(obj)).substring(0, 4000);
  } catch (_) {
    return null;
  }
}

/**
 * Registra evento de auditoria. Best-effort — falha NÃO interrompe a
 * operação principal.
 *
 * @param {object} entry
 * @param {string} entry.action — required, formato 'recurso.ação'
 * @param {string} [entry.userId]
 * @param {string} [entry.workspaceId]
 * @param {string} [entry.resourceType]
 * @param {string} [entry.resourceId]
 * @param {string} [entry.ip]
 * @param {string} [entry.userAgent]
 * @param {object} [entry.metadata]
 * @param {'success'|'failure'|'denied'} [entry.outcome] — default 'success'
 */
function log(entry) {
  if (!entry?.action) return;

  try {
    const db = require('../utils/database');
    db.run(
      `INSERT INTO audit_log
        (id, user_id, workspace_id, action, resource_type, resource_id,
         ip, user_agent, metadata, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        entry.userId || null,
        entry.workspaceId || null,
        entry.action,
        entry.resourceType || null,
        entry.resourceId || null,
        entry.ip ? String(entry.ip).substring(0, 50) : null,
        entry.userAgent ? String(entry.userAgent).substring(0, 300) : null,
        safeStringify(entry.metadata),
        entry.outcome || 'success',
      ]
    );
  } catch (err) {
    // Falha em audit log não pode interromper request — só loga warning
    logger.warn(`[AuditLog] Failed: ${err.message}`, { action: entry.action });
  }
}

/**
 * Busca histórico de auditoria de um usuário ou workspace
 */
function search({ userId, workspaceId, action, since, limit = 100 }) {
  const db = require('../utils/database');
  const conditions = [];
  const params = [];

  if (userId) { conditions.push('user_id = ?'); params.push(userId); }
  if (workspaceId) { conditions.push('workspace_id = ?'); params.push(workspaceId); }
  if (action) { conditions.push('action = ?'); params.push(action); }
  if (since) { conditions.push('created_at >= ?'); params.push(since); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  return db.all(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ?`,
    [...params, Math.min(limit, 1000)]
  );
}

/**
 * Express middleware que injeta req.audit() — versão pré-preenchida com
 * userId/workspaceId/ip/userAgent já capturados
 */
function middleware() {
  return (req, _res, next) => {
    req.audit = (entry) => log({
      userId: req.userId || req.user?.id,
      workspaceId: req.workspaceId || req.user?.workspace_id,
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
      ...entry,
    });
    next();
  };
}

module.exports = { log, search, middleware };
