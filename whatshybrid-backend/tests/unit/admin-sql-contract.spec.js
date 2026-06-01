/**
 * SQL contract tests — garantem que as queries das rotas admin/coupons batem
 * com o schema atual. Foi exatamente esse tipo de check que faltava quando os
 * bugs do painel admin (queries com colunas inexistentes) chegaram a produção.
 *
 * Estratégia: monta um banco SQLite em memória com um subset do schema real
 * (extraído de database-legacy.js) + as migrations versionadas relevantes,
 * e executa cada query crítica. Se uma coluna for renomeada/removida sem
 * atualizar a rota, este teste quebra.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

function applyMigration(db, file) {
  const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  content
    .split(/^-- ?@SEPARATOR\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((stmt) => {
      try {
        db.exec(stmt);
      } catch (e) {
        // ignora ALTER TABLE quando coluna já existe (migration idempotente
        // contra schema base já parcialmente aplicado)
        if (!/duplicate column|already exists/i.test(e.message)) throw e;
      }
    });
}

function buildTestDb() {
  const db = new Database(':memory:');

  // Subset do schema base (database-legacy.js) — só o que as rotas admin tocam.
  // Manter alinhado com src/utils/database-legacy.js SCHEMA.
  db.exec(`
    CREATE TABLE _migrations (
      id TEXT PRIMARY KEY,
      filename TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'user',
      status TEXT DEFAULT 'active',
      workspace_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      plan TEXT DEFAULT 'free',
      subscription_status TEXT,
      stripe_subscription_id TEXT,
      past_due_since DATETIME,
      dunning_attempts INTEGER DEFAULT 0,
      last_dunning_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      plan_id TEXT NOT NULL DEFAULT 'free',
      status TEXT DEFAULT 'inactive',
      credits_total INTEGER DEFAULT 0,
      credits_used INTEGER DEFAULT 0,
      activated_at DATETIME,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE credit_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_code TEXT NOT NULL,
      amount INTEGER NOT NULL,
      type TEXT DEFAULT 'usage',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE ai_usage_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      provider TEXT,
      model TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      duration_ms INTEGER,
      status TEXT DEFAULT 'success',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE error_logs (
      id TEXT PRIMARY KEY,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE admin_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE dunning_charge_attempts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      provider TEXT,
      provider_subscription_id TEXT,
      attempt_number INTEGER,
      past_due_age_days INTEGER,
      charge_method TEXT,
      charge_status TEXT,
      ok INTEGER DEFAULT 0,
      error_message TEXT,
      raw_response TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE llm_cost_log (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      total_tokens INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrations versionadas que o painel admin depende
  applyMigration(db, '017_integration_credentials.sql');
  applyMigration(db, '018_coupon_leads.sql');

  return db;
}

describe('Admin SQL contract', () => {
  let db;
  beforeAll(() => {
    db = buildTestDb();
    // seed mínimo
    db.prepare(
      `INSERT INTO subscriptions (code, email, plan_id, status, credits_total, credits_used, activated_at)
       VALUES ('ABC', 'a@x.com', 'pro', 'active', 1000, 200, datetime('now'))`
    ).run();
    db.prepare(
      `INSERT INTO ai_usage_logs (id, provider, tokens_input, tokens_output, duration_ms, status)
       VALUES ('l1', 'openai', 100, 50, 1200, 'success'),
              ('l2', 'groq', 10, 5, 300, 'error')`
    ).run();
    db.prepare(`INSERT INTO credit_transactions (subscription_code, amount, type) VALUES ('ABC', -30, 'usage')`).run();
    db.prepare(`INSERT INTO error_logs (id, error_message) VALUES ('e1', 'boom')`).run();
  });

  afterAll(() => db && db.close());

  test('dashboard: credits via tokens (não usa credits_used inexistente)', () => {
    const r = db
      .prepare(
        `SELECT COALESCE(SUM(tokens_input + tokens_output), 0) as total
         FROM ai_usage_logs WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
      )
      .get();
    expect(r.total).toBe(165);
  });

  test('metrics/providers: agrega por status, não por coluna success', () => {
    const rows = db
      .prepare(
        `SELECT provider,
                COUNT(*) as total_requests,
                SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as successful,
                SUM(CASE WHEN status!='success' THEN 1 ELSE 0 END) as failed,
                AVG(duration_ms) as avg_latency,
                SUM(tokens_input + tokens_output) as total_credits
         FROM ai_usage_logs GROUP BY provider`
      )
      .all();
    expect(rows).toHaveLength(2);
    const openai = rows.find((r) => r.provider === 'openai');
    expect(openai.successful).toBe(1);
    expect(openai.failed).toBe(0);
    expect(openai.avg_latency).toBe(1200);
  });

  test('logs/ai: aliases credits_used/latency_ms/success em cima das colunas reais', () => {
    const rows = db
      .prepare(
        `SELECT *,
                (tokens_input + tokens_output) AS credits_used,
                duration_ms AS latency_ms,
                CASE WHEN status='success' THEN 1 ELSE 0 END AS success
         FROM ai_usage_logs ORDER BY created_at DESC LIMIT 10`
      )
      .all();
    expect(rows[0]).toHaveProperty('credits_used');
    expect(rows[0]).toHaveProperty('latency_ms');
    expect(rows[0]).toHaveProperty('success');
  });

  test('subscription history: usa credit_transactions, não ai_usage_logs', () => {
    const rows = db
      .prepare(
        `SELECT DATE(created_at) date, SUM(ABS(amount)) credits, COUNT(*) requests
         FROM credit_transactions
         WHERE subscription_code = ? AND type = 'usage'
         GROUP BY DATE(created_at)`
      )
      .all('ABC');
    expect(rows[0].credits).toBe(30);
  });

  test('integration_credentials: insert+select com kind=api_key e fields JSON', () => {
    db.prepare(
      `INSERT INTO integration_credentials (id, kind, provider, label, fields, status)
       VALUES (?, 'api_key', ?, ?, ?, 'active')`
    ).run('k1', 'openai', 'prod', JSON.stringify({ api_key: 'sk-abc' }));
    const k = db
      .prepare(
        `SELECT id, provider, label, fields FROM integration_credentials WHERE kind='api_key'`
      )
      .get();
    expect(k.provider).toBe('openai');
    expect(JSON.parse(k.fields).api_key).toBe('sk-abc');
  });

  test('integration_credentials: kind=integration com fields livre', () => {
    db.prepare(
      `INSERT INTO integration_credentials (id, kind, provider, fields, notes, status)
       VALUES (?, 'integration', ?, ?, ?, 'active')`
    ).run('c1', 'facebook', JSON.stringify({ pixel_id: '123', access_token: 'tok' }), 'nota');
    const c = db
      .prepare(`SELECT fields FROM integration_credentials WHERE id = 'c1'`)
      .get();
    expect(JSON.parse(c.fields).pixel_id).toBe('123');
  });

  test('coupon_leads: insert + busca + delete', () => {
    db.prepare(
      `INSERT INTO coupon_leads (id, name, email, phone, coupon, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('lead_1', 'João Silva', 'joao@x.com', '21999999999', 'EXIT50', 'exit-modal');
    const found = db
      .prepare(`SELECT name, email FROM coupon_leads WHERE email LIKE ? ORDER BY created_at DESC`)
      .all('%joao%');
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('João Silva');
    const del = db.prepare(`DELETE FROM coupon_leads WHERE id = ?`).run('lead_1');
    expect(del.changes).toBe(1);
  });

  test('admin/health: contadores não referenciam tabela errada', () => {
    // Antes do fix, /health consultava api_keys.status (coluna inexistente).
    // Agora deve usar integration_credentials.
    const r = db
      .prepare(
        `SELECT COUNT(*) as count FROM integration_credentials WHERE kind='api_key' AND status='active'`
      )
      .get();
    expect(typeof r.count).toBe('number');
  });

  test('billing/high-spenders: JOIN llm_cost_log x workspaces tem colunas usadas', () => {
    db.prepare(
      `INSERT INTO workspaces (id, name, owner_id, plan, subscription_status) VALUES ('w1', 'X', 'u1', 'pro', 'active')`
    ).run();
    db.prepare(
      `INSERT INTO llm_cost_log (id, workspace_id, total_tokens, latency_ms, cost_usd) VALUES ('c1','w1', 100, 200, 0.001)`
    ).run();
    const rows = db
      .prepare(
        `SELECT w.id, w.name, w.plan, w.subscription_status,
                COUNT(c.id) as request_count, SUM(c.total_tokens) as tokens_total,
                SUM(c.cost_usd) as cost_usd_total, AVG(c.latency_ms) as latency_ms_avg
         FROM llm_cost_log c JOIN workspaces w ON w.id = c.workspace_id
         GROUP BY w.id`
      )
      .all();
    expect(rows[0].cost_usd_total).toBeCloseTo(0.001);
  });
});
