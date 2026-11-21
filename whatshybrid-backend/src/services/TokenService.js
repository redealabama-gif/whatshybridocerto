// @ts-check
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

// ── Quanto custa UMA resposta da IA ──────────────────────────────
//
// Medido no backend real (audit/evidencias/producao/tokens-economia.md):
// cada sugestão pelo orquestrador envia ~1.800 tokens de entrada (instruções
// + treinamento do cliente + histórico da conversa) e ~120 de saída.
//
// Esta é a unidade de VENDA: o cliente compra respostas, não tokens. Tokens
// continuam sendo a unidade interna de débito, porque é o que o provedor
// cobra — mas ninguém entende "50.000 tokens", e foi justamente essa confusão
// que pôs "uma resposta gasta ~200 tokens" no FAQ do site (9,6x errado).
const TOKENS_POR_RESPOSTA = 1_920;

// ── Quantas respostas cada plano dá por mês ──────────────────────
//
// Custo de IA por resposta (Groq llama-3.3-70b na geração + gpt-4o-mini no
// classificador de intenção, câmbio R$ 5,30): ~R$ 0,0066.
// Margens no PIOR caso, com o cliente gastando 100% da cota e já descontadas
// a taxa do MercadoPago (4,99%) e o rateio de servidor:
//   Starter   R$  49,90 →  500 respostas → IA R$  3,32 → margem 84%
//   Pro       R$  99,90 → 2.500 respostas → IA R$ 16,62 → margem 76%
//   Business  R$ 299,90 → 10.000 respostas → IA R$ 66,00 → margem 72%
const PLAN_RESPOSTAS = {
  free:          0,        // sem IA no plano free
  starter:     500,
  pro:       2_500,
  business: 10_000,
  enterprise: 520_312,     // efetivamente ilimitado (workspaces internos)
};

const PLAN_TOKENS = Object.fromEntries(
  Object.entries(PLAN_RESPOSTAS).map(([plano, respostas]) => [plano, respostas * TOKENS_POR_RESPOSTA])
);

// ── Pacotes avulsos, também em respostas (centavos BRL) ──────────
//
// Regra: o preço por resposta de QUALQUER pacote fica acima do preço por
// resposta de QUALQUER plano — assinar tem de valer mais a pena que recarregar.
// O piso é o Business (R$ 0,030/resposta, o mais barato por resposta):
//    200 → R$ 0,120    600 → R$ 0,098    2.000 → R$ 0,075    6.000 → R$ 0,058
// Antes era o contrário: o pack de 50k custava R$ 79,00 enquanto o Starter
// inteiro, com os mesmos 50k, custava R$ 49,90.
const TOKEN_PACKAGES = {
  pack_200:   { respostas:   200, price_brl_cents:  2400, label:   '200 respostas — R$ 24,00' },
  pack_600:   { respostas:   600, price_brl_cents:  5900, label:   '600 respostas — R$ 59,00' },
  pack_2000:  { respostas: 2_000, price_brl_cents: 14900, label: '2.000 respostas — R$ 149,00' },
  pack_6000:  { respostas: 6_000, price_brl_cents: 34900, label: '6.000 respostas — R$ 349,00' },
};
for (const pacote of Object.values(TOKEN_PACKAGES)) pacote.tokens = pacote.respostas * TOKENS_POR_RESPOSTA;

// Os 4 ids que o cliente pode ver numa vitrine. Fixado ANTES dos apelidos
// abaixo, senão a lista sairia com cada pacote duas vezes (PKG-01).
const PACOTES_A_LISTAR = Object.keys(TOKEN_PACKAGES);

// Ids antigos continuam funcionando: links e e-mails já enviados não podem
// quebrar. Cada um aponta para o pacote novo de volume mais próximo. São
// apelidos para RESOLVER uma compra, nunca para listar.
const PACOTES_ANTIGOS = { pack_10k: 'pack_200', pack_50k: 'pack_600', pack_200k: 'pack_2000', pack_1M: 'pack_6000' };
for (const [antigo, novo] of Object.entries(PACOTES_ANTIGOS)) TOKEN_PACKAGES[antigo] = TOKEN_PACKAGES[novo];

/**
 * Pacotes para mostrar ao cliente — sem os apelidos antigos.
 * Quem precisa resolver um id de compra usa TOKEN_PACKAGES direto.
 */
function listarPacotes() {
  return PACOTES_A_LISTAR.map((id) => {
    const p = TOKEN_PACKAGES[id];
    const reais = p.price_brl_cents / 100;
    return {
      id,
      respostas: p.respostas,
      tokens: p.tokens,
      price_brl: reais,
      price_brl_cents: p.price_brl_cents,
      label: p.label,
      preco_por_resposta: (reais / p.respostas).toFixed(4),
      cost_per_1k: (reais / (p.tokens / 1000)).toFixed(3),
    };
  });
}

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
    const restante = Math.max(0, balance);
    return {
      total: row.tokens_total,
      used: row.tokens_used,
      balance: restante,
      utilization_pct: row.tokens_total > 0
        ? Math.round((row.tokens_used / row.tokens_total) * 100)
        : 0,
      // O cliente compra RESPOSTAS; tokens são a unidade interna. O painel e a
      // extensão mostram estes campos — ninguém entende "restam 412.800 tokens",
      // todo mundo entende "restam 215 respostas".
      respostas: {
        total:    Math.floor(row.tokens_total / TOKENS_POR_RESPOSTA),
        usadas:   Math.floor(row.tokens_used  / TOKENS_POR_RESPOSTA),
        restantes: Math.floor(restante        / TOKENS_POR_RESPOSTA),
      },
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
   * @param {number} amount - tokens a adicionar (positivo)
   * @param {string} type - 'topup' | 'plan_grant' | 'plan_renewal' | 'adjustment' | 'refund'
   * @param {{ description?: string, invoice_id?: string, metadata?: any }} [opts]
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

      // Atualiza saldo. PLN-01: tokens comprados (topup) também entram em
      // tokens_purchased — a parte do saldo que não expira na renovação.
      db.run(
        `UPDATE workspace_credits
         SET tokens_total = tokens_total + ?,
             tokens_purchased = tokens_purchased + ?,
             last_topup_at = CURRENT_TIMESTAMP,
             low_balance_warned_at = NULL,    -- reseta o aviso de saldo baixo
             updated_at = CURRENT_TIMESTAMP
         WHERE workspace_id = ?`,
        [amount, type === 'topup' ? amount : 0, workspaceId]
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

      // BUG FIX CRÍTICO: ensureRow ANTES do UPDATE. Workspace recém-criado/pago
      // ainda não tem linha em workspace_credits. O UPDATE rodava primeiro e não
      // afetava nenhuma linha (no-op silencioso); só depois ensureRow criava a
      // linha com tokens_total=0. Resultado: cliente virava PRO com SALDO ZERO e
      // não conseguia usar a IA que pagou. Garantindo a linha primeiro, o UPDATE
      // efetivamente grava o grant.
      this.ensureRow(workspaceId);

      // PLN-01: a sobra da cota do plano não acumula, mas o que foi COMPRADO e
      // ainda não foi usado continua ("pacotes avulsos não expiram", promessa do
      // site). O consumo gasta primeiro a cota do plano: a parte comprada que
      // resta é o menor valor entre o comprado e o saldo atual.
      const atual = db.get(
        `SELECT tokens_total, tokens_used, tokens_purchased FROM workspace_credits WHERE workspace_id = ?`,
        [workspaceId]
      );
      const saldoAtual = Math.max(0, (atual?.tokens_total || 0) - (atual?.tokens_used || 0));
      const compradoRestante = Math.min(Math.max(0, atual?.tokens_purchased || 0), saldoAtual);
      const novoTotal = grant + compradoRestante;

      // Zera consumo; total = cota do plano + o que resta do que foi comprado
      db.run(
        `UPDATE workspace_credits
         SET tokens_total = ?,
             tokens_used = 0,
             tokens_purchased = ?,
             last_topup_at = CURRENT_TIMESTAMP,
             low_balance_warned_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE workspace_id = ?`,
        [novoTotal, compradoRestante, workspaceId]
      );

      db.run(
        `INSERT INTO token_transactions
          (id, workspace_id, type, amount, balance_after, invoice_id, description)
         VALUES (?, ?, 'plan_renewal', ?, ?, ?, ?)`,
        [uuidv4(), workspaceId, grant, novoTotal, opts.invoice_id || null,
          compradoRestante > 0
            ? `Renovação mensal: ${plan} (+${compradoRestante} tokens comprados mantidos)`
            : `Renovação mensal: ${plan}`]
      );

      logger.info(`[Tokens] Renewal for ws=${workspaceId} plan=${plan}: ${grant} tokens + ${compradoRestante} comprados`);
      return { balance_after: novoTotal };
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
   * @returns {{ allowed: boolean, balance_after: number, reason?: string }}
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
   * @param {string} workspaceId
   * @param {{ limit?: number, offset?: number, type?: string }} [opts]
   */
  history(workspaceId, { limit = 50, offset = 0, type } = {}) {
    /** @type {Array<string | number>} */
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
module.exports.PACOTES_ANTIGOS = PACOTES_ANTIGOS;
module.exports.listarPacotes = listarPacotes;
module.exports.TOKENS_POR_RESPOSTA = TOKENS_POR_RESPOSTA;
module.exports.PLAN_RESPOSTAS = PLAN_RESPOSTAS;
module.exports.PLAN_TOKENS = PLAN_TOKENS;
module.exports.LOW_BALANCE_THRESHOLD = LOW_BALANCE_THRESHOLD;
