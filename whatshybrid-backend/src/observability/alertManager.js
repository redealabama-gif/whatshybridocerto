/**
 * 🚨 Alert Dispatcher
 *
 * Sistema simples de alertas para você ser notificado quando algo crítico
 * acontece em produção, sem depender de Sentry/Datadog.
 *
 * Como funciona:
 *   - Você configura ALERT_WEBHOOK_URL no .env (Discord, Slack, ou seu próprio endpoint)
 *   - Eventos críticos chamam alertManager.send(level, title, details)
 *   - Rate limiting evita spam: máximo 5 alertas por hora do mesmo tipo
 *   - Em fallback, escreve no logger
 *
 * Exemplos de uso:
 *   alertManager.send('error', 'AIRouter all providers failed', { error });
 *   alertManager.send('warn', 'High memory usage', { memMB });
 *   alertManager.send('info', 'New tenant signup', { tenantId });
 *
 * Webhook URL Examples:
 *   Discord:   https://discord.com/api/webhooks/ID/TOKEN
 *   Slack:     https://hooks.slack.com/services/T.../B.../X...
 *   Custom:    https://seu-webhook.com/alerts (POST com JSON)
 */

'use strict';

const logger = require('../utils/logger');

class AlertManager {
  constructor() {
    this.webhookUrl = process.env.ALERT_WEBHOOK_URL || '';
    this.appName = process.env.APP_NAME || 'WhatsHybrid Pro';
    this.environment = process.env.NODE_ENV || 'development';

    // Rate limiting: { 'alertType': { count, resetAt } }
    this.rateLimitMap = new Map();
    this.MAX_PER_HOUR = 5;
    this.RATE_WINDOW_MS = 60 * 60 * 1000;

    // Detectar tipo de webhook (Discord, Slack, generic) por URL
    this.webhookType = this._detectWebhookType(this.webhookUrl);

    if (this.webhookUrl) {
      logger.info(`[AlertManager] Webhook configurado: ${this.webhookType}`);
    }
  }

  _detectWebhookType(url) {
    if (!url) return 'none';
    if (url.includes('discord.com/api/webhooks')) return 'discord';
    if (url.includes('hooks.slack.com')) return 'slack';
    return 'generic';
  }

  /**
   * Envia alerta. Chave de rate limit é `level:title` para diferentes alertas
   * do mesmo erro virem em sequência mas o mesmo erro repetido seja agrupado.
   *
   * @param {'info'|'warn'|'error'|'critical'} level
   * @param {string} title - resumo curto (vai aparecer como subject/header)
   * @param {Object} [details] - dados adicionais (vai virar body)
   */
  async send(level, title, details = {}) {
    const key = `${level}:${title}`;
    
    // Rate limiting
    if (!this._allowSend(key)) {
      return false;
    }

    // Sempre loga (mesmo se não tiver webhook)
    const logFn = level === 'error' || level === 'critical' ? 'error'
                : level === 'warn' ? 'warn'
                : 'info';
    logger[logFn](`[Alert:${level}] ${title}`, details);

    if (!this.webhookUrl) return false;

    try {
      const payload = this._buildPayload(level, title, details);
      
      const fetch = globalThis.fetch || require('node-fetch');
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.warn(`[AlertManager] Webhook falhou: ${response.status} ${response.statusText}`);
        return false;
      }

      return true;
    } catch (err) {
      logger.warn(`[AlertManager] Erro ao enviar alerta: ${err.message}`);
      return false;
    }
  }

  _allowSend(key) {
    const now = Date.now();
    const entry = this.rateLimitMap.get(key);

    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(key, { count: 1, resetAt: now + this.RATE_WINDOW_MS });
      return true;
    }

    if (entry.count >= this.MAX_PER_HOUR) {
      return false;
    }

    entry.count++;
    return true;
  }

  _buildPayload(level, title, details) {
    const colorMap = {
      info: 0x3b82f6,      // blue
      warn: 0xf59e0b,      // orange
      error: 0xef4444,     // red
      critical: 0x7f1d1d,  // dark red
    };
    const emojiMap = {
      info: 'ℹ️',
      warn: '⚠️',
      error: '🔥',
      critical: '🚨',
    };

    const detailsStr = typeof details === 'string'
      ? details
      : '```json\n' + JSON.stringify(details, null, 2).substring(0, 1500) + '\n```';

    if (this.webhookType === 'discord') {
      return {
        username: this.appName,
        embeds: [{
          title: `${emojiMap[level] || ''} ${title}`,
          description: detailsStr,
          color: colorMap[level] || 0x808080,
          footer: { text: `${this.environment} • ${new Date().toISOString()}` },
        }],
      };
    }

    if (this.webhookType === 'slack') {
      return {
        text: `${emojiMap[level] || ''} *${title}*`,
        attachments: [{
          color: level === 'error' || level === 'critical' ? 'danger'
               : level === 'warn' ? 'warning'
               : 'good',
          text: detailsStr,
          footer: `${this.appName} • ${this.environment}`,
          ts: Math.floor(Date.now() / 1000),
        }],
      };
    }

    // Generic JSON webhook
    return {
      app: this.appName,
      env: this.environment,
      level,
      title,
      details,
      timestamp: new Date().toISOString(),
    };
  }

  /** Health check do alertManager */
  getStats() {
    return {
      enabled: !!this.webhookUrl,
      webhook_type: this.webhookType,
      rate_limited_keys: this.rateLimitMap.size,
    };
  }
}

// Singleton
const alertManager = new AlertManager();

module.exports = alertManager;
