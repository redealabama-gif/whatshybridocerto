/**
 * Extension Download Routes - v8.3.0
 * 
 * Serve o zip da extensão Chrome para o cliente baixar.
 * Em produção, recomenda-se publicar na Chrome Web Store e este endpoint
 * fica como fallback para "instalação manual" durante beta.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * GET /api/v1/extension/download
 * Baixa o zip da extensão. Requer autenticação para evitar
 * scraping público.
 *
 * Espera um zip pré-criado em:
 *   public/downloads/whatshybrid-extension-latest.zip
 *
 * Você gera esse zip via script de release:
 *   cd whatshybrid-extension
 *   zip -r ../whatshybrid-backend/public/downloads/whatshybrid-extension-latest.zip . -x "*.git*"
 */
router.get('/download', authenticate, (req, res) => {
  const zipPath = path.join(__dirname, '../../public/downloads/whatshybrid-extension-latest.zip');

  if (!fs.existsSync(zipPath)) {
    logger.warn(`[Extension] Download requested but zip not found at ${zipPath}`);
    return res.status(503).json({
      error: 'Extensão temporariamente indisponível para download direto',
      message: 'Em breve disponível na Chrome Web Store. Entre em contato com o suporte.',
      hint: 'Admin: gere o zip em public/downloads/whatshybrid-extension-latest.zip',
    });
  }

  logger.info(`[Extension] Download by user ${req.userId} (workspace ${req.workspaceId})`);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="whatshybrid-extension.zip"');
  fs.createReadStream(zipPath).pipe(res);
});

/**
 * GET /api/v1/extension/version
 * Informa a versão atual disponível (para a extensão fazer update check)
 */
router.get('/version', (req, res) => {
  let version = 'unknown';
  try {
    const manifestPath = path.join(__dirname, '../../../whatshybrid-extension/manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      version = manifest.version || 'unknown';
    }
  } catch (_) {}

  res.json({
    version,
    latest: version,
    update_url: '/api/v1/extension/download',
  });
});

/**
 * POST /api/v1/extension/telemetry/hooks-failed — v8.5.0
 *
 * Recebe telemetria quando wpp-hooks.js falhar na extensão (geralmente
 * indica que o WhatsApp Web fez uma atualização interna que quebrou nosso
 * gancho). Útil para detectar quando precisamos atualizar o módulo.
 *
 * Não requer autenticação (queremos receber telemetria mesmo de usuários
 * com extensão fora do contexto SaaS), mas aplica rate limit por IP.
 */
const telemetryLimiter = require('express-rate-limit')({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
});

router.post('/telemetry/hooks-failed', telemetryLimiter, (req, res) => {
  try {
    const { error, stack, userAgent, whatsappVersion, timestamp } = req.body || {};

    logger.error('[ExtensionTelemetry] Hooks failed', {
      error: String(error).substring(0, 500),
      whatsappVersion: String(whatsappVersion).substring(0, 50),
      userAgent: String(userAgent).substring(0, 200),
      timestamp,
      ip: req.ip,
    });

    // Persiste em SQLite se a tabela existir (criar via migration depois se quiser dashboard)
    try {
      const db = require('../utils/database');
      const { v4: uuidv4 } = require('../utils/uuid-wrapper');
      // Tenta inserir; falha silenciosa se tabela não existir
      db.run(
        `INSERT INTO extension_telemetry (id, event_type, error, stack, user_agent, wa_version, ip, created_at)
         VALUES (?, 'hooks_failed', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          String(error || '').substring(0, 1000),
          String(stack || '').substring(0, 2000),
          String(userAgent || '').substring(0, 300),
          String(whatsappVersion || '').substring(0, 50),
          req.ip,
        ]
      );
    } catch (_) {
      // tabela não existe — só log
    }

    res.json({ received: true });
  } catch (err) {
    logger.error(`[ExtensionTelemetry] Error: ${err.message}`);
    res.status(500).json({ error: 'telemetry failed' });
  }
});

module.exports = router;
