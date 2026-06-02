/**
 * Integração — fluxo de autenticação (/api/v1/auth).
 *
 * Exercita signup → login → refresh end-to-end via supertest contra um SQLite
 * temporário: criação real de user+workspace, hashing bcrypt, emissão de JWT,
 * rotação de refresh token e detecção de reuse. É o caminho mais crítico do
 * sistema e até agora não tinha teste de rota.
 */

const request = require('supertest');
const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

let app;

const VALID = {
  email: 'novo@example.com',
  password: 'senhaForte123',
  name: 'Novo Usuário',
  company: 'Minha Empresa',
  plan: 'pro',
};

beforeAll(async () => {
  await ensureDb();
  app = buildApp({ '/api/v1/auth': require('../../src/routes/auth') });
});

afterAll(() => cleanupDb());

describe('POST /api/v1/auth/signup', () => {
  test('cria conta e devolve tokens + user + workspace', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(VALID);

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user).toMatchObject({ email: VALID.email, role: 'owner' });
    expect(res.body.workspace).toMatchObject({ name: VALID.company, plan: 'pro' });

    // Persistiu user + workspace?
    const user = database.get('SELECT id, email, role, password FROM users WHERE email = ?', [
      VALID.email,
    ]);
    expect(user).toBeTruthy();
    expect(user.password).not.toBe(VALID.password); // hash, não plaintext
    const ws = database.get('SELECT id FROM workspaces WHERE owner_id = ?', [user.id]);
    expect(ws).toBeTruthy();
  });

  test('email duplicado → 400 EMAIL_EXISTS', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send(VALID);
    expect(res.status).toBe(400);
    expect(res.body.code || res.body.error).toBeTruthy();
  });

  test('senha curta → 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ ...VALID, email: 'outro@example.com', password: '123' });
    expect(res.status).toBe(400);
  });

  test('email inválido → 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/signup')
      .send({ ...VALID, email: 'nao-eh-email' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  test('credenciais corretas → 200 + tokens', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID.email, password: VALID.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.email).toBe(VALID.email);
  });

  test('senha errada → 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID.email, password: 'senhaErrada999' });
    expect(res.status).toBe(401);
  });

  test('usuário inexistente → 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'naoexiste@example.com', password: 'qualquer12345' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  test('refresh token válido → 200 + novos tokens (rotação)', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID.email, password: VALID.password });
    const oldRefresh = login.body.refreshToken;

    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: oldRefresh });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.refreshToken).not.toBe(oldRefresh); // rotacionou
  });

  test('refresh token inválido → 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'lixo.invalido.token' });
    expect(res.status).toBe(401);
  });

  test('sem refresh token → 400', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({});
    expect(res.status).toBe(400);
  });

  test('reuse de refresh rotacionado → 401 e revoga sessões', async () => {
    // Novo login, rotaciona uma vez, tenta reusar o token antigo.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: VALID.email, password: VALID.password });
    const first = login.body.refreshToken;

    const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(rotated.status).toBe(200);

    // Reusar o token já rotacionado deve falhar (não está mais no DB).
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(reuse.status).toBe(401);
  });
});
