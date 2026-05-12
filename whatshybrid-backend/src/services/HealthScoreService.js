/**
 * Health Score Service — v9.0.0
 *
 * Calcula score de saúde de cada workspace (0-100):
 *   30 pontos: % do plano consumido (mais consumo = mais saudável)
 *   20 pontos: dias desde último login (recente = saudável)
 *   20 pontos: % de mensagens IA com sucesso (vs erro)
 *   15 pontos: NPS (se respondeu)
 *   15 pontos: dias até próxima cobrança (longe = ok)
 *
 * Triggers:
 *   < 30: alerta no Discord pra intervenção manual
 *   30-50: email automático "tá tudo bem?"
 *   > 80: bom candidato pra pedir review/referral
 */

const logger = require('../utils/logger');

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function calculateScore(workspace) {
  const db = require('../utils/database');
  let score = 0;
  const reasons = [];

  // 30 pts: uso do plano (consumo de tokens)
  try {
    const consumed = db.get(
      `SELECT SUM(ABS(amount)) AS t FROM token_transactions
       WHERE workspace_id = ? AND type = 'consume' AND created_at >= datetime('now', '-30 days')`,
      [workspace.id]
    );
    // v9.4.6: balance via TokenService (workspaces.credits removido)
    const tokenService = require('./TokenService');
    const balanceInfo = tokenService.getBalance(workspace.id);
    const currentBalance = balanceInfo?.balance || 0;
    const planTotal = currentBalance + (consumed?.t || 0);
    const usageRatio = planTotal > 0 ? (consumed?.t || 0) / planTotal : 0;
    const usagePts = clamp(Math.round(usageRatio * 100), 0, 30);
    score += usagePts;
    if (usagePts < 10) reasons.push('low_usage');
  } catch (_) {}

  // 20 pts: atividade recente
  try {
    const lastLogin = db.get(
      `SELECT MAX(created_at) AS last FROM funnel_events
       WHERE workspace_id = ? AND step IN ('first_login', 'cta_clicked', 'extension_installed')`,
      [workspace.id]
    );
    const daysSinceLogin = lastLogin?.last
      ? Math.floor((Date.now() - new Date(lastLogin.last).getTime()) / 86400000)
      : 30;
    const activityPts = daysSinceLogin <= 1 ? 20 :
                        daysSinceLogin <= 3 ? 15 :
                        daysSinceLogin <= 7 ? 10 :
                        daysSinceLogin <= 14 ? 5 : 0;
    score += activityPts;
    if (activityPts < 10) reasons.push('inactive');
  } catch (_) {}

  // 20 pts: taxa de sucesso da IA
  try {
    const totalReq = db.get(
      `SELECT COUNT(*) AS c FROM ai_requests WHERE workspace_id = ? AND created_at >= datetime('now', '-7 days')`,
      [workspace.id]
    );
    const errors = db.get(
      `SELECT COUNT(*) AS c FROM ai_requests
       WHERE workspace_id = ? AND status = 'error' AND created_at >= datetime('now', '-7 days')`,
      [workspace.id]
    );
    const total = totalReq?.c || 0;
    const errCount = errors?.c || 0;
    const successRate = total > 0 ? (total - errCount) / total : 1;
    const aiPts = Math.round(successRate * 20);
    score += aiPts;
    if (aiPts < 10 && total > 5) reasons.push('high_ai_error_rate');
  } catch (_) {}

  // 15 pts: NPS médio
  try {
    const npsRow = db.get(
      `SELECT AVG(score) AS avg FROM nps_responses WHERE workspace_id = ?`,
      [workspace.id]
    );
    if (npsRow?.avg !== null && npsRow?.avg !== undefined) {
      const npsPts = clamp(Math.round((npsRow.avg / 10) * 15), 0, 15);
      score += npsPts;
      if (npsPts < 8) reasons.push('low_nps');
    } else {
      score += 8; // não respondeu — neutro
    }
  } catch (_) { score += 8; }

  // 15 pts: status de billing
  try {
    if (workspace.subscription_status === 'active') {
      score += 15;
    } else if (workspace.subscription_status === 'trialing') {
      score += 10;
    } else if (workspace.subscription_status === 'past_due') {
      score += 3;
      reasons.push('past_due');
    } else {
      reasons.push('inactive_subscription');
    }
  } catch (_) {}

  return {
    score: clamp(score, 0, 100),
    reasons,
  };
}

function updateAllHealthScores() {
  const db = require('../utils/database');
  let updated = 0, alerts = 0;

  try {
    const workspaces = db.all(
      `SELECT id, subscription_status FROM workspaces
       WHERE subscription_status IN ('active', 'trialing', 'past_due')`
    );

    for (const ws of workspaces) {
      try {
        const { score, reasons } = calculateScore(ws);
        db.run(
          `UPDATE workspaces SET health_score = ?, health_score_updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [score, ws.id]
        );
        updated++;

        // Alerta crítico se score < 30
        if (score < 30) {
          alerts++;
          try {
            const alertManager = require('../observability/alertManager');
            alertManager?.send?.('warning', `⚠️ Workspace em risco: score ${score}`, {
              workspace_id: ws.id,
              reasons: reasons.join(', '),
            });
          } catch (_) {}
        }
      } catch (e) {
        logger.warn(`[HealthScore] Failed for ${ws.id}: ${e.message}`);
      }
    }
  } catch (err) {
    logger.error(`[HealthScore] updateAll error: ${err.message}`);
  }

  if (updated > 0) {
    logger.info(`[HealthScore] Updated ${updated} workspaces, ${alerts} alerts`);
  }
  return { updated, alerts };
}

module.exports = { calculateScore, updateAllHealthScores };
