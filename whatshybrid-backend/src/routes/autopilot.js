/**
 * 🤖 AutoPilot Routes
 * 
 * API endpoints para gerenciar sessões de Auto-Pilot
 * 
 * @version 1.0.1
 * @security Todas as rotas requerem autenticação
 */

const express = require('express');
const router = express.Router();
const { AutoPilotService } = require('../ai/services/AutoPilotService');
const { authenticate } = require('../middleware/auth');
const { checkSubscription } = require('../middleware/subscription');
const logger = require('../utils/logger');

// FIX PEND-HIGH-002: Aplicar autenticação e verificação de assinatura em TODAS as rotas
router.use(authenticate);
router.use(checkSubscription('autopilot')); // AutoPilot requer plano starter ou superior

// Initialize service
let service = null;
let initPromise = null;

const getService = async () => {
  if (!service) {
    service = new AutoPilotService();
  }
  // v9.3.3: garante init completou antes de retornar.
  // Antes: getService era síncrono e chamava init() sem await.
  // _ensureTables é síncrono mas _loadActiveSessions também — ainda assim
  // retornar service "não inicializado" era armadilha pra futuras alterações.
  if (!service.initialized) {
    if (!initPromise) initPromise = service.init();
    await initPromise;
  }
  return service;
};

// ============================================================
// SESSÕES
// ============================================================

// Criar nova sessão
router.post('/sessions', async (req, res) => {
  try {
    const { userId, config } = req.body;
    // FIX v8.0.5: validação defensiva — userId tem que ser string razoável
    if (!userId || typeof userId !== 'string' || userId.length > 200) {
      return res.status(400).json({ error: 'userId is required and must be a string (max 200 chars)' });
    }
    if (config !== undefined && (typeof config !== 'object' || Array.isArray(config))) {
      return res.status(400).json({ error: 'config must be an object' });
    }
    const session = (await getService()).createSession(userId, config);
    res.json({ success: true, session: { ...session, blacklist: Array.from(session.blacklist), whitelist: Array.from(session.whitelist) } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar sessões do usuário
router.get('/sessions/user/:userId', async (req, res) => {
  try {
    // FIX v8.0.5: rejeita userId malformado
    if (!req.params.userId || req.params.userId.length > 200) {
      return res.status(400).json({ error: 'invalid userId' });
    }
    const sessions = (await getService()).getUserSessions(req.params.userId);
    res.json({ sessions: sessions.map(s => ({ ...s, blacklist: Array.from(s.blacklist), whitelist: Array.from(s.whitelist) })) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obter sessão específica
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const session = (await getService()).getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ session: { ...session, blacklist: Array.from(session.blacklist), whitelist: Array.from(session.whitelist) } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar sessão
router.post('/sessions/:sessionId/start', async (req, res) => {
  try {
    const session = (await getService()).startSession(req.params.sessionId);
    res.json({ success: true, session: { ...session, blacklist: Array.from(session.blacklist), whitelist: Array.from(session.whitelist) } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Pausar sessão
router.post('/sessions/:sessionId/pause', async (req, res) => {
  try {
    const session = (await getService()).pauseSession(req.params.sessionId);
    res.json({ success: true, session: { ...session, blacklist: Array.from(session.blacklist), whitelist: Array.from(session.whitelist) } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Retomar sessão
router.post('/sessions/:sessionId/resume', async (req, res) => {
  try {
    const session = (await getService()).resumeSession(req.params.sessionId);
    res.json({ success: true, session: { ...session, blacklist: Array.from(session.blacklist), whitelist: Array.from(session.whitelist) } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Parar sessão
router.post('/sessions/:sessionId/stop', async (req, res) => {
  try {
    const { reason } = req.body;
    const session = (await getService()).stopSession(req.params.sessionId, reason || 'manual');
    res.json({ success: true, session: { ...session, blacklist: Array.from(session.blacklist), whitelist: Array.from(session.whitelist) } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Deletar sessão
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const deleted = (await getService()).deleteSession(req.params.sessionId);
    res.json({ success: deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// CONFIGURAÇÕES
// ============================================================

// Atualizar configuração da sessão
router.patch('/sessions/:sessionId/config', async (req, res) => {
  try {
    const { config } = req.body;
    if (!config) {
      return res.status(400).json({ error: 'config is required' });
    }
    const updatedConfig = (await getService()).updateSessionConfig(req.params.sessionId, config);
    res.json({ success: true, config: updatedConfig });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================
// REGISTRO DE ATIVIDADES
// ============================================================

// Registrar mensagem enviada
router.post('/sessions/:sessionId/message-sent', async (req, res) => {
  try {
    const { chatId, message, responseTime } = req.body;
    const stats = (await getService()).recordMessageSent(req.params.sessionId, { chatId, message, responseTime });
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registrar chat processado
router.post('/sessions/:sessionId/chat-processed', async (req, res) => {
  try {
    const { chatId, success } = req.body;
    const stats = (await getService()).recordChatProcessed(req.params.sessionId, chatId, success !== false);
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registrar erro
router.post('/sessions/:sessionId/error', async (req, res) => {
  try {
    const { error } = req.body;
    const stats = (await getService()).recordError(req.params.sessionId, error);
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// LISTAS (BLACKLIST/WHITELIST)
// ============================================================

// Adicionar à blacklist
router.post('/sessions/:sessionId/blacklist', async (req, res) => {
  try {
    const { chatId } = req.body;
    if (!chatId) {
      return res.status(400).json({ error: 'chatId is required' });
    }
    const added = (await getService()).addToBlacklist(req.params.sessionId, chatId);
    res.json({ success: added });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remover da blacklist
router.delete('/sessions/:sessionId/blacklist/:chatId', async (req, res) => {
  try {
    const removed = (await getService()).removeFromBlacklist(req.params.sessionId, req.params.chatId);
    res.json({ success: removed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Adicionar à whitelist
router.post('/sessions/:sessionId/whitelist', async (req, res) => {
  try {
    const { chatId } = req.body;
    if (!chatId) {
      return res.status(400).json({ error: 'chatId is required' });
    }
    const added = (await getService()).addToWhitelist(req.params.sessionId, chatId);
    res.json({ success: added });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remover da whitelist
router.delete('/sessions/:sessionId/whitelist/:chatId', async (req, res) => {
  try {
    const removed = (await getService()).removeFromWhitelist(req.params.sessionId, req.params.chatId);
    res.json({ success: removed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ativar/desativar modo whitelist
router.post('/sessions/:sessionId/whitelist-mode', async (req, res) => {
  try {
    const { enabled } = req.body;
    const set = (await getService()).setWhitelistMode(req.params.sessionId, enabled === true);
    res.json({ success: set, whitelistMode: enabled === true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ESTATÍSTICAS
// ============================================================

// Estatísticas da sessão
router.get('/sessions/:sessionId/stats', async (req, res) => {
  try {
    const stats = (await getService()).getSessionStats(req.params.sessionId);
    if (!stats) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Estatísticas globais
router.get('/stats', async (req, res) => {
  try {
    const stats = (await getService()).getGlobalStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// TEMPLATES
// ============================================================

// Obter templates de resposta
router.get('/templates', async (req, res) => {
  try {
    const { category } = req.query;
    const templates = (await getService()).getResponseTemplates(category);
    res.json({ templates });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// MANUTENÇÃO
// ============================================================

// Limpar sessões antigas
router.post('/cleanup', async (req, res) => {
  try {
    const { maxAgeMs } = req.body;
    const cleaned = (await getService()).cleanupOldSessions(maxAgeMs);
    res.json({ success: true, cleaned });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Status do serviço
router.get('/health', async (req, res) => {
  res.json((await getService()).getStatus());
});

module.exports = router;
