/**
 * Integração — ISOLAMENTO MULTI-TENANT PROFUNDO (crítico).
 *
 * Diferente do smoke (que bate num servidor já de pé e cobre só contatos), este
 * teste sobe os routers REAIS (contacts + crm/deals) contra um SQLite real com
 * as migrations aplicadas e exercita o caminho ponta-a-ponta via HTTP com JWTs
 * REAIS (assinados com o mesmo segredo do middleware `authenticate`). Nada do
 * caminho de dados é mockado — roteamento, auth, SQL, schema, FKs e transações
 * são todos reais.
 *
 * Prova a "garantia profunda" de que um tenant NUNCA lê/escreve dados de outro:
 *   1. Listagem só devolve linhas do próprio workspace.
 *   2. Acesso direto por id a recurso de outro tenant → 404.
 *   3. UPDATE/DELETE cross-tenant NÃO altera/remove os dados da vítima
 *      (mesmo quando a rota responde 200, o WHERE workspace_id protege o dado).
 *   4. Sub-recursos (conversations/deals/tasks no detalhe do contato) são
 *      escopados por workspace_id.
 *   5. Injeção de workspace_id no body é ignorada (a rota usa req.workspaceId).
 *   6. Controle positivo: o dono acessa/edita/remove o próprio dado.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');

const { ensureDb, buildApp, database, cleanupDb } = require('./helpers/app');

// IDs estáveis (tokens só carregam userId; re-seed por teste mantém os campos).
const A = { ws: 'ws-tenant-a', user: 'user-tenant-a', contact: 'contact-a-1', deal: 'deal-a-1' };
const B = { ws: 'ws-tenant-b', user: 'user-tenant-b', contact: 'contact-b-1', deal: 'deal-b-1' };

let app;
let tokenA;
let tokenB;

function bearer(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}
const authA = () => ({ Authorization: `Bearer ${tokenA}` });
const authB = () => ({ Authorization: `Bearer ${tokenB}` });

function seedTenant(t, contactName, dealTitle, dealValue) {
  database.run(
    `INSERT INTO users (id, email, password, name, role, status, workspace_id) VALUES (?, ?, ?, ?, 'user', 'active', ?)`,
    [t.user, `${t.user}@example.com`, 'x', `Owner ${t.user}`, t.ws]
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES (?, ?, ?, 'pro', 'active')`,
    [t.ws, `WS ${t.ws}`, t.user]
  );
  database.run(`INSERT INTO contacts (id, workspace_id, phone, name) VALUES (?, ?, ?, ?)`, [
    t.contact,
    t.ws,
    `5511${t.ws.length}00000001`,
    contactName,
  ]);
  database.run(
    `INSERT INTO deals (id, workspace_id, contact_id, title, value) VALUES (?, ?, ?, ?, ?)`,
    [t.deal, t.ws, t.contact, dealTitle, dealValue]
  );
}

beforeAll(async () => {
  await ensureDb();
  app = buildApp({
    '/api/v1/contacts': require('../../src/routes/contacts'),
    '/api/v1/crm': require('../../src/routes/crm'),
  });
  // Stub do socket.io — rotas de mutação emitem via req.app.get('io').
  app.set('io', { to: () => ({ emit: () => {} }) });
  tokenA = bearer(A.user);
  tokenB = bearer(B.user);
});

afterAll(() => cleanupDb());

beforeEach(() => {
  // Limpa filhos→pais (FK = ON) e re-semeia estado conhecido.
  for (const tbl of ['tasks', 'conversations', 'deals', 'contacts', 'workspaces', 'users']) {
    try {
      database.run(`DELETE FROM ${tbl}`);
    } catch (_) {
      /* tabela pode não existir em algum driver */
    }
  }
  seedTenant(A, 'Contact A', 'Deal A CONFIDENCIAL', 1000);
  seedTenant(B, 'Contact B', 'Deal B CONFIDENCIAL', 2000);
  // Sub-recursos do tenant A (para provar escopo no detalhe do contato).
  database.run(
    `INSERT INTO conversations (id, workspace_id, contact_id, status) VALUES (?, ?, ?, 'open')`,
    ['conv-a-1', A.ws, A.contact]
  );
  database.run(
    `INSERT INTO tasks (id, workspace_id, title, contact_id, deal_id, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    ['task-a-1', A.ws, 'Task A', A.contact, A.deal]
  );
});

describe('Listagem — só o próprio workspace', () => {
  test('A lista apenas contatos de A', async () => {
    const res = await request(app).get('/api/v1/contacts').set(authA());
    expect(res.status).toBe(200);
    const ids = res.body.contacts.map((c) => c.id);
    expect(ids).toContain(A.contact);
    expect(ids).not.toContain(B.contact);
  });

  test('B lista apenas contatos de B', async () => {
    const res = await request(app).get('/api/v1/contacts').set(authB());
    expect(res.status).toBe(200);
    const ids = res.body.contacts.map((c) => c.id);
    expect(ids).toContain(B.contact);
    expect(ids).not.toContain(A.contact);
  });

  test('A lista apenas deals de A', async () => {
    const res = await request(app).get('/api/v1/crm/deals').set(authA());
    expect(res.status).toBe(200);
    const titles = res.body.deals.map((d) => d.title);
    expect(titles).toContain('Deal A CONFIDENCIAL');
    expect(titles).not.toContain('Deal B CONFIDENCIAL');
  });
});

describe('Acesso direto por id — recurso de outro tenant → 404', () => {
  test('B NÃO lê contato de A por id', async () => {
    const res = await request(app).get(`/api/v1/contacts/${A.contact}`).set(authB());
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Contact A');
  });

  test('B NÃO lê deal de A por id', async () => {
    const res = await request(app).get(`/api/v1/crm/deals/${A.deal}`).set(authB());
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('CONFIDENCIAL');
  });
});

describe('Mutação cross-tenant — o DADO da vítima permanece intacto', () => {
  test('B NÃO altera contato de A (404 + dado intacto)', async () => {
    const res = await request(app)
      .put(`/api/v1/contacts/${A.contact}`)
      .set(authB())
      .send({ name: 'PWNED' });
    expect(res.status).toBe(404);
    const row = database.get('SELECT name FROM contacts WHERE id = ?', [A.contact]);
    expect(row.name).toBe('Contact A');
  });

  test('B NÃO deleta contato de A (404 + linha ainda existe)', async () => {
    const res = await request(app).delete(`/api/v1/contacts/${A.contact}`).set(authB());
    expect(res.status).toBe(404);
    const row = database.get('SELECT id FROM contacts WHERE id = ?', [A.contact]);
    expect(row).toBeTruthy();
  });

  test('B NÃO altera deal de A (dado intacto, mesmo se a rota responder 200)', async () => {
    await request(app)
      .put(`/api/v1/crm/deals/${A.deal}`)
      .set(authB())
      .send({ title: 'PWNED', value: 0 });
    const row = database.get('SELECT title, value FROM deals WHERE id = ?', [A.deal]);
    expect(row.title).toBe('Deal A CONFIDENCIAL');
    expect(row.value).toBe(1000);
  });

  test('B NÃO deleta deal de A (linha ainda existe)', async () => {
    await request(app).delete(`/api/v1/crm/deals/${A.deal}`).set(authB());
    const row = database.get('SELECT id FROM deals WHERE id = ?', [A.deal]);
    expect(row).toBeTruthy();
  });
});

describe('Sub-recursos no detalhe do contato — escopados por workspace', () => {
  test('detalhe do contato de A traz apenas sub-recursos de A', async () => {
    const res = await request(app).get(`/api/v1/contacts/${A.contact}`).set(authA());
    expect(res.status).toBe(200);
    expect(res.body.conversations).toHaveLength(1);
    expect(res.body.deals).toHaveLength(1);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.deals[0].title).toBe('Deal A CONFIDENCIAL');
  });
});

describe('Injeção de workspace_id no body é ignorada', () => {
  test('B cria contato tentando forjar workspace_id=A → fica em B', async () => {
    const res = await request(app)
      .post('/api/v1/contacts')
      .set(authB())
      .send({ phone: '5511955550000', name: 'Forjado', workspace_id: A.ws });
    expect([200, 201]).toContain(res.status);
    const created = res.body.contact;
    const row = database.get('SELECT workspace_id FROM contacts WHERE id = ?', [created.id]);
    expect(row.workspace_id).toBe(B.ws);
    expect(row.workspace_id).not.toBe(A.ws);
  });
});

describe('Controle positivo — o dono acessa/edita/remove o próprio dado', () => {
  test('A lê o próprio contato', async () => {
    const res = await request(app).get(`/api/v1/contacts/${A.contact}`).set(authA());
    expect(res.status).toBe(200);
    expect(res.body.contact.id).toBe(A.contact);
  });

  test('A edita o próprio contato', async () => {
    const res = await request(app)
      .put(`/api/v1/contacts/${A.contact}`)
      .set(authA())
      .send({ name: 'A renomeado' });
    expect(res.status).toBe(200);
    const row = database.get('SELECT name FROM contacts WHERE id = ?', [A.contact]);
    expect(row.name).toBe('A renomeado');
  });

  test('A remove o próprio contato (sem dependências)', async () => {
    // Contato dedicado e sem filhos (deal/conversation/task referenciam A.contact
    // e barrariam o DELETE por FK — irrelevante para isolamento).
    database.run(`INSERT INTO contacts (id, workspace_id, phone, name) VALUES (?, ?, ?, ?)`, [
      'contact-a-del',
      A.ws,
      '5511944440000',
      'A descartável',
    ]);
    const res = await request(app).delete('/api/v1/contacts/contact-a-del').set(authA());
    expect(res.status).toBe(200);
    const row = database.get('SELECT id FROM contacts WHERE id = ?', ['contact-a-del']);
    expect(row).toBeFalsy();
  });
});
