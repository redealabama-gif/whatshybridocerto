/**
 * EmailService - v8.4.0
 *
 * Envia emails transacionais via SendGrid (HTTPS direto, sem SDK).
 * Templates HTML inline com identidade visual do Vórtex Pro
 * (purple/cyan, Orbitron + Inter).
 *
 * Tipos de email:
 *   - welcome: pós-signup
 *   - payment_confirmed: pagamento aprovado (assinatura ou tokens)
 *   - trial_ending: 3 dias antes do fim do trial
 *   - charge_failed: cobrança recusada
 *   - tokens_low: saldo abaixo de 10%
 *   - tokens_exhausted: saldo zerado
 *
 * Configuração: SENDGRID_API_KEY, EMAIL_FROM, EMAIL_FROM_NAME
 */

const axios = require('axios');
const logger = require('../utils/logger');

const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send';

class EmailService {
  constructor() {
    this.apiKey = process.env.SENDGRID_API_KEY || '';
    this.from = process.env.EMAIL_FROM || 'noreply@whatshybrid.com.br';
    this.fromName = process.env.EMAIL_FROM_NAME || 'Vórtex Pro';
    this.baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    this.dryRun = !this.apiKey;
    if (this.dryRun) {
      logger.warn('[EmailService] SENDGRID_API_KEY ausente — modo dry-run (não envia emails)');
    }
  }

  isConfigured() { return !!this.apiKey; }

  /**
   * Envia email cru (low-level)
   *
   * v8.5.0: persiste no email_outbox em caso de falha (DLQ).
   * Retries automáticos via processOutbox() chamado pelo cron.
   *
   * @param {{ to: string, subject: string, html: string, text?: string,
   *           replyTo?: string, _isRetry?: boolean, _outboxId?: string | null }} opts
   */
  async send({ to, subject, html, text, replyTo, _isRetry = false, _outboxId = null }) {
    if (this.dryRun) {
      logger.info(`[EmailService:DRY-RUN] To: ${to} | Subject: ${subject}`);
      return { dryRun: true, sent: false };
    }

    const payload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: this.from, name: this.fromName },
      subject,
      content: [],
    };
    if (text) payload.content.push({ type: 'text/plain', value: text });
    if (html) payload.content.push({ type: 'text/html', value: html });
    if (replyTo) payload.reply_to = { email: replyTo };

    try {
      await axios.post(SENDGRID_API, payload, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      logger.info(`[EmailService] Sent to ${to}: ${subject}`);

      // Se era retry, marcar como sent no outbox
      if (_outboxId) {
        try {
          const db = require('../utils/database');
          db.run(`UPDATE email_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?`, [_outboxId]);
        } catch (_) {}
      }
      return { sent: true };
    } catch (err) {
      const errMsg = err.response?.data ? JSON.stringify(err.response.data).substring(0, 500) : err.message;
      logger.error(`[EmailService] Failed to send to ${to}: ${errMsg}`);

      // ── DLQ: persistir email para retry posterior ──
      if (!_isRetry) {
        try {
          const db = require('../utils/database');
          const { v4: uuidv4 } = require('../utils/uuid-wrapper');
          const nextRetry = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // +5min
          db.run(
            `INSERT INTO email_outbox (id, to_address, subject, html, text, status, attempts, last_error, next_retry_at)
             VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
            [uuidv4(), to, subject, html || '', text || '', errMsg, nextRetry]
          );
          logger.info(`[EmailService] Email enfileirado para retry: ${to}`);
        } catch (dbErr) {
          logger.error(`[EmailService] Falha ao persistir no outbox: ${dbErr.message}`);
        }
      } else if (_outboxId) {
        // Era retry — atualiza attempts e error
        try {
          const db = require('../utils/database');
          const next = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // +30min
          db.run(
            `UPDATE email_outbox
             SET attempts = attempts + 1, last_error = ?, next_retry_at = ?,
                 status = CASE WHEN attempts >= 4 THEN 'failed' ELSE 'pending' END
             WHERE id = ?`,
            [errMsg, next, _outboxId]
          );
        } catch (_) {}
      }
      return { sent: false, error: err.message };
    }
  }

  /**
   * Processa fila de retry — chamado pelo cron (a cada 5min).
   * Tenta reenviar emails que falharam, com backoff.
   */
  async processOutbox(maxBatch = 20) {
    const db = require('../utils/database');
    let processed = 0, sent = 0, failed = 0;

    try {
      const pending = db.all(
        `SELECT * FROM email_outbox
         WHERE status = 'pending' AND attempts < 5
           AND (next_retry_at IS NULL OR next_retry_at <= CURRENT_TIMESTAMP)
         ORDER BY created_at ASC LIMIT ?`,
        [maxBatch]
      );

      for (const email of pending) {
        const result = await this.send({
          to: email.to_address,
          subject: email.subject,
          html: email.html,
          text: email.text,
          _isRetry: true,
          _outboxId: email.id,
        });
        processed++;
        if (result.sent) sent++; else failed++;
      }

      if (processed > 0) {
        logger.info(`[EmailService:Outbox] Processed ${processed} (sent=${sent}, failed=${failed})`);
      }
    } catch (err) {
      logger.error(`[EmailService:Outbox] Process error: ${err.message}`);
    }

    return { processed, sent, failed };
  }


  // ── Template wrapper ──────────────────────────────────────────
  _wrap({ title, preheader, body, ctaLabel, ctaUrl }) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${this._escape(title)}</title>
</head>
<body style="margin:0;padding:0;background:#030014;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#ffffff;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;color:#030014;">${this._escape(preheader)}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#030014;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:linear-gradient(135deg,#0f0c29 0%,#131129 100%);border-radius:16px;border:1px solid rgba(111,0,255,0.2);overflow:hidden;">
        <!-- Header com gradient -->
        <tr><td style="background:linear-gradient(90deg,#6f00ff,#00ffff);padding:24px;text-align:center;">
          <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-weight:900;font-size:24px;color:#000000;letter-spacing:1px;">
            Vórtex <span style="font-weight:400;">Pro</span>
          </div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px 32px;color:#ffffff;">
          <h1 style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:24px;color:#ffffff;margin:0 0 24px;">
            ${this._escape(title)}
          </h1>
          <div style="font-size:15px;line-height:1.6;color:#cbd5e1;">
            ${body}
          </div>
          ${ctaUrl && ctaLabel ? `
            <div style="text-align:center;margin:32px 0;">
              <a href="${this._escape(ctaUrl)}" style="display:inline-block;background:#00ffff;color:#000000;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">
                ${this._escape(ctaLabel)}
              </a>
            </div>
          ` : ''}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 32px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;color:#64748b;font-size:12px;">
          Você recebeu este email porque é cliente do Vórtex Pro.<br>
          <a href="${this.baseUrl}" style="color:#00ffff;text-decoration:none;">${this.baseUrl.replace(/^https?:\/\//, '')}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  _escape(s) {
    return String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Templates específicos ─────────────────────────────────────

  async sendWelcome({ to, name, plan, trialDays = 7 }) {
    const html = this._wrap({
      title: `Bem-vindo, ${name}! 🚀`,
      preheader: `Seu trial de ${trialDays} dias começou. Veja como começar a vender.`,
      body: `
        <p>Sua conta foi criada com sucesso no plano <strong style="color:#00ffff;">${plan.toUpperCase()}</strong>.</p>
        <p>Você tem <strong>${trialDays} dias grátis</strong> para testar tudo antes da primeira cobrança.</p>
        <p><strong>Próximos passos:</strong></p>
        <ol style="color:#cbd5e1;line-height:1.8;">
          <li>Instale a extensão Vórtex Pro no Chrome</li>
          <li>Configure o treinamento da IA dentro da extensão</li>
          <li>Abra o WhatsApp Web e comece a atender</li>
        </ol>
      `,
      ctaLabel: 'Acessar meu painel',
      ctaUrl: `${this.baseUrl}/dashboard.html`,
    });

    return this.send({
      to,
      subject: `Bem-vindo ao Vórtex Pro, ${name}!`,
      html,
    });
  }

  async sendPaymentConfirmed({ to, name, plan, amount, paymentId, subscriptionCode = null, isNewCode = false }) {
    const formatted = `R$ ${amount.toFixed(2).replace('.', ',')}`;

    // Bloco de ativação só aparece quando temos código. Em caso de falha na
    // geração (fallback raro), o email continua válido como recibo — o
    // suporte gera o código manualmente via /api/v1/subscription/codes.
    const codeBlock = subscriptionCode ? `
        <div style="margin:24px 0;padding:20px;background:rgba(0,255,255,0.06);border:1px solid rgba(0,255,255,0.30);border-radius:12px;">
          <div style="font-size:12px;color:#00ffff;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px;">
            ${isNewCode ? '🔑 Seu código de ativação' : '🔑 Código da sua assinatura'}
          </div>
          <div style="font-family:'Cascadia Code',ui-monospace,monospace;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:2px;padding:12px 16px;background:rgba(0,0,0,0.40);border-radius:8px;text-align:center;user-select:all;">
            ${this._escape(subscriptionCode)}
          </div>
          ${isNewCode ? `
          <div style="margin-top:16px;font-size:14px;color:#cbd5e1;line-height:1.6;">
            <strong style="color:#ffffff;">Como ativar:</strong>
            <ol style="margin:8px 0 0;padding-left:20px;color:#cbd5e1;">
              <li>Instale a extensão Chrome do Vórtex Pro (link abaixo).</li>
              <li>Abra o painel lateral e clique em "Ativar assinatura".</li>
              <li>Cole o código acima e pronto — sua conta libera na hora.</li>
            </ol>
            <p style="margin:12px 0 0;font-size:13px;color:#94a3b8;">
              O código vale só pra um dispositivo. Pra mudar de máquina, acesse <a href="${this.baseUrl}/dashboard.html#billing" style="color:#00ffff;">o painel</a> e clique em "Desvincular dispositivo".
            </p>
          </div>` : `
          <div style="margin-top:12px;font-size:13px;color:#94a3b8;">
            Este é o mesmo código que você já usa na extensão. Sua renovação foi aplicada e não é preciso reativar.
          </div>`}
        </div>
    ` : '';

    const html = this._wrap({
      title: '✅ Pagamento confirmado',
      preheader: `Seu pagamento de ${formatted} foi processado com sucesso.`,
      body: `
        <p>Olá ${this._escape(name)},</p>
        <p>Recebemos seu pagamento de <strong>${formatted}</strong>. Sua assinatura está <strong style="color:#22c55e;">ativa</strong>.</p>
        <table style="width:100%;margin:16px 0;border-collapse:collapse;">
          <tr><td style="padding:8px 0;color:#94a3b8;">Plano:</td><td style="padding:8px 0;text-align:right;color:#ffffff;"><strong>${plan.toUpperCase()}</strong></td></tr>
          <tr><td style="padding:8px 0;color:#94a3b8;">ID do pagamento:</td><td style="padding:8px 0;text-align:right;color:#ffffff;font-family:monospace;font-size:13px;">${this._escape(paymentId)}</td></tr>
          <tr><td style="padding:8px 0;color:#94a3b8;">Valor:</td><td style="padding:8px 0;text-align:right;color:#ffffff;"><strong>${formatted}</strong></td></tr>
        </table>
        ${codeBlock}
      `,
      ctaLabel: subscriptionCode && isNewCode ? 'Baixar a extensão' : 'Ver minha assinatura',
      ctaUrl: subscriptionCode && isNewCode
        ? `${this.baseUrl}/dashboard.html#extension`
        : `${this.baseUrl}/dashboard.html`,
    });

    return this.send({ to, subject: 'Pagamento confirmado — Vórtex Pro', html });
  }

  async sendTrialEnding({ to, name, daysLeft, plan, planPrice }) {
    const formatted = `R$ ${planPrice.toFixed(2).replace('.', ',')}`;
    const html = this._wrap({
      title: `⏰ Seu trial termina em ${daysLeft} dias`,
      preheader: 'Configure o pagamento para não perder o acesso.',
      body: `
        <p>Olá ${this._escape(name)},</p>
        <p>Seu período gratuito de teste termina em <strong style="color:#fbbf24;">${daysLeft} dias</strong>.</p>
        <p>Para continuar usando o Vórtex Pro plano <strong>${plan.toUpperCase()}</strong> (${formatted}/mês), configure o pagamento agora.</p>
        <p style="color:#94a3b8;font-size:14px;">Aceitamos PIX, boleto e cartão de crédito via MercadoPago.</p>
      `,
      ctaLabel: 'Configurar pagamento',
      ctaUrl: `${this.baseUrl}/dashboard.html#billing`,
    });

    return this.send({ to, subject: `⏰ ${daysLeft} dias para o fim do trial — Vórtex Pro`, html });
  }

  /**
   * Fase 2 cobrança real — disparado quando o billingCron detecta um
   * trial expirado e gera a primeira preference de pagamento no MP.
   * O `paymentUrl` é o init_point retornado pelo MP (PIX/boleto/cartão).
   *
   * Diferente do trial_ending (preventivo, 3 dias antes), este email é
   * o "trial acabou — clique aqui pra continuar sem perder dados".
   */
  async sendFirstInvoiceLink({ to, name, plan, planPrice, paymentUrl, expiresAt, couponLabel }) {
    const formatted = `R$ ${Number(planPrice).toFixed(2).replace('.', ',')}`;
    const expiresLine = expiresAt
      ? `<p style="color:#94a3b8;font-size:13px;">Este link expira em ${new Date(expiresAt).toLocaleDateString('pt-BR')}.</p>`
      : '';
    const couponLine = couponLabel
      ? `<p style="color:#22d3ee;"><strong>🎁 ${this._escape(couponLabel)}</strong> aplicado neste pagamento.</p>`
      : '';
    const html = this._wrap({
      title: '✨ Seu trial terminou — ative seu plano',
      preheader: 'Pague em 1 clique pra continuar sem interrupção.',
      body: `
        <p>Olá ${this._escape(name)},</p>
        <p>Seu trial gratuito do Vórtex Pro acabou. Pra continuar usando o plano
        <strong>${plan.toUpperCase()}</strong> (${formatted}/mês) sem perder seus dados,
        clique no botão abaixo e finalize o pagamento.</p>
        ${couponLine}
        <p style="color:#94a3b8;font-size:14px;">Aceitamos PIX, boleto e cartão de crédito via MercadoPago.</p>
        ${expiresLine}
      `,
      ctaLabel: 'Pagar e ativar plano',
      ctaUrl: paymentUrl,
    });

    return this.send({
      to,
      subject: '✨ Pague seu plano Vórtex Pro pra continuar — link rápido',
      html,
    });
  }

  async sendChargeFailed({ to, name, plan, retryDate }) {
    const html = this._wrap({
      title: '⚠️ Não conseguimos processar seu pagamento',
      preheader: 'Atualize seu método de pagamento para evitar interrupção.',
      body: `
        <p>Olá ${this._escape(name)},</p>
        <p>Tentamos cobrar a renovação do seu plano <strong>${plan.toUpperCase()}</strong>, mas o pagamento foi recusado.</p>
        <p>Possíveis motivos: cartão sem saldo, cartão expirado, ou recusa do banco.</p>
        ${retryDate ? `<p><strong>Vamos tentar novamente em ${new Date(retryDate).toLocaleDateString('pt-BR')}.</strong></p>` : ''}
        <p>Atualize seu método de pagamento agora para evitar suspensão da conta.</p>
      `,
      ctaLabel: 'Atualizar pagamento',
      ctaUrl: `${this.baseUrl}/dashboard.html#billing`,
    });

    return this.send({ to, subject: '⚠️ Pagamento recusado — Vórtex Pro', html });
  }

  /**
   * v9.6.x — Dunning escalonado. Disparado pelo billingCron.processDunning
   * a cada tentativa (1/3 amigável, 2/3 firme, 3/3 último aviso).
   *
   * `scenario` muda o tom + CTA:
   *   - 'declined'        — cartão recusou de novo
   *   - 'reconfig'        — assinatura cancelada/inválida, precisa refazer
   *   - 'no_method'       — nunca configurou método de pagamento (ex: trial expirado)
   *   - 'pending'         — MP cuida do retry, só avisamos
   *
   * O subject + tom mudam conforme attempt pra dar urgência crescente
   * sem soar agressivo demais nas primeiras tentativas.
   */
  async sendDunningEscalation({ to, name, plan, attempt, daysOverdue, daysUntilSuspension, scenario }) {
    if (!to) return { skipped: true, reason: 'no_email' };

    const TONES = {
      1: { prefix: '⏰', tone: 'Lembrete amigável', urgency: 'Você ainda tem alguns dias pra regularizar.' },
      2: { prefix: '⚠️',  tone: 'Aviso firme',        urgency: `Em ${daysUntilSuspension || 4} dias sua conta será suspensa.` },
      3: { prefix: '🚨', tone: 'Último aviso',       urgency: 'Sua conta será suspensa amanhã se o pagamento não for regularizado.' },
    };
    const t = TONES[attempt] || TONES[1];

    // `?from=dunning` permite ao dashboard saber que o cliente chegou via
    // email de cobrança e mostrar UI contextual (banner past_due + toast
    // orientando). Hash `#billing[/sub-acao]` é tratado pelo router do dashboard.
    const SCENARIO_CTA = {
      declined:  { label: 'Atualizar método de pagamento', path: '/dashboard.html?from=dunning#billing' },
      reconfig:  { label: 'Reconfigurar assinatura',       path: '/dashboard.html?from=dunning#billing/subscription' },
      no_method: { label: 'Configurar pagamento',          path: '/dashboard.html?from=dunning#billing/subscribe' },
      pending:   { label: 'Ver detalhes da assinatura',    path: '/dashboard.html?from=dunning#billing' },
    };
    const cta = SCENARIO_CTA[scenario] || SCENARIO_CTA.declined;

    const SCENARIO_BODY = {
      declined: `
        <p>Olá ${this._escape(name)},</p>
        <p>Tentamos renovar seu plano <strong>${this._escape(plan?.toUpperCase() || 'PRO')}</strong>, mas o pagamento foi recusado pela operadora do cartão.</p>
        <p>Possíveis motivos: cartão sem saldo, cartão expirado, ou bloqueio antifraude.</p>
        <p><strong>${t.urgency}</strong></p>
      `,
      reconfig: `
        <p>Olá ${this._escape(name)},</p>
        <p>Notamos que sua assinatura do plano <strong>${this._escape(plan?.toUpperCase() || 'PRO')}</strong> foi cancelada ou está inválida no sistema de pagamentos.</p>
        <p>Pra continuar usando o Vórtex sem interrupção, é necessário reconfigurar o método de pagamento.</p>
        <p><strong>${t.urgency}</strong></p>
      `,
      no_method: `
        <p>Olá ${this._escape(name)},</p>
        <p>Seu período de avaliação do plano <strong>${this._escape(plan?.toUpperCase() || 'PRO')}</strong> terminou, mas ainda não há método de pagamento configurado na sua conta.</p>
        <p>Configure agora pra continuar com acesso à IA e demais funcionalidades premium.</p>
        <p><strong>${t.urgency}</strong></p>
      `,
      pending: `
        <p>Olá ${this._escape(name)},</p>
        <p>A renovação do seu plano <strong>${this._escape(plan?.toUpperCase() || 'PRO')}</strong> está pendente. Estamos aguardando a próxima tentativa automática de cobrança.</p>
        <p>Se preferir não esperar, você pode atualizar o método de pagamento manualmente.</p>
        <p><strong>${t.urgency}</strong></p>
      `,
    };

    const subject = `${t.prefix} ${t.tone} (${attempt}/3) — Pagamento pendente • Vórtex`;
    const html = this._wrap({
      title: `${t.prefix} ${t.tone}`,
      preheader: t.urgency,
      body: SCENARIO_BODY[scenario] || SCENARIO_BODY.declined,
      ctaLabel: cta.label,
      ctaUrl: `${this.baseUrl}${cta.path}`,
    });

    return this.send({ to, subject, html });
  }

  async sendTokensLow({ to, name, balance, total, pct }) {
    const html = this._wrap({
      title: `🪫 Seus tokens estão acabando`,
      preheader: `Restam ${pct}% do seu saldo de IA.`,
      body: `
        <p>Olá ${this._escape(name)},</p>
        <p>Você usou <strong style="color:#fbbf24;">${100 - pct}%</strong> dos seus tokens deste mês.</p>
        <p>Saldo atual: <strong>${balance.toLocaleString('pt-BR')}</strong> de ${total.toLocaleString('pt-BR')} tokens.</p>
        <p>Para evitar interrupção do atendimento, considere comprar um pacote avulso.</p>
      `,
      ctaLabel: 'Comprar mais tokens',
      ctaUrl: `${this.baseUrl}/dashboard.html#tokens`,
    });

    return this.send({ to, subject: '🪫 Seus tokens estão acabando — Vórtex Pro', html });
  }

  async sendTokensExhausted({ to, name }) {
    const html = this._wrap({
      title: '🚫 Seus tokens acabaram',
      preheader: 'A IA está pausada. Compre um pacote para continuar.',
      body: `
        <p>Olá ${this._escape(name)},</p>
        <p>Seus tokens de IA acabaram. A IA do Vórtex Pro está <strong style="color:#ef4444;">pausada</strong> até você comprar mais ou aguardar o início do próximo ciclo.</p>
        <p>Você pode comprar pacotes avulsos a partir de R$ 19,00.</p>
      `,
      ctaLabel: 'Comprar tokens agora',
      ctaUrl: `${this.baseUrl}/dashboard.html#tokens`,
    });

    return this.send({ to, subject: '🚫 IA pausada: tokens esgotados — Vórtex Pro', html });
  }
}

module.exports = new EmailService();
module.exports.EmailService = EmailService;
