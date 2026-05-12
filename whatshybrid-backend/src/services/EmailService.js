/**
 * EmailService - v8.4.0
 *
 * Envia emails transacionais via SendGrid (HTTPS direto, sem SDK).
 * Templates HTML inline com identidade visual do WhatsHybrid Pro
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
    this.fromName = process.env.EMAIL_FROM_NAME || 'WhatsHybrid Pro';
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
            WhatsHybrid <span style="font-weight:400;">Pro</span>
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
          Você recebeu este email porque é cliente do WhatsHybrid Pro.<br>
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
          <li>Instale a extensão WhatsHybrid Pro no Chrome</li>
          <li>Configure o treinamento da IA dentro da extensão</li>
          <li>Abra o WhatsApp Web e comece a atender</li>
        </ol>
      `,
      ctaLabel: 'Acessar meu painel',
      ctaUrl: `${this.baseUrl}/dashboard.html`,
    });

    return this.send({
      to,
      subject: `Bem-vindo ao WhatsHybrid Pro, ${name}!`,
      html,
    });
  }

  async sendPaymentConfirmed({ to, name, plan, amount, paymentId }) {
    const formatted = `R$ ${amount.toFixed(2).replace('.', ',')}`;
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
      `,
      ctaLabel: 'Ver minha assinatura',
      ctaUrl: `${this.baseUrl}/dashboard.html`,
    });

    return this.send({ to, subject: 'Pagamento confirmado — WhatsHybrid Pro', html });
  }

  async sendTrialEnding({ to, name, daysLeft, plan, planPrice }) {
    const formatted = `R$ ${planPrice.toFixed(2).replace('.', ',')}`;
    const html = this._wrap({
      title: `⏰ Seu trial termina em ${daysLeft} dias`,
      preheader: 'Configure o pagamento para não perder o acesso.',
      body: `
        <p>Olá ${this._escape(name)},</p>
        <p>Seu período gratuito de teste termina em <strong style="color:#fbbf24;">${daysLeft} dias</strong>.</p>
        <p>Para continuar usando o WhatsHybrid Pro plano <strong>${plan.toUpperCase()}</strong> (${formatted}/mês), configure o pagamento agora.</p>
        <p style="color:#94a3b8;font-size:14px;">Aceitamos PIX, boleto e cartão de crédito via MercadoPago.</p>
      `,
      ctaLabel: 'Configurar pagamento',
      ctaUrl: `${this.baseUrl}/dashboard.html#billing`,
    });

    return this.send({ to, subject: `⏰ ${daysLeft} dias para o fim do trial — WhatsHybrid Pro`, html });
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

    return this.send({ to, subject: '⚠️ Pagamento recusado — WhatsHybrid Pro', html });
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

    return this.send({ to, subject: '🪫 Seus tokens estão acabando — WhatsHybrid Pro', html });
  }

  async sendTokensExhausted({ to, name }) {
    const html = this._wrap({
      title: '🚫 Seus tokens acabaram',
      preheader: 'A IA está pausada. Compre um pacote para continuar.',
      body: `
        <p>Olá ${this._escape(name)},</p>
        <p>Seus tokens de IA acabaram. A IA do WhatsHybrid Pro está <strong style="color:#ef4444;">pausada</strong> até você comprar mais ou aguardar o início do próximo ciclo.</p>
        <p>Você pode comprar pacotes avulsos a partir de R$ 19,00.</p>
      `,
      ctaLabel: 'Comprar tokens agora',
      ctaUrl: `${this.baseUrl}/dashboard.html#tokens`,
    });

    return this.send({ to, subject: '🚫 IA pausada: tokens esgotados — WhatsHybrid Pro', html });
  }
}

module.exports = new EmailService();
module.exports.EmailService = EmailService;
