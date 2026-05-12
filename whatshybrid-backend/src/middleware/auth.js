/**
 * Auth Middleware — JWT verification + tenant isolation.
 *
 * `authenticate` valida JWT no header Authorization, popula:
 *   req.userId        — UUID do user
 *   req.workspaceId   — UUID do workspace (multi-tenant)
 *   req.user          — objeto user completo (sem password)
 *   req.role          — 'user' | 'admin'
 *
 * `authorize(...roles)` factory que retorna middleware exigindo role específica.
 *
 * @module middleware/auth
 */
/**
 * Authentication Middleware
 * v7.9.13: Adicionado cache de sessões em memória
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const config = require('../../config');
const db = require('../utils/database');

// ============================================
// Cache de sessões (TTL: 5 minutos, LRU bounded)
// ============================================
// v9.5.0 BUG #155: cache não tinha MAX size — se 100k tokens autenticados
// chegassem entre limpezas (60s), todos ficavam em RAM. Agora bounded com
// LRU eviction. SESSION_CACHE_MAX é configurável via env.
const sessionCache = new Map();
const SESSION_CACHE_TTL = 5 * 60 * 1000;
const SESSION_CACHE_MAX = parseInt(process.env.SESSION_CACHE_MAX, 10) || 5000;

function cleanupSessionCache() {
  const now = Date.now();
  for (const [key, value] of sessionCache.entries()) {
    if (now - value.timestamp > SESSION_CACHE_TTL) {
      sessionCache.delete(key);
    }
  }
}

function _setSessionCache(key, entry) {
  // Map iteration is insertion-ordered → first key é o LRU.
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    // Evict 10% mais antigos pra evitar custo a cada insert.
    const evict = Math.max(1, Math.floor(SESSION_CACHE_MAX * 0.1));
    let n = 0;
    for (const k of sessionCache.keys()) {
      sessionCache.delete(k);
      if (++n >= evict) break;
    }
  }
  sessionCache.set(key, entry);
}

// Limpar cache periodicamente
// FIX: .unref() permite que o processo termine sem esperar este timer.
// Sem unref, jest tests não terminam (test runner hangs) e SIGTERM espera 60s.
const _sessionCleanupTimer = setInterval(cleanupSessionCache, 60 * 1000);
if (_sessionCleanupTimer.unref) _sessionCleanupTimer.unref();

/**
 * Helper assíncrono para buscar usuário (evita bloquear event loop)
 */
async function getUserByIdAsync(userId) {
  return new Promise((resolve, reject) => {
    try {
      // Tenta método async se disponível, fallback para sync
      if (typeof db.getAsync === 'function') {
        db.getAsync(
          'SELECT id, email, name, role, workspace_id, status FROM users WHERE id = ?',
          [userId]
        ).then(resolve).catch(reject);
      } else {
        // Fallback síncrono (menos ideal mas funciona)
        const result = db.get(
          'SELECT id, email, name, role, workspace_id, status FROM users WHERE id = ?',
          [userId]
        );
        resolve(result);
      }
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Verify JWT token
 * v7.9.13: Usa cache e busca async para evitar bloquear event loop
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];
    
    // Verificar cache primeiro
    const cached = sessionCache.get(token);
    if (cached && Date.now() - cached.timestamp < SESSION_CACHE_TTL) {
      req.user = cached.user;
      req.userId = cached.user.id;
      req.workspaceId = cached.user.workspace_id;
      return next();
    }
    
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    
    // CORREÇÃO: Get user from database de forma assíncrona
    const user = await getUserByIdAsync(decoded.userId);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Account is not active'
      });
    }

    // Atualizar cache
    _setSessionCache(token, { user, timestamp: Date.now() });

    req.user = user;
    req.userId = user.id;
    req.workspaceId = user.workspace_id;
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token expired'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token'
      });
    }

    logger.error('[Auth] Error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication failed'
    });
  }
}

/**
 * Optional authentication (sets user if token present)
 */
function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
      
      const user = db.get(
        'SELECT id, email, name, role, workspace_id FROM users WHERE id = ?',
        [decoded.userId]
      );
      
      if (user) {
        req.user = user;
        req.userId = user.id;
        req.workspaceId = user.workspace_id;
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
}

/**
 * Check if user has required role
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions'
      });
    }

    next();
  };
}

/**
 * Check workspace access
 */
function checkWorkspace(req, res, next) {
  const workspaceId = req.params.workspaceId || req.body.workspace_id || req.workspaceId;
  
  if (!workspaceId) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Workspace ID required'
    });
  }

  // Admin can access any workspace
  if (req.user.role === 'admin') {
    req.workspaceId = workspaceId;
    return next();
  }

  // User can only access their workspace
  if (req.user.workspace_id !== workspaceId) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'No access to this workspace'
    });
  }

  req.workspaceId = workspaceId;
  next();
}

/**
 * Require admin role
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required'
    });
  }

  next();
}

/**
 * API Key authentication (for webhooks)
 */
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required'
    });
  }

  // Find workspace by API key
  const workspace = db.get(
    "SELECT id, name, settings FROM workspaces WHERE json_extract(settings, '$.apiKey') = ?",
    [apiKey]
  );

  if (!workspace) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key'
    });
  }

  req.workspaceId = workspace.id;
  req.workspace = workspace;
  
  next();
}

module.exports = {
  authenticate,
  optionalAuth,
  authorize,
  requireAdmin,
  checkWorkspace,
  apiKeyAuth
};
