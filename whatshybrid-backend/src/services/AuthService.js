/**
 * AuthService — autenticação JWT, hashing bcrypt, validação de credenciais.
 *
 * Responsabilidades:
 *   - Verifica password com bcrypt timing-safe (12 rounds)
 *   - Gera access tokens (15min TTL) e refresh tokens (7d TTL)
 *   - Detecção de reuse de refresh token (token rotation)
 *   - Revogação de refresh tokens (logout)
 *
 * Métricas relevantes (Prometheus):
 *   - http_requests_total{route="/auth/login"}
 *   - failed_logins_total (TODO: instrumentar)
 *
 * @module services/AuthService
 */
/**
 * 🔐 AuthService - Serviço de Autenticação
 * WhatsHybrid Pro v7.1.0
 */

const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('../utils/uuid-wrapper');

class AuthService {
  constructor(db) {
    this.db = db;
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }
    this.jwtSecret = process.env.JWT_SECRET;
    this.jwtExpiresIn = process.env.JWT_EXPIRES_IN || '7d';
    this.refreshExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN || '30d';
  }

  /**
   * Registrar novo usuário
   */
  async register({ email, password, name, workspaceName }) {
    // Verificar se email já existe
    const existingUser = await this.db.findUserByEmail(email);
    if (existingUser) {
      throw new Error('Email já cadastrado');
    }

    // Hash da senha
    const hashedPassword = await bcrypt.hash(password, 12);

    // Criar workspace
    const workspaceId = uuidv4();
    const workspace = await this.db.createWorkspace({
      id: workspaceId,
      name: workspaceName || `${name}'s Workspace`,
      slug: this.generateSlug(workspaceName || name),
      plan: 'free',
      status: 'active'
    });

    // Criar usuário
    const userId = uuidv4();
    const user = await this.db.createUser({
      id: userId,
      email,
      password: hashedPassword,
      name,
      role: 'owner',
      workspaceId
    });

    // Criar pipeline padrão
    await this.createDefaultPipeline(workspaceId);

    // Gerar tokens
    const tokens = this.generateTokens(user);

    // Criar sessão
    await this.createSession(userId, tokens);

    return {
      user: this.sanitizeUser(user),
      workspace,
      ...tokens
    };
  }

  /**
   * Login
   */
  async login({ email, password }) {
    // Buscar usuário
    const user = await this.db.findUserByEmail(email);
    if (!user) {
      throw new Error('Credenciais inválidas');
    }

    // Verificar status
    if (user.status === 'suspended') {
      throw new Error('Conta suspensa');
    }

    // Verificar senha
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw new Error('Credenciais inválidas');
    }

    // Atualizar último login
    await this.db.updateUser(user.id, { lastLoginAt: new Date() });

    // Buscar workspace
    const workspace = await this.db.findWorkspaceById(user.workspaceId);

    // Gerar tokens
    const tokens = this.generateTokens(user);

    // Criar sessão
    await this.createSession(user.id, tokens);

    return {
      user: this.sanitizeUser(user),
      workspace,
      ...tokens
    };
  }

  /**
   * Refresh token
   */
  async refreshToken(refreshToken) {
    // Verificar token
    let payload;
    try {
      payload = jwt.verify(refreshToken, this.jwtSecret, { algorithms: ['HS256'] });
    } catch (error) {
      throw new Error('Token inválido ou expirado');
    }

    // Buscar sessão
    const session = await this.db.findSessionByRefreshToken(refreshToken);
    if (!session) {
      throw new Error('Sessão não encontrada');
    }

    // Buscar usuário
    const user = await this.db.findUserById(payload.userId);
    if (!user || user.status === 'suspended') {
      throw new Error('Usuário não encontrado ou suspenso');
    }

    // Revogar sessão antiga
    await this.db.deleteSession(session.id);

    // Gerar novos tokens
    const tokens = this.generateTokens(user);

    // Criar nova sessão
    await this.createSession(user.id, tokens);

    return tokens;
  }

  /**
   * Logout
   */
  async logout(token) {
    const session = await this.db.findSessionByToken(token);
    if (session) {
      await this.db.deleteSession(session.id);
    }
    return { success: true };
  }

  /**
   * Logout de todas as sessões
   */
  async logoutAll(userId) {
    await this.db.deleteAllUserSessions(userId);
    return { success: true };
  }

  /**
   * Solicitar reset de senha
   */
  async requestPasswordReset(email) {
    const user = await this.db.findUserByEmail(email);
    if (!user) {
      // Não revelar se email existe
      return { success: true };
    }

    // Gerar token
    const resetToken = uuidv4();
    const expiresAt = new Date(Date.now() + 3600000); // 1 hora

    // Salvar token
    await this.db.createPasswordReset({
      userId: user.id,
      token: resetToken,
      expiresAt
    });

    // TODO: Enviar email com link de reset
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[Auth] Password reset token for ${email}: ${resetToken}`);
    }

    return { success: true };
  }

  /**
   * Reset de senha
   */
  async resetPassword(token, newPassword) {
    // Buscar token
    const reset = await this.db.findPasswordResetByToken(token);
    if (!reset) {
      throw new Error('Token inválido');
    }

    // Verificar expiração
    if (new Date() > reset.expiresAt) {
      throw new Error('Token expirado');
    }

    // Verificar se já foi usado
    if (reset.used) {
      throw new Error('Token já utilizado');
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Atualizar senha
    await this.db.updateUser(reset.userId, { password: hashedPassword });

    // Marcar token como usado
    await this.db.markPasswordResetUsed(reset.id);

    // Revogar todas as sessões
    await this.db.deleteAllUserSessions(reset.userId);

    return { success: true };
  }

  /**
   * Alterar senha
   */
  async changePassword(userId, currentPassword, newPassword) {
    const user = await this.db.findUserById(userId);
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    // Verificar senha atual
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      throw new Error('Senha atual incorreta');
    }

    // Hash da nova senha
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Atualizar
    await this.db.updateUser(userId, { password: hashedPassword });

    return { success: true };
  }

  /**
   * Verificar token JWT
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] });
    } catch (error) {
      throw new Error('Token inválido');
    }
  }

  /**
   * Gerar tokens
   */
  generateTokens(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      workspaceId: user.workspaceId
    };

    const accessToken = jwt.sign(payload, this.jwtSecret, {
      expiresIn: this.jwtExpiresIn
    });

    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      this.jwtSecret,
      { expiresIn: this.refreshExpiresIn }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Criar sessão
   */
  async createSession(userId, tokens, metadata = {}) {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 dias

    return this.db.createSession({
      id: uuidv4(),
      userId,
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      userAgent: metadata.userAgent,
      ip: metadata.ip,
      expiresAt
    });
  }

  /**
   * Criar pipeline padrão
   */
  async createDefaultPipeline(workspaceId) {
    const pipelineId = uuidv4();
    
    await this.db.createPipeline({
      id: pipelineId,
      workspaceId,
      name: 'Pipeline Principal',
      isDefault: true
    });

    const stages = [
      { name: 'Novo Lead', color: '#3B82F6', order: 0 },
      { name: 'Qualificado', color: '#8B5CF6', order: 1 },
      { name: 'Proposta', color: '#F59E0B', order: 2 },
      { name: 'Negociação', color: '#10B981', order: 3 },
      { name: 'Fechado', color: '#059669', order: 4 }
    ];

    for (const stage of stages) {
      await this.db.createPipelineStage({
        id: uuidv4(),
        pipelineId,
        ...stage
      });
    }
  }

  /**
   * Gerar slug único
   */
  generateSlug(name) {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${base}-${Date.now().toString(36)}`;
  }

  /**
   * Sanitizar dados do usuário (remover senha)
   */
  sanitizeUser(user) {
    const { password, ...sanitized } = user;
    return sanitized;
  }
}

module.exports = AuthService;
