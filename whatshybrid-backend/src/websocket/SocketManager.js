/**
 * 🔌 SocketManager - Gerenciador WebSocket
 * WhatsHybrid Pro v7.1.0
 * 
 * Gerencia conexões WebSocket para sync em tempo real
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

class SocketManager {
  constructor(httpServer, options = {}) {
    this.io = null;
    this.connections = new Map(); // userId -> Set<socketId>
    this.rooms = new Map(); // workspaceId -> Set<socketId>
    
    // SEGURANÇA: JWT_SECRET é obrigatório - não usar fallback previsível
    this.jwtSecret = process.env.JWT_SECRET;
    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required for WebSocket authentication');
    }
    
    if (httpServer) {
      this.initialize(httpServer, options);
    }
  }

  /**
   * Inicializar Socket.IO
   */
  initialize(httpServer, options = {}) {
    this.io = new Server(httpServer, {
      cors: {
        // ✅ Segurança: não usar '*' com credentials.
        // Configure origins via:
        // - options.cors.origin (array/string)
        // - env CORS_ORIGINS (CSV)
        origin: (() => {
          const defaultOrigins = [
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3001'
          ];

          const fromEnv = (process.env.CORS_ORIGINS || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

          let allowed = options.cors?.origin || (fromEnv.length ? fromEnv : defaultOrigins);

          // Se alguém passou '*' por engano, cair para defaults (com credentials=true)
          if (allowed === '*' || (Array.isArray(allowed) && allowed.includes('*'))) {
            allowed = defaultOrigins;
          }

          // Socket.IO aceita função (origin, callback)
          return function(origin, callback) {
            // Alguns clients não enviam Origin (ex: server-to-server). Permitir.
            if (!origin) return callback(null, true);

            if (Array.isArray(allowed)) {
              return allowed.includes(origin)
                ? callback(null, true)
                : callback(new Error('CORS origin not allowed'), false);
            }

            if (typeof allowed === 'string') {
              return (allowed === origin)
                ? callback(null, true)
                : callback(new Error('CORS origin not allowed'), false);
            }

            // fallback seguro
            return defaultOrigins.includes(origin)
              ? callback(null, true)
              : callback(new Error('CORS origin not allowed'), false);
          };
        })(),
        methods: ['GET', 'POST'],
        credentials: true
      },
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Middleware de autenticação
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      try {
        const payload = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] });
        socket.userId = payload.userId;
        socket.workspaceId = payload.workspaceId;
        socket.userRole = payload.role;
        next();
      } catch (error) {
        next(new Error('Invalid token'));
      }
    });

    // Handler de conexão
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    logger.info('[SocketManager] ✅ Initialized');
    return this;
  }

  /**
   * Handler de nova conexão
   */
  handleConnection(socket) {
    const { userId, workspaceId } = socket;
    
    logger.info(`[Socket] User ${userId} connected (${socket.id})`);

    // Adicionar às conexões do usuário
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId).add(socket.id);

    // Entrar na room do workspace
    if (workspaceId) {
      socket.join(`workspace:${workspaceId}`);
      
      if (!this.rooms.has(workspaceId)) {
        this.rooms.set(workspaceId, new Set());
      }
      this.rooms.get(workspaceId).add(socket.id);
    }

    // Entrar na room do usuário (para notificações pessoais)
    socket.join(`user:${userId}`);

    // Enviar confirmação de conexão
    socket.emit('connected', {
      socketId: socket.id,
      userId,
      workspaceId,
      timestamp: new Date()
    });

    // Handlers de eventos
    this.setupEventHandlers(socket);

    // Handler de desconexão
    socket.on('disconnect', (reason) => {
      this.handleDisconnection(socket, reason);
    });
  }

  /**
   * Handler de desconexão
   */
  handleDisconnection(socket, reason) {
    const { userId, workspaceId } = socket;
    
    logger.info(`[Socket] User ${userId} disconnected (${reason})`);

    // Remover das conexões do usuário
    if (this.connections.has(userId)) {
      this.connections.get(userId).delete(socket.id);
      if (this.connections.get(userId).size === 0) {
        this.connections.delete(userId);
      }
    }

    // Remover da room do workspace
    if (workspaceId && this.rooms.has(workspaceId)) {
      this.rooms.get(workspaceId).delete(socket.id);
      if (this.rooms.get(workspaceId).size === 0) {
        this.rooms.delete(workspaceId);
      }
    }
  }

  /**
   * Setup de handlers de eventos
   */
  setupEventHandlers(socket) {
    // Ping/pong para manter conexão viva
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // Sync request
    socket.on('sync:request', async (data) => {
      socket.emit('sync:ack', { requestId: data.requestId, status: 'received' });
    });

    // Subscribe to specific events
    socket.on('subscribe', (events) => {
      if (Array.isArray(events)) {
        events.forEach(event => {
          socket.join(`event:${event}`);
        });
      }
    });

    // Unsubscribe from events
    socket.on('unsubscribe', (events) => {
      if (Array.isArray(events)) {
        events.forEach(event => {
          socket.leave(`event:${event}`);
        });
      }
    });

    // Typing indicator
    socket.on('typing:start', (data) => {
      socket.to(`workspace:${socket.workspaceId}`).emit('typing:update', {
        userId: socket.userId,
        contactId: data.contactId,
        isTyping: true
      });
    });

    socket.on('typing:stop', (data) => {
      socket.to(`workspace:${socket.workspaceId}`).emit('typing:update', {
        userId: socket.userId,
        contactId: data.contactId,
        isTyping: false
      });
    });
  }

  // ============================================
  // MÉTODOS DE EMISSÃO
  // ============================================

  /**
   * Emitir para um usuário específico
   */
  emitToUser(userId, event, data) {
    this.io?.to(`user:${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Emitir para todos do workspace
   */
  emitToWorkspace(workspaceId, event, data) {
    this.io?.to(`workspace:${workspaceId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Emitir para todos
   */
  emitToAll(event, data) {
    this.io?.emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  /**
   * Emitir para subscribers de um evento
   */
  emitToEvent(eventName, data) {
    this.io?.to(`event:${eventName}`).emit(eventName, {
      ...data,
      timestamp: new Date()
    });
  }

  // ============================================
  // EVENTOS DE NEGÓCIO
  // ============================================

  /**
   * Notificar novo contato
   */
  notifyContactCreated(workspaceId, contact) {
    this.emitToWorkspace(workspaceId, 'contact:created', { contact });
  }

  /**
   * Notificar contato atualizado
   */
  notifyContactUpdated(workspaceId, contact) {
    this.emitToWorkspace(workspaceId, 'contact:updated', { contact });
  }

  /**
   * Notificar nova mensagem
   */
  notifyMessageReceived(workspaceId, message, contact) {
    this.emitToWorkspace(workspaceId, 'message:received', { message, contact });
  }

  /**
   * Notificar mensagem enviada
   */
  notifyMessageSent(workspaceId, message, contact) {
    this.emitToWorkspace(workspaceId, 'message:sent', { message, contact });
  }

  /**
   * Notificar novo deal
   */
  notifyDealCreated(workspaceId, deal) {
    this.emitToWorkspace(workspaceId, 'deal:created', { deal });
  }

  /**
   * Notificar deal atualizado
   */
  notifyDealUpdated(workspaceId, deal) {
    this.emitToWorkspace(workspaceId, 'deal:updated', { deal });
  }

  /**
   * Notificar nova tarefa
   */
  notifyTaskCreated(workspaceId, task, assigneeId) {
    this.emitToWorkspace(workspaceId, 'task:created', { task });
    if (assigneeId) {
      this.emitToUser(assigneeId, 'task:assigned', { task });
    }
  }

  /**
   * Notificar tarefa vencendo
   */
  notifyTaskDue(userId, task) {
    this.emitToUser(userId, 'task:due', { task });
  }

  /**
   * Notificar progresso de campanha
   */
  notifyCampaignProgress(workspaceId, campaign, progress) {
    this.emitToWorkspace(workspaceId, 'campaign:progress', { campaign, progress });
  }

  /**
   * Notificar AI response
   */
  notifyAIResponse(userId, response) {
    this.emitToUser(userId, 'ai:response', { response });
  }

  /**
   * Notificar sync completo
   */
  notifySyncComplete(userId, syncType, results) {
    this.emitToUser(userId, 'sync:complete', { syncType, results });
  }

  // ============================================
  // UTILITÁRIOS
  // ============================================

  /**
   * Verificar se usuário está online
   */
  isUserOnline(userId) {
    return this.connections.has(userId) && this.connections.get(userId).size > 0;
  }

  /**
   * Obter quantidade de conexões de um usuário
   */
  getUserConnectionCount(userId) {
    return this.connections.get(userId)?.size || 0;
  }

  /**
   * Obter quantidade de usuários online no workspace
   */
  getWorkspaceOnlineCount(workspaceId) {
    return this.rooms.get(workspaceId)?.size || 0;
  }

  /**
   * Obter estatísticas
   */
  getStats() {
    return {
      totalConnections: this.io?.engine?.clientsCount || 0,
      uniqueUsers: this.connections.size,
      activeWorkspaces: this.rooms.size,
      uptime: process.uptime()
    };
  }

  /**
   * Desconectar usuário (todas as conexões)
   */
  disconnectUser(userId, reason = 'Forced disconnect') {
    const connections = this.connections.get(userId);
    if (connections) {
      for (const socketId of connections) {
        const socket = this.io?.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit('force_disconnect', { reason });
          socket.disconnect(true);
        }
      }
    }
  }

  /**
   * Broadcast de manutenção
   */
  broadcastMaintenance(message, disconnectIn = 0) {
    this.emitToAll('maintenance', { message, disconnectIn });
    
    if (disconnectIn > 0) {
      setTimeout(() => {
        this.io?.disconnectSockets(true);
      }, disconnectIn);
    }
  }
}

// Singleton
let instance = null;

module.exports = {
  SocketManager,
  getInstance: () => instance,
  initialize: (httpServer, options) => {
    instance = new SocketManager(httpServer, options);
    return instance;
  }
};
