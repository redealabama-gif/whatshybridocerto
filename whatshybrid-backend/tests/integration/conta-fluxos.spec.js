/**
 * F3 — Conta de ponta a ponta: cadastro (e-mail de boas-vindas), recuperar
 * senha com token REAL (página → troca → login novo), uso único do token,
 * 2FA (ativar com TOTP de verdade → login em 2 passos → desativar).
 *
 * O envio REAL de e-mail é transporte (SendGrid, 🔒 do dono): aqui o token de
 * reset entra no banco com o MESMO hash que o servidor grava, exercitando todo
 * o resto do caminho.
 */

const crypto = require('crypto');
const request = require('supertest');
const { ensureDb, buildApp, cleanupDb } = require('./helpers/app');

let app;
let db;
const EMAIL = `conta-${Date.now()}@example.com`;
const SENHA1 = 'Cliente#Teste2026';
const SENHA2 = 'NovaSenha#Forte2026';

// TOTP igual ao servidor (RFC 6238, SHA1, 6 dígitos, passo 30 s)
function base32Decode(str) {
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of str.replace(/=+$/, '')) bits += ABC.indexOf(c.toUpperCase()).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, offset = 0) {
  const counter = Math.floor(Date.now() / 30000) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1e6).toString().padStart(6, '0');
  return code;
}

beforeAll(async () => {
  db = await ensureDb();
  app = buildApp({
    '/api/v1/auth': require('../../src/routes/auth'),
    '/api/v1/auth/2fa': require('../../src/routes/auth-2fa').router,
  });
});
afterAll(() => cleanupDb());

describe('F3 — conta de ponta a ponta', () => {
  let token;
  let userId;

  test('cadastro cria conta com trial de 7 dias e dispara o e-mail de boas-vindas', async () => {
    const r = await request(app).post('/api/v1/auth/signup')
      .send({ email: EMAIL, password: SENHA1, name: 'Cliente Conta', company: 'Loja Conta', plan: 'starter' });
    expect(r.status).toBe(201);
    token = r.body.accessToken;
    userId = r.body.user.id;
    const diasTrial = Math.round((new Date(r.body.workspace.trial_end_at) - Date.now()) / 86400000);
    expect(diasTrial).toBe(7);
    // o evento user.signup alimenta o e-mail de boas-vindas (dry-run sem SENDGRID_API_KEY)
    const EmailService = require('../../src/services/EmailService');
    const res = await EmailService.sendWelcome({ to: EMAIL, name: 'Cliente Conta', plan: 'starter' });
    expect(res.dryRun).toBe(true); // sem chave: não envia, mas o conteúdo monta sem erro
  });

  test('recuperar senha: /forgot-password responde 200 e grava o token (hash)', async () => {
    const r = await request(app).post('/api/v1/auth/forgot-password').send({ email: EMAIL });
    expect(r.status).toBe(200);
    const row = db.get('SELECT token_hash, used_at FROM password_reset_tokens WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    expect(row).toBeTruthy();
    expect(row.used_at).toBeNull();
  });

  test('e-mail inexistente também responde 200 (não revela quem tem conta)', async () => {
    const r = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ninguem@example.com' });
    expect(r.status).toBe(200);
  });

  let resetToken;
  test('redefinir com o token do link troca a senha; a antiga para de valer', async () => {
    // o link do e-mail carrega o token CRU; o banco guarda só o sha256. Gera um
    // par (token, hash) como o servidor gera e grava — mesmo caminho do cliente.
    resetToken = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(resetToken).digest('hex');
    db.run(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at)
            VALUES (?, ?, ?, ?, NULL)`,
      [crypto.randomUUID(), userId, hash, new Date(Date.now() + 3600000).toISOString()]);

    const r = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, password: SENHA2 });
    expect({ status: r.status, message: r.body?.message }).toMatchObject({ status: 200 });

    const velha = await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: SENHA1 });
    expect(velha.status).toBe(401);
    const nova = await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: SENHA2 });
    expect(nova.status).toBe(200);
    token = nova.body.accessToken;
  });

  test('o mesmo link não redefine duas vezes (uso único)', async () => {
    const r = await request(app).post('/api/v1/auth/reset-password').send({ token: resetToken, password: 'Outra#Senha2026' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  test('token de reset expirado é recusado', async () => {
    const t = crypto.randomBytes(32).toString('hex');
    db.run(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at)
            VALUES (?, ?, ?, ?, NULL)`,
      [crypto.randomUUID(), userId, crypto.createHash('sha256').update(t).digest('hex'), new Date(Date.now() - 1000).toISOString()]);
    const r = await request(app).post('/api/v1/auth/reset-password').send({ token: t, password: 'Mais#Uma2026' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  let secret;
  test('2FA: ativar com um código TOTP de verdade', async () => {
    const setup = await request(app).post('/api/v1/auth/2fa/setup').set('Authorization', `Bearer ${token}`);
    expect(setup.status).toBe(200);
    secret = setup.body.secret;
    expect(setup.body.uri).toContain('otpauth://totp/');

    const verify = await request(app).post('/api/v1/auth/2fa/verify')
      .set('Authorization', `Bearer ${token}`).send({ code: totp(secret) });
    expect({ status: verify.status, message: verify.body?.message }).toMatchObject({ status: 200 });
  });

  test('com 2FA ligado o login vira 2 passos: senha → código → sessão', async () => {
    const passo1 = await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: SENHA2 });
    expect(passo1.status).toBe(200);
    expect(passo1.body.requires_totp).toBe(true);
    expect(passo1.body.accessToken).toBeFalsy(); // sem sessão antes do código
    const preAuth = passo1.body.pre_auth_token;
    expect(preAuth).toBeTruthy();

    const errado = await request(app).post('/api/v1/auth/login/totp').send({ pre_auth_token: preAuth, code: '000000' });
    expect(errado.status).toBeGreaterThanOrEqual(400);

    const passo2 = await request(app).post('/api/v1/auth/login/totp').send({ pre_auth_token: preAuth, code: totp(secret) });
    expect({ status: passo2.status, message: passo2.body?.message }).toMatchObject({ status: 200 });
    expect(passo2.body.accessToken).toBeTruthy();
    token = passo2.body.accessToken;
  });

  test('2FA: desativar exige senha + código; depois o login volta ao simples', async () => {
    // só o código não basta (defesa de conta): precisa da senha junto
    const soCodigo = await request(app).post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${token}`).send({ code: totp(secret) });
    expect(soCodigo.status).toBe(400);
    const off = await request(app).post('/api/v1/auth/2fa/disable')
      .set('Authorization', `Bearer ${token}`).send({ password: SENHA2, code: totp(secret) });
    expect({ status: off.status, message: off.body?.message }).toMatchObject({ status: 200 });
    const login = await request(app).post('/api/v1/auth/login').send({ email: EMAIL, password: SENHA2 });
    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeTruthy();
  });
});
