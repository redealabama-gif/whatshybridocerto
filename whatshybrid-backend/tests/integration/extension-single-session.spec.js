/**
 * Integração — LIC-02: uma sessão ativa por conta na extensão.
 *
 * A chave de acesso fica presa a um aparelho, mas a IA, o treinamento e a
 * sincronização usam o LOGIN (e-mail/senha), que não tinha limite: a mesma
 * conta funcionava em vários computadores ao mesmo tempo (prova:
 * audit/evidencias/licenca/fluxo-chave.txt, passos 8–9).
 *
 * Regra: login feito pela extensão (client: 'extension') derruba a sessão da
 * extensão no outro computador. O painel do site (login sem client) não é
 * afetado e não derruba a extensão. Sem apagar refresh tokens (isso dispararia
 * a proteção de "token reutilizado", que revoga TODAS as sessões).
 */

const request = require('supertest');
const { ensureDb, buildApp, cleanupDb } = require('./helpers/app');

let app;
const EMAIL = `sessao-${Date.now()}@example.com`;
const SENHA = 'Cliente#Teste2026';

beforeAll(async () => {
  await ensureDb();
  app = buildApp({ '/api/v1/auth': require('../../src/routes/auth') });
  await request(app).post('/api/v1/auth/signup').send({ email: EMAIL, password: SENHA, name: 'Cliente', company: 'Loja' });
});
afterAll(() => cleanupDb());

const login = (extra = {}) => request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: SENHA, ...extra });
const me = (token) => request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

describe('LIC-02 — sessão única da extensão', () => {
  test('entrar no computador B derruba a extensão do computador A na hora', async () => {
    const a = await login({ client: 'extension' });
    expect(a.status).toBe(200);
    expect((await me(a.body.accessToken)).status).toBe(200);
    const b = await login({ client: 'extension' });
    expect(b.status).toBe(200);
    const deA = await me(a.body.accessToken);
    expect(deA.status).toBe(401);
    expect(deA.body.code).toBe('SESSION_REPLACED');
    expect((await me(b.body.accessToken)).status).toBe(200);
  });

  test('o computador A não volta renovando o token, e isso não derruba o B', async () => {
    const a = await login({ client: 'extension' });
    const b = await login({ client: 'extension' });
    const r = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: a.body.refreshToken });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('SESSION_REPLACED');
    expect((await me(b.body.accessToken)).status).toBe(200);
    const rb = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: b.body.refreshToken });
    expect(rb.status).toBe(200);
    expect((await me(rb.body.accessToken)).status).toBe(200);
  });

  test('o painel do site não derruba a extensão nem é derrubado por ela', async () => {
    const ext = await login({ client: 'extension' });
    const site = await login();
    expect((await me(ext.body.accessToken)).status).toBe(200);
    await login({ client: 'extension' });
    expect((await me(site.body.accessToken)).status).toBe(200);
  });
});
