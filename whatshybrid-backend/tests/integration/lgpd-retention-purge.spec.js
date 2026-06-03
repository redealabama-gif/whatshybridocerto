/**
 * Integração — purga de retenção (scripts/lgpd-retention-purge.js) contra DB real.
 *
 * Prova: dry-run não apaga nada; --apply remove só o que passou da janela
 * (refresh tokens expirados, webhook_inbox processados antigos, deletion_log
 * antigo) e NUNCA toca billing_invoices (retenção fiscal de 5 anos).
 */

const { ensureDb, database, cleanupDb } = require('./helpers/app');
const { purge, sqlTime } = require('../../scripts/lgpd-retention-purge');

const DAY = 86400000;
const NOW = Date.now();
const old = sqlTime(NOW - 400 * DAY); // > 365 e > 90
const midOld = sqlTime(NOW - 100 * DAY); // > 90 mas < 365
const recent = sqlTime(NOW - 1 * DAY); // dentro de todas as janelas
const future = sqlTime(NOW + 7 * DAY);
const past = sqlTime(NOW - 1 * DAY);

beforeAll(async () => {
  await ensureDb();
});
afterAll(() => cleanupDb());

beforeEach(() => {
  for (const t of [
    'refresh_tokens',
    'webhook_inbox',
    'data_deletion_log',
    'billing_invoices',
    'workspaces',
    'users',
  ]) {
    try {
      database.run(`DELETE FROM ${t}`);
    } catch (_) {
      /* ignore */
    }
  }
  // workspace p/ a invoice (FK)
  database.run(
    `INSERT INTO users (id, email, password, status) VALUES ('ret-u', 'ret@example.com', 'x', 'active')`
  );
  database.run(
    `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES ('ret-w', 'Ret', 'ret-u', 'pro', 'active')`
  );

  // refresh_tokens: 1 expirado, 1 válido
  database.run(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ('rt-exp','ret-u','t1',?)`,
    [past]
  );
  database.run(
    `INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES ('rt-ok','ret-u','t2',?)`,
    [future]
  );

  // webhook_inbox: processado+antigo (remove), processado+recente (mantém), recebido+antigo (mantém — não 'processed')
  database.run(
    `INSERT INTO webhook_inbox (id, provider, raw_payload, status, received_at) VALUES ('wi-old','stripe','{}','processed',?)`,
    [midOld]
  );
  database.run(
    `INSERT INTO webhook_inbox (id, provider, raw_payload, status, received_at) VALUES ('wi-new','stripe','{}','processed',?)`,
    [recent]
  );
  database.run(
    `INSERT INTO webhook_inbox (id, provider, raw_payload, status, received_at) VALUES ('wi-recv','stripe','{}','received',?)`,
    [old]
  );

  // data_deletion_log: 1 antigo (remove), 1 recente (mantém)
  database.run(
    `INSERT INTO data_deletion_log (id, user_id, status, created_at) VALUES ('dl-old','ret-u','completed',?)`,
    [old]
  );
  database.run(
    `INSERT INTO data_deletion_log (id, user_id, status, created_at) VALUES ('dl-new','ret-u','completed',?)`,
    [recent]
  );

  // billing_invoice antiga — NUNCA deve ser purgada
  database.run(
    `INSERT INTO billing_invoices (id, workspace_id, provider, provider_ref, plan, amount, currency, status, created_at)
     VALUES ('inv-old','ret-w','stripe','ref','pro',99.9,'BRL','paid',?)`,
    [old]
  );
});

test('dry-run conta mas NÃO apaga', () => {
  const res = purge({ apply: false, now: NOW });
  expect(res.apply).toBe(false);
  expect(res.total).toBeGreaterThan(0);
  // tudo continua lá
  expect(database.get(`SELECT COUNT(*) n FROM refresh_tokens`).n).toBe(2);
  expect(database.get(`SELECT COUNT(*) n FROM webhook_inbox`).n).toBe(3);
  expect(database.get(`SELECT COUNT(*) n FROM data_deletion_log`).n).toBe(2);
});

test('--apply remove só o que passou da janela; invoice preservada', () => {
  purge({ apply: true, now: NOW });

  // refresh_tokens: expirado removido, válido mantido
  expect(database.get(`SELECT id FROM refresh_tokens WHERE id='rt-exp'`)).toBeFalsy();
  expect(database.get(`SELECT id FROM refresh_tokens WHERE id='rt-ok'`)).toBeTruthy();

  // webhook_inbox: processado+antigo removido; recente e 'received' mantidos
  expect(database.get(`SELECT id FROM webhook_inbox WHERE id='wi-old'`)).toBeFalsy();
  expect(database.get(`SELECT id FROM webhook_inbox WHERE id='wi-new'`)).toBeTruthy();
  expect(database.get(`SELECT id FROM webhook_inbox WHERE id='wi-recv'`)).toBeTruthy();

  // deletion_log: antigo removido, recente mantido
  expect(database.get(`SELECT id FROM data_deletion_log WHERE id='dl-old'`)).toBeFalsy();
  expect(database.get(`SELECT id FROM data_deletion_log WHERE id='dl-new'`)).toBeTruthy();

  // invoice NUNCA purgada (retenção fiscal)
  expect(database.get(`SELECT id FROM billing_invoices WHERE id='inv-old'`)).toBeTruthy();
});
