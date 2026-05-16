/**
 * TokenService - v8.4.0
 *
 * Gerencia o saldo de tokens (créditos de IA) por workspace.
 *
 * Modelo:
 *   - Cliente compra plano → recebe X tokens iniciais (plan_grant)
 *   - Cliente envia mensagem que consome IA → tokens são debitados (consume)
 *   - Cliente compra pacote avulso → tokens são adicionados (topup)
 *   - Renovação mensal → reseta para o limite do plano (plan_renewal)
 *
 * Toda operação é atômica via SQLite transaction e gera linha em token_transactions
 * (auditoria imutável).
 *
 * Por que tokens (e não R$)?
 *   - Cliente entende: usa modelo igual ao ChatGPT/Claude
 *   - Backend cobra REAL custo: você sabe quanto cada model consome
 *   - Markup transparente: você vende 1 token = 0.5 token real (markup 100%)
 */

const db = require('../utils/database');
const { v4: uuidv4 } = require('../utils/uuid-wrapper');
const logger = require('../utils/logger');

// ── Limites iniciais por plano (em tokens) ───────────────────────
// Estes são tokens VENDIDOS (markup já incluído).
// Custo real estimado: gpt-4o input ~$2.50/M, output ~$10/M.
// 50k tokens vendidos ≈ $0.40 custo real → markup ~10x sobre tokens premium
const PLAN_TOKENS = {
  free:       0,           // sem IA no plano free
  starter:    50_000,      // 50k tokens/mês (cobre ~250 mensagens médias)
  pro:        500_000,     // 500k tokens/mês (cobre ~2500 mensagens médias)
  agency:     5_000_000,   // 5M tokens/mês
  enterprise: 999_000_000, // efetivamente ilimitado (usado por master workspaces internos)
};

// ── Pacotes avulsos para topup (em centavos BRL para precisão) ───
const TOKEN_PACKAGES = {
  pack_10k:  { tokens: 10_000,  price_brl_cents: 1900,  label: '10k tokens — R$ 19,00' },
  pack_50k:  { tokens: 50_000,  price_brl_cents: 7900,  label: '50k tokens — R$ 79,00' },
  pack_200k: { tokens: 200_000, price_brl_cents: 24900, label: '200k tokens — R$ 249,00' },
  pack_1M:   { tokens: 1_000_000, price_brl_cents: 99900, label: '1M tokens — R$ 999,00' },
};

const LOW_BALANCE_THRESHOLD = 0.10; // 10% restante dispara alerta

class TokenService {
  /**
   * Garante que existe linha em workspace_credits. Cria se necessário.
   * @returns {Object} { workspace_id, tokens_total, tokens_used }
   */
  ensureRow(workspaceId) {
    let row = db.get(
      `SELECT workspace_id, tokens_total, tokens_used FROM workspace_credits WHERE workspace_id = ?`,
      [workspaceId]
    );
    if (!row) {
      db.run(
        `INSERT INTO workspace_credits (workspace_id, tokens_total, tokens_used) VALUES (?, 0, 0)`,
        [workspaceId]
      );
      row = { workspace_id: workspaceId, tokens_total: 0, tokens_used: 0 };
    }
    return row;
  }

  /**
   * Saldo atual.
   */
  getBalance(workspaceId) {
    const row = this.ensureRow(workspaceId);
    const balance = row.tokens_total - row.tokens_used;
    return {
      total: row.tokens_total,
      used: row.tokens_used,
      balance: Math.max(0, balance),
      utilization_pct: row.tokens_total > 0
        ? Math.round((row.tokens_used / row.tokens_total) * 100)
        : 0,
    };
  }

  /**
   * Saldo + status de baixo nível
   */
  getStatus(workspaceId) {
    const balance = this.getBalance(workspaceId);
    const threshold = balance.total * LOW_BALANCE_THRESHOLD;
    return {
      ...balance,
      low_balance: balance.balance > 0 && balance.balance < threshold,
      empty: balance.balance <= 0,
    };
  }

  /**
   * Adiciona tokens (topup, plan_grant ou renewal).
   * Operação ATÔMICA via transaction.
   *
   * @param {string} workspaceId
   * @param {number} amount — tokens a adicionar (positivo)
   * @param {string} type — 'topup' | 'plan_grant' | 'plan_renewal' | 'adjustment' | 'refund'
   * @param {Object} [opts] — { description, invoice_id, metadata }
   */
  credit(workspaceId, amount, type, opts = {}) {
    if (amount <= 0) throw new Error('Amount deve ser positivo');
    if (!['topup', 'plan_grant', 'plan_renewal', 'adjustment', 'refund'].includes(type)) {
      throw new Error(`Tipo inválido: ${type}`);
    }

    this.ensureRow(workspaceId);
    let balanceAfter = 0;
    let alreadyCredited = false;

    db.transaction(() => {
      // v9.3.9 IDEMPOTÊNCIA: se invoice_id já foi creditado, retorna sem
      // duplicar. Defende contra webhook retransmitido (MP/Stripe podem
      // mandar mesma notificação 2-3x se backend lento). Sem isso, cliente
      // ganhava 2x ou 3x os tokens da compra.
      if (opts.invoice_id) {
        const existing = db.get(
          `SELECT id, balance_after FROM token_transactions
           WHERE workspace_id = ? AND invoice_id = ? AND type = ?
           LIMIT 1`,
          [workspaceId, opts.invoice_id, type]
        );
        if (existing) {
          alreadyCredited = true;
          balanceAfter = existing.balance_after;
          logger.info(`[Tokens] Idempotency: invoice_id=${opts.invoice_id} já creditado, ignorando`);
          return;
        }
      }

      // Atualiza saldo
      db.run(
        `UPDATE workspace_credits
         SET tokens_total = tokens_total + ?,
             last_topup_at = CURRENT_TIMESTAMP,
             low_balance_warned_at = NULL,    -- reseta o aviso de saldo baixo
             updated_at = CURRENT_TIMESTAMP
         WHERE workspace_id = ?`,
        [amount, workspaceId]
      );

      // Recalcula saldo
      const row = db.get(
        `SELECT tokens_total, tokens_used FROM workspace_credits WHERE workspace_id = ?`,
        [workspaceId]
      );
      balanceAfter = row.tokens_total - row.tokens_used;

      // Auditoria
      db.run(
        `INSERT INTO token_transactions
          (id, workspace_id, type, amount, balance_after, invoice_id, description, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          workspaceId,
          type,
          amount,
          balanceAfter,
          opts.invoice_id || null,
          opts.description || `${type}: +${amount} tokens`,
          JSON.stringify(opts.metadata || {}),
        ]
      );
    });

    if (alreadyCredited) {
      return { balance_after: balanceAfter, idempotent: true };
    }
    logger.info(`[Tokens] +${amount} (${type}) for ws=${workspaceId}, new balance=${balanceAfter}`);
    return { balance_after: balanceAfter };
  }

  /**
   * Reseta o consumo do mês e concede novamente os tokens do plano.
   * Chamado pelo cron de billing após pagamento confirmado de renovação.
   *
   * v9.3.9: aceita opts.invoice_id pra idempotência (defesa contra retransmissão
   * de webhook). Se mesma invoice já foi processada, retorna sem duplicar reset.
   */
  resetMonthlyForPlan(workspaceId, plan, opts = {}) {
    const grant = PLAN_TOKENS[plan] || 0;
    if (grant <= 0) return { balance_after: 0 };

    return db.transaction(() => {
      // v9.3.9 IDEMPOTÊNCIA: já processou esta invoice?
      if (opts.invoice_id) {
        const existing = db.get(
          `SELECT balance_after FROM token_transactions
           WHERE workspace_id = ? AND invoice_id = ? AND type = 'plan_renewal'
           LIMIT 1`,
          [workspaceId, opts.invoice_id]
        );
        if (existing) {
          logger.info(`[Tokens] Idempotency: renewal invoice=${opts.invoice_id} já aplicada`);
          return { balance_after: existing.balance_after, idempotent: true };
        }
      }

      // Zera consumo, define total para o grant (não acumula sobras do mês anterior)
      db.run(
        `UPDATE workspace_credits
         SET tokens_total = ?,
             tokens_used = 0,
             last_topup_at = CURRENT_TIMESTAMP,
             low_balance_warned_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE workspace_id = ?`,
        [grant, workspaceId]
      );

      this.ensureRow(workspaceId);
      db.run(
        `INSERT INTO token_transactions
          (id, workspace_id, type, amount, balance_after, invoice_id, description)
         VALUES (?, ?, 'plan_renewal', ?, ?, ?, ?)`,
        [uuidv4(), workspaceId, grant, grant, opts.invoice_id || null, `Renovação mensal: ${plan}`]
      );

      logger.info(`[Tokens] Renewal for ws=${workspaceId} plan=${plan}: ${grant} tokens`);
      return { balance_after: grant };
    });
    // v9.4.6 BUG #125 CRÍTICO: removido `()` de `db.transaction(...)()` — chamada dupla.
    // O driver sqlite-driver.js já invoca `wrapped()` internamente. Adicionar `()`
    // tentava executar o RESULT (objeto) como função → TypeError em runtime.
    // Bug latente: nunca foi exercitado em produção real porque ainda não tem clientes.
  }

  /**
   * Tenta consumir tokens. Operação atômica:
   *   - Verifica saldo suficiente
   *   - Decrementa
   *   - Registra transação
   *   - Se ficar abaixo do threshold, dispara alerta (via callback do alertManager)
   *
   * @returns { allowed: bool, balance_after, reason? }
   */
  consume(workspaceId, amount, opts = {}) {
    if (amount <= 0) {
      return { allowed: true, balance_after: this.getBalance(workspaceId).balance, reason: 'zero' };
    }

    this.ensureRow(workspaceId);

    return db.transaction(() => {
      // v9.4.3 BUG #110: idempotência. Se mesmo ai_request_id já foi consumido,
      // retorna o resultado anterior sem debitar de novo. Cenário: rede caiu
      // entre debit e response → frontend retry com mesmo ID → cliente cobrava 2x.
      if (opts.ai_request_id) {
        const existing = db.get(
          `SELECT balance_after FROM token_transactions
           WHERE workspace_id = ? AND ai_request_id = ? AND type = 'consume'
           LIMIT 1`,
          [workspaceId, opts.ai_request_id]
        );
        if (existing) {
          require('../utils/logger').info(
            `[TokenService] consume idempotente — ai_request_id=${opts.ai_request_id} já processado`
          );
          return {
            allowed: true,
            balance_after: existing.balance_after,
            idempotent_replay: true,
          };
        }
      }

      const row = db.get(
        `SELECT tokens_total, tokens_used, low_balance_warned_at
         FROM workspace_credits WHERE workspace_id = ?`,
        [workspaceId]
      );
      const currentBalance = row.tokens_total - row.tokens_used;

      if (currentBalance < amount) {
        // Não tem saldo suficiente
        return {
          allowed: false,
          balance_after: currentBalance,
          tokens_needed: amount - currentBalance,
          reason: 'insufficient_balance',
        };
      }

      // Consome
      db.run(
        `UPDATE workspace_credits
         SET tokens_used = tokens_used + ?,
             last_used_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE workspace_id = ?`,
        [amount, workspaceId]
      );

      const balanceAfter = currentBalance - amount;

      // Auditoria
      db.run(
        `INSERT INTO token_transactions
          (id, workspace_id, type, amount, balance_after, ai_request_id,
           model, prompt_tokens, completion_tokens, description, metadata)
         VALUES (?, ?, 'consume', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          workspaceId,
          -amount,
          balanceAfter,
          opts.ai_request_id || null,
          opts.model || null,
          opts.prompt_tokens || null,
          opts.completion_tokens || null,
          opts.description || `IA consumiu ${amount} tokens`,
          JSON.stringify(opts.metadata || {}),
        ]
      );

      // Alerta de saldo baixo (uma vez por ciclo de topup)
      const threshold = row.tokens_total * LOW_BALANCE_THRESHOLD;
      if (balanceAfter < threshold && balanceAfter > 0 && !row.low_balance_warned_at) {
        db.run(
          `UPDATE workspace_credits SET low_balance_warned_at = CURRENT_TIMESTAMP WHERE workspace_id = ?`,
          [workspaceId]
        );
        // Trigger emit (consumido por outros serviços)
        try {
          const events = require('../utils/events');
          events.emit('tokens.low_balance', {
            workspace_id: workspaceId,
            balance: balanceAfter,
            total: row.tokens_total,
            pct: Math.round((balanceAfter / row.tokens_total) * 100),
          });
        } catch (_) {}
      }

      return { allowed: true, balance_after: balanceAfter };
    });
    // v9.4.6 BUG #125 CRÍTICO: removido `()` extra. Driver já invoca `wrapped()`.
  }

  /**
   * Histórico de transações (paginado).
   */
  history(workspaceId, { limit = 50, offset = 0, type } = {}) {
    const params = [workspaceId];
    let where = 'workspace_id = ?';
    if (type) { where += ' AND type = ?'; params.push(type); }
    params.push(limit, offset);

    return db.all(
      `SELECT id, type, amount, balance_after, model,
              prompt_tokens, completion_tokens, description, created_at
       FROM token_transactions
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      params
    ) || [];
  }

  /**
   * Resumo de uso (para dashboard)
   */
  usageReport(workspaceId, { days = 30 } = {}) {
    const since = new Date(Date.now() - days * 86400000).toISOString();

    let consumeRows = [];
    try {
      consumeRows = db.all(
        `SELECT DATE(created_at) AS day,
                SUM(ABS(amount)) AS tokens_consumed,
                COUNT(*) AS requests
         FROM token_transactions
         WHERE workspace_id = ? AND type = 'consume' AND created_at >= ?
         GROUP BY day
         ORDER BY day ASC`,
        [workspaceId, since]
      ) || [];
    } catch (_) {}

    const totalConsumed = consumeRows.reduce((s, r) => s + (r.tokens_consumed || 0), 0);
    const totalRequests = consumeRows.reduce((s, r) => s + (r.requests || 0), 0);

    return {
      period_days: days,
      total_tokens_consumed: totalConsumed,
      total_requests: totalRequests,
      avg_tokens_per_request: totalRequests > 0 ? Math.round(totalConsumed / totalRequests) : 0,
      by_day: consumeRows,
    };
  }
}

module.exports = new TokenService();
module.exports.TokenService = TokenService;
module.exports.PLAN_TOKENS = PLAN_TOKENS;
module.exports.TOKEN_PACKAGES = TOKEN_PACKAGES;
module.exports.LOW_BALANCE_THRESHOLD = LOW_BALANCE_THRESHOLD;
