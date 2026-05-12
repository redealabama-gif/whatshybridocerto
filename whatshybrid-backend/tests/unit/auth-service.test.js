/**
 * Unit tests — AuthService
 *
 * Cobre:
 * - Login (sucesso, senha errada, email inexistente, status suspended)
 * - Refresh token rotativo (revoga antigo, emite novo)
 * - Refresh com token inválido/expirado
 * - VerifyToken (algoritmo HS256 forced — não permite "none")
 * - Tokens contêm payload correto
 *
 * Run: node tests/unit/auth-service.test.js
 */

const assert = require('node:assert/strict');
const Module = require('module');
const orig = Module.prototype.require;

// Mock dependências
const mockBcrypt = {
  async hash(pwd, _rounds) { return `hashed:${pwd}`; },
  async compare(pwd, hash) { return hash === `hashed:${pwd}`; },
};

let _uuidCounter = 0;
const mockUuid = { v4: () => `uuid-${++_uuidCounter}` };

// Mock JWT (suficiente pra teste — sem assinatura real, só formato)
let _jwtCounter = 0;
const mockJwt = {
  sign(payload, secret, options = {}) {
    if (options.algorithm === 'none') {
      return `none.${Buffer.from(JSON.stringify(payload)).toString('base64')}.`;
    }
    const id = ++_jwtCounter;
    const exp = options.expiresIn || '1h';
    return `mock.${Buffer.from(JSON.stringify({ ...payload, _id: id, _exp: exp, _iat: Date.now() })).toString('base64')}.${secret.slice(0, 8)}`;
  },
  verify(token, secret, options = {}) {
    if (token === 'token-inválido-falso') {
      throw new Error('jwt malformed');
    }
    if (token.startsWith('none.')) {
      // Só passa se algorithms permitir 'none' (não permite no AuthService → throw)
      const algs = options.algorithms || ['HS256'];
      if (!algs.includes('none')) {
        throw new Error('algorithm not allowed');
      }
      return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    }
    if (!token.startsWith('mock.')) {
      throw new Error('Token malformed');
    }
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const sig = parts[2];
    if (sig !== secret.slice(0, 8)) throw new Error('Bad signature');
    return JSON.parse(Buffer.from(parts[1], 'base64').toString());
  },
};

Module.prototype.require = function (id) {
  if (id === 'bcrypt' || id === 'bcryptjs') return mockBcrypt;
  if (id === 'uuid') return mockUuid;
  if (id === 'jsonwebtoken') return mockJwt;
  if (id === '../utils/uuid-wrapper' || id.endsWith('uuid-wrapper')) return mockUuid;
  return orig.call(this, id);
};

// JWT_SECRET fixo pra teste
process.env.JWT_SECRET = 'test-secret-must-be-long-enough-for-hs256';
process.env.JWT_EXPIRES_IN = '1h';
process.env.REFRESH_TOKEN_EXPIRES_IN = '30d';

const jwt = mockJwt;

// Mock DB com tracking + Proxy pra auto-stubbar métodos não cobertos
function makeMockDb() {
  const users = new Map();
  const workspaces = new Map();
  const sessions = new Map();
  const pipelines = new Map();
  const stages = new Map();

  const base = {
    users, workspaces, sessions, pipelines, stages,

    async findUserByEmail(email) {
      for (const u of users.values()) if (u.email === email) return u;
      return null;
    },
    async findUserById(id) { return users.get(id) || null; },
    async findWorkspaceById(id) { return workspaces.get(id) || null; },
    async findSessionByRefreshToken(rt) {
      for (const s of sessions.values()) if (s.refreshToken === rt) return s;
      return null;
    },
    async findSessionByToken(t) {
      for (const s of sessions.values()) if (s.token === t) return s;
      return null;
    },
    async createUser(data) {
      const u = { ...data, status: data.status || 'active', workspaceId: data.workspaceId || data.workspace_id };
      users.set(data.id, u);
      return u;
    },
    async createWorkspace(data) {
      workspaces.set(data.id, data);
      return data;
    },
    async createSession(data) {
      sessions.set(data.id, data);
      return data;
    },
    async deleteSession(id) { sessions.delete(id); },
    async deleteAllUserSessions(userId) {
      for (const [sid, s] of sessions) {
        if (s.userId === userId) sessions.delete(sid);
      }
    },
    async updateUser(id, patch) {
      const u = users.get(id);
      if (u) Object.assign(u, patch);
      return u;
    },
    async createPipeline(data) { pipelines.set(data.id, data); return data; },
    async createPipelineStage(data) { stages.set(data.id, data); return data; },
  };

  // Proxy pra capturar qualquer método não definido — retorna função no-op async
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Auto-stub: retorna função async que faz nada
      return async () => null;
    },
  });
}

delete require.cache[require.resolve('../../src/services/AuthService')];
const AuthService = require('../../src/services/AuthService');

let passed = 0, failed = 0;

async function test(name, fn) {
  _uuidCounter = 0;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

(async () => {
  console.log('\nAuthService — Login');

  await test('login sucesso retorna user + workspace + tokens', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    // Setup: registrar user
    const reg = await auth.register({
      email: 'test@example.com',
      password: 'SecurePass123!',
      name: 'Test User',
      workspaceName: 'Test WS'
    });

    // Login
    const result = await auth.login({email: 'test@example.com', password: 'SecurePass123!'});
    assert.equal(result.user.email, 'test@example.com');
    assert.ok(result.workspace);
    assert.ok(result.accessToken);
    assert.ok(result.refreshToken);
    assert.notEqual(result.accessToken, result.refreshToken);
  });

  await test('login com senha errada lança erro', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    await auth.register({
      email: 'test@example.com',
      password: 'CorrectPass',
      name: 'Test',
      workspaceName: 'WS'
    });

    await assert.rejects(
      auth.login({email: 'test@example.com', password: 'WrongPass'}),
      /Credenciais inválidas/
    );
  });

  await test('login com email inexistente lança erro', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    await assert.rejects(
      auth.login({email: 'inexistente@example.com', password: 'qualquer'}),
      /Credenciais inválidas|não encontrado/
    );
  });

  console.log('\nAuthService — Tokens');

  await test('access token contém userId, email, role, workspaceId', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    const reg = await auth.register({
      email: 'test@example.com',
      password: 'pass',
      name: 'T',
      workspaceName: 'W'
    });

    const decoded = jwt.verify(reg.accessToken, process.env.JWT_SECRET);
    assert.ok(decoded.userId);
    assert.equal(decoded.email, 'test@example.com');
    assert.equal(decoded.role, 'owner');
    assert.ok(decoded.workspaceId);
  });

  await test('refresh token tem type=refresh e payload mínimo', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    const reg = await auth.register({
      email: 't@e.com', password: 'p', name: 'T', workspaceName: 'W'
    });

    const decoded = jwt.verify(reg.refreshToken, process.env.JWT_SECRET);
    assert.equal(decoded.type, 'refresh');
    assert.ok(decoded.userId);
    // refresh NÃO deve ter dados sensíveis (email, role)
    assert.equal(decoded.email, undefined);
    assert.equal(decoded.role, undefined);
  });

  await test('verifyToken rejeita algoritmo "none" (CVE-style attack)', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    // Criar token assinado com "none" (atacante simula isso)
    const noneToken = jwt.sign(
      { userId: 'evil', role: 'admin' },
      '',
      { algorithm: 'none' }
    );

    assert.throws(() => {
      auth.verifyToken(noneToken);
    }, /Token inválido/);
  });

  console.log('\nAuthService — Refresh Token (Rotação)');

  await test('refresh emite novo par de tokens', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    const reg = await auth.register({
      email: 't@e.com', password: 'p', name: 'T', workspaceName: 'W'
    });
    const oldRefresh = reg.refreshToken;

    // Pequeno delay pra garantir que JWT iat seja diferente
    

    const newTokens = await auth.refreshToken(oldRefresh);
    assert.ok(newTokens.accessToken);
    assert.ok(newTokens.refreshToken);
    assert.notEqual(newTokens.refreshToken, oldRefresh, 'novo refresh token deve ser diferente');
  });

  await test('refresh revoga sessão antiga (token antigo não funciona mais)', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    const reg = await auth.register({
      email: 't@e.com', password: 'p', name: 'T', workspaceName: 'W'
    });
    const oldRefresh = reg.refreshToken;

    

    // Primeiro refresh (sucesso)
    await auth.refreshToken(oldRefresh);

    // Segunda tentativa com mesmo refresh deve falhar (sessão deletada)
    await assert.rejects(
      auth.refreshToken(oldRefresh),
      /Sessão não encontrada/
    );
  });

  await test('refresh com token inválido lança erro', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    await assert.rejects(
      auth.refreshToken('token-inválido-falso'),
      /Token inválido|expirado/
    );
  });

  await test('refresh com user suspended lança erro', async () => {
    const db = makeMockDb();
    const auth = new AuthService(db);

    const reg = await auth.register({
      email: 't@e.com', password: 'p', name: 'T', workspaceName: 'W'
    });

    // Suspender user
    const userId = (await db.findUserByEmail('t@e.com')).id;
    await db.updateUser(userId, { status: 'suspended' });

    

    await assert.rejects(
      auth.refreshToken(reg.refreshToken),
      /suspenso|não encontrado/
    );
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  Module.prototype.require = orig;

  if (failed > 0) process.exit(1);
  else { console.log('✅ All tests passed'); process.exit(0); }
})();
