/**
 * Integração — direitos LGPD do titular (/api/v1/me).
 *
 * Prova, contra DB real + JWT real, os direitos do art. 18 da LGPD já expostos
 * em routes/me.js (antes sem nenhum teste):
 *   - PORTABILIDADE/ACESSO (GET /me/export): devolve os dados do titular
 *     escopados ao workspace, SEM segredos (password/totp), e SEM vazar dados de
 *     outro tenant.
 *   - EXCLUSÃO (POST /me/delete-account): exige confirmação; anonimiza usuário e
 *     PII de contatos, cancela o workspace, revoga refresh tokens e registra o
 *     log de exclusão como 'completed' — sem afetar outro tenant.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

const A = { ws: 'ws-lgpd-a', user: 'user-lgpd-a' };
const B = { ws: 'ws-lgpd-b', user: 'user-lgpd-b' };

let app;
let tokenA;

const auth = (token) => ({ Authorization: `Bearer ${token}` });

function seedTenant(t, contactName) {
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id, totp_secret) VALUES (?, ?, ?, ?, 'user', 'active', ?, 'SECRET_TOTP')`,
    [t.user, `${t.user}@example.com`, 'hashed-pw', `Owner ${t.user}`, t.ws]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status, auto_renew_enabled) VALUES (?, ?, ?, 'pro', 'active', 1)`,
    [t.ws, `WS ${t.ws}`, t.user]
  );
  database.run(`INSERT INTO contacts (id, workspace_id, phone, name) VALUES (?, ?, ?, ?)`, [
    `contact-${t.ws}`,
    t.ws,
    '5511999990000',
    contactName,
  ]);
}

beforeAll(async () => {
  await ensureDb();
  app = buildApp({ '/api/v1/me': require('../../src/routes/me') });
  tokenA = jwt.sign({ userId: A.user }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
});

afterAll(() => cleanupDb());

beforeEach(() => {
  for (const tbl of ['refresh_tokens', 'contacts', 'data_deletion_log', 'workspaces', 'users']) {
    try {
      database.run(`DELETE FROM ${tbl}`);
    } catch (_) {
      /* ignore */
    }
  }
  seedTenant(A, 'Contato A');
  seedTenant(B, 'Contato B');
  database.run(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ('rt-a', ?, 'tok-a', datetime('now','+7 days'))`,
    [A.user]
  );
});

describe('GET /me/export — portabilidade/acesso', () => {
  test('devolve dados do titular, sem segredos e sem vazar outro tenant', async () => {
    const res = await request(app).get('/api/v1/me/export').set(auth(tokenA));
    expect(res.status).toBe(200);

    expect(res.body.user.id).toBe(A.user);
    // segredos sanitizados
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.totp_secret).toBeUndefined();

    // escopo: só dados do workspace de A
    expect(res.body.workspace.id).toBe(A.ws);
    const contactNames = res.body.contacts.map((c) => c.name);
    expect(contactNames).toContain('Contato A');
    expect(contactNames).not.toContain('Contato B');

    // header de download
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });
});

describe('POST /me/delete-account — direito de exclusão', () => {
  test('sem confirmação → 400 e nada muda', async () => {
    const res = await request(app).post('/api/v1/me/delete-account').set(auth(tokenA)).send({});
    expect(res.status).toBe(400);
    const u = database.get('SELECT status FROM users WHERE id = ?', [A.user]);
    expect(u.status).toBe('active');
  });

  test('com confirmação → anonimiza, cancela workspace, revoga tokens e loga', async () => {
    const res = await request(app)
      .post('/api/v1/me/delete-account')
      .set(auth(tokenA))
      .send({ confirmation: 'EXCLUIR_MINHA_CONTA', reason: 'teste' });
    expect(res.status).toBe(200);
    expect(res.body.deletion_id).toBeTruthy();

    // usuário anonimizado
    const u = database.get('SELECT email, name, status, totp_secret FROM users WHERE id = ?', [
      A.user,
    ]);
    expect(u.status).toBe('deleted');
    expect(u.email.startsWith('deleted_')).toBe(true);
    expect(u.name).toBe('Usuário Excluído');
    expect(u.totp_secret).toBeNull();

    // workspace cancelado
    const ws = database.get(
      'SELECT subscription_status, auto_renew_enabled FROM workspaces WHERE id = ?',
      [A.ws]
    );
    expect(ws.subscription_status).toBe('cancelled');
    expect(ws.auto_renew_enabled).toBe(0);

    // PII de contatos anonimizada
    const c = database.get('SELECT name, phone FROM contacts WHERE id = ?', [`contact-${A.ws}`]);
    expect(c.name).toBe('anônimo');
    expect(c.phone).toBe('');

    // refresh tokens revogados
    const rt = database.get('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?', [A.user]);
    expect(rt.n).toBe(0);

    // log de exclusão completo
    const log = database.get('SELECT status FROM data_deletion_log WHERE user_id = ?', [A.user]);
    expect(log.status).toBe('completed');

    // outro tenant intacto
    const b = database.get('SELECT name, status FROM contacts WHERE id = ?', [`contact-${B.ws}`]);
    expect(b.name).toBe('Contato B');
    const bu = database.get('SELECT status FROM users WHERE id = ?', [B.user]);
    expect(bu.status).toBe('active');
  });
});
