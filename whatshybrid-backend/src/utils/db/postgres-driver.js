/**
 * PostgreSQL driver — wraps node-postgres com a mesma API que sqlite
 *
 * Conversões automáticas:
 *   - `?` → `$1, $2, ...` (placeholder positional)
 *   - `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
 *   - `DATETIME DEFAULT CURRENT_TIMESTAMP` → `TIMESTAMP DEFAULT NOW()`
 *
 * NOTA: este driver é SÍNCRONO na assinatura mas o pg é assíncrono.
 * Como o código existente usa db.run/get/all como síncrono (better-sqlite3),
 * usamos approach pragmático: cada chamada cria uma Promise e o caller
 * pode usar await OR ignorar (best-effort).
 *
 * **IMPORTANTE**: para usar este driver, o código que chama db.* precisa
 * passar a usar await. Migration gradual: módulos críticos primeiro.
 */

const logger = require('../logger');

let pool = null;
let pgModule = null;

function loadPg() {
  if (!pgModule) {
    try {
      pgModule = require('pg');
    } catch (e) {
      throw new Error('PostgreSQL driver requer "pg". Run: npm install pg');
    }
  }
  return pgModule;
}

function initialize(connectionString) {
  const { Pool } = loadPg();
  pool = new Pool({
    connectionString: connectionString || process.env.DATABASE_URL,
    max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    logger.error('[DB:PG] Pool error:', err.message);
  });

  logger.info(`[DB:PG] Pool initialized (max=${pool.options.max})`);
  return pool;
}

function getPool() {
  if (!pool) initialize();
  return pool;
}

/**
 * Converte placeholders `?` em `$1, $2, ...`
 * (cuida pra não trocar `?` dentro de strings literais)
 */
function convertPlaceholders(sql) {
  let result = '';
  let placeholderIdx = 0;
  let inString = false;
  let stringChar = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inString) {
      result += c;
      if (c === stringChar && sql[i - 1] !== '\\') inString = false;
    } else {
      if (c === '?' && !inString) {
        placeholderIdx++;
        result += '$' + placeholderIdx;
      } else {
        if (c === "'" || c === '"') { inString = true; stringChar = c; }
        result += c;
      }
    }
  }
  return result;
}

/**
 * Converte SQL de SQLite para Postgres (best-effort).
 * Para casos simples — DDL complexa requer migrations dedicadas.
 *
 * v9.3.6: expandido pra cobrir mais casos comuns no codebase:
 *   - datetime('now') → NOW()
 *   - datetime('now', '-N days/hours/minutes') → NOW() - INTERVAL 'N day/hour/minute'
 *   - INSERT OR REPLACE → INSERT ... ON CONFLICT (best-effort, pode requerer ajuste manual em casos com PK composta)
 *   - || (concat string) — semantica diferente, deixa ao caller
 */
function adaptSqliteSql(sql) {
  let out = sql;

  // Tipos (case-sensitive: DDL é convenção uppercase, função datetime() é lowercase)
  // v9.4.7 BUG #130: removido flag /i de DATETIME pra não capturar datetime() minúsculo.
  // Antes: \bDATETIME\b/gi convertia datetime('now') → TIMESTAMP('now') (SQL inválido)
  // ANTES de chegar no replace específico de datetime() → NOW(). Resultado: webhooks
  // que usavam datetime('now') geravam SQL Postgres-inválido.
  out = out
    .replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY')
    .replace(/DATETIME\s+DEFAULT\s+CURRENT_TIMESTAMP/g, 'TIMESTAMP DEFAULT NOW()')
    .replace(/\bDATETIME\b/g, 'TIMESTAMP');

  // Funções de data
  // datetime('now', '-30 days') → NOW() - INTERVAL '30 days'
  // datetime('now', '+1 hour')  → NOW() + INTERVAL '1 hour'
  out = out.replace(
    /datetime\s*\(\s*'now'\s*,\s*'([+-]?\d+)\s+(day|days|hour|hours|minute|minutes|second|seconds|month|months|year|years)'\s*\)/gi,
    (_match, num, unit) => {
      const n = parseInt(num, 10);
      const sign = n < 0 ? '-' : '+';
      const absN = Math.abs(n);
      // Postgres exige unidade singular dentro de INTERVAL string ('1 day' ou '7 days' funcionam)
      return `(NOW() ${sign} INTERVAL '${absN} ${unit}')`;
    }
  );

  // datetime('now') simples
  out = out.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'NOW()');

  // v9.4.7 BUG #129: conversão real de INSERT OR IGNORE/REPLACE pra ON CONFLICT.
  // Antes: substituía por comentário TODO → executava INSERT comum → throw em
  // chave duplicada → quebrava idempotência de webhooks (Stripe, MP) em Postgres.
  //
  // Mapa de tabela → coluna(s) usadas como conflict target.
  // Adicione aqui sempre que criar nova tabela com INSERT OR IGNORE/REPLACE.
  const TABLE_CONFLICT_KEY = {
    // PRIMARY KEY simples
    billing_invoices: 'id',
    autopilot_sessions: 'id',
    interaction_metadata: 'interaction_id',
    faqs: 'id',
    products: 'id',
    training_examples: 'id',
    business_info: 'workspace_id',
    // UNIQUE composto
    email_drip_log: '(user_id, campaign, step)',
    analytics_daily_metrics: '(workspace_id, date)',
    // Webhooks
    webhook_inbox: '(provider, provider_event_id)',
    // Idempotency (token_transactions: invoice_id é unique parcial)
    token_transactions: 'id',
  };

  // INSERT OR IGNORE INTO <table> ... → INSERT INTO <table> ... ON CONFLICT (<key>) DO NOTHING
  out = out.replace(
    /INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\b/gi,
    (match, table) => {
      const key = TABLE_CONFLICT_KEY[table.toLowerCase()];
      if (!key) {
        // Fallback: deixa erro informativo. Adicione a tabela no mapa acima.
        return `INSERT INTO ${table} /* WARN: INSERT OR IGNORE sem mapping pra Postgres — adicione "${table}" em TABLE_CONFLICT_KEY */`;
      }
      // Marca pra adicionar ON CONFLICT no fim. Usamos sentinela única pra
      // poder achar e substituir no fim do SQL (após VALUES).
      return `INSERT INTO ${table} /*PG_ONCONFLICT_NOTHING:${key}*/`;
    }
  );

  // INSERT OR REPLACE INTO <table> ... → INSERT INTO ... ON CONFLICT (<key>) DO UPDATE SET ...
  // Pra REPLACE, precisamos saber quais colunas atualizar. Detectamos do INSERT
  // (parsing simples). Fallback: deixa marker.
  out = out.replace(
    /INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\b/gi,
    (match, table) => {
      const key = TABLE_CONFLICT_KEY[table.toLowerCase()];
      if (!key) {
        return `INSERT INTO ${table} /* WARN: INSERT OR REPLACE sem mapping pra Postgres — adicione "${table}" em TABLE_CONFLICT_KEY */`;
      }
      return `INSERT INTO ${table} /*PG_ONCONFLICT_UPDATE:${key}*/`;
    }
  );

  // Pós-processamento: substitui sentinelas + ON CONFLICT no fim do statement.
  // Para DO NOTHING é simples (basta append).
  out = out.replace(/INSERT INTO (\w+) \/\*PG_ONCONFLICT_NOTHING:([^*]+)\*\/(.*)$/gms,
    (m, table, key, rest) => {
      // Strip trailing semicolon temporariamente
      const trimmed = rest.replace(/;\s*$/, '');
      return `INSERT INTO ${table}${trimmed} ON CONFLICT ${key.startsWith('(') ? key : `(${key})`} DO NOTHING`;
    }
  );

  // Para DO UPDATE: parsear lista de colunas em INSERT INTO (col1, col2, ...) VALUES (...)
  // e gerar SET col1 = EXCLUDED.col1, col2 = EXCLUDED.col2 ... excluindo a key
  out = out.replace(
    /INSERT INTO (\w+) \/\*PG_ONCONFLICT_UPDATE:([^*]+)\*\/\s*\(([^)]+)\)([\s\S]*?)$/gm,
    (m, table, keyRaw, columnsList, rest) => {
      // Strip trailing semicolon
      const trimmed = rest.replace(/;\s*$/, '');
      // Parse colunas
      const columns = columnsList.split(',').map(c => c.trim());
      // Coluna(s) que são a key — não devem aparecer no SET
      const keyCols = keyRaw.replace(/[()]/g, '').split(',').map(c => c.trim().toLowerCase());
      // SET assignment usando EXCLUDED
      const updates = columns
        .filter(c => !keyCols.includes(c.toLowerCase()))
        .map(c => `${c} = EXCLUDED.${c}`)
        .join(', ');
      const onConflictKey = keyRaw.startsWith('(') ? keyRaw : `(${keyRaw})`;
      const setClause = updates ? `DO UPDATE SET ${updates}` : 'DO NOTHING';
      return `INSERT INTO ${table} (${columnsList})${trimmed} ON CONFLICT ${onConflictKey} ${setClause}`;
    }
  );

  // SQLite: COUNT(*) AS c — Postgres aceita
  // SQLite: GROUP_CONCAT — Postgres usa STRING_AGG, não convertido (raro no codebase)

  return out;
}

async function run(sql, params = []) {
  const adapted = adaptSqliteSql(sql);
  const pgSql = convertPlaceholders(adapted);
  try {
    const result = await getPool().query(pgSql, Array.isArray(params) ? params : Object.values(params));
    return {
      changes: result.rowCount,
      lastInsertRowid: result.rows[0]?.id || null,
    };
  } catch (error) {
    logger.error('[DB:PG] run error:', error.message, '| SQL:', pgSql.substring(0, 200));
    throw error;
  }
}

async function get(sql, params = []) {
  const adapted = adaptSqliteSql(sql);
  const pgSql = convertPlaceholders(adapted);
  try {
    const result = await getPool().query(pgSql, Array.isArray(params) ? params : Object.values(params));
    return result.rows[0] || undefined;
  } catch (error) {
    logger.error('[DB:PG] get error:', error.message, '| SQL:', pgSql.substring(0, 200));
    throw error;
  }
}

async function all(sql, params = []) {
  const adapted = adaptSqliteSql(sql);
  const pgSql = convertPlaceholders(adapted);
  try {
    const result = await getPool().query(pgSql, Array.isArray(params) ? params : Object.values(params));
    return result.rows;
  } catch (error) {
    logger.error('[DB:PG] all error:', error.message, '| SQL:', pgSql.substring(0, 200));
    throw error;
  }
}

async function exec(sql) {
  const adapted = adaptSqliteSql(sql);
  try {
    await getPool().query(adapted);
  } catch (error) {
    logger.error('[DB:PG] exec error:', error.message);
    throw error;
  }
}

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // v9.3.6 NOTA: API divergente do SQLite.
    //   SQLite (better-sqlite3) escopa transação na conexão global → callback
    //   pode usar `db.run/get` direto e fica dentro da transação.
    //   Postgres exige passar o cliente: callback PRECISA usar `txDb` recebido
    //   como argumento. Se ignorar e usar `db.*` global, vai pro pool fora
    //   da transação — perde atomicidade.
    //
    //   O código existente em TokenService, me.js, etc. ignora o arg.
    //   Em SQLite funciona; em Postgres é silently broken.
    //
    //   Fix futuro: refatorar callbacks pra `(txDb) => { txDb.run(...) }`.
    const txDb = {
      run: async (sql, params = []) => {
        const r = await client.query(convertPlaceholders(adaptSqliteSql(sql)), params);
        return { changes: r.rowCount };
      },
      get: async (sql, params = []) => {
        const r = await client.query(convertPlaceholders(adaptSqliteSql(sql)), params);
        return r.rows[0];
      },
      all: async (sql, params = []) => {
        const r = await client.query(convertPlaceholders(adaptSqliteSql(sql)), params);
        return r.rows;
      },
      exec: async (sql) => client.query(adaptSqliteSql(sql)),
    };

    const result = await fn(txDb);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('[DB:PG] Pool closed');
  }
}

function prepare(_sql) {
  throw new Error('PostgreSQL driver não suporta prepare() síncrono. Use run/get/all diretamente.');
}

function pragma(_query) {
  // No-op em Postgres (PRAGMA é específico de SQLite)
  return null;
}

module.exports = {
  driver: 'postgres',
  initialize, getPool, run, get, all, exec, transaction, close, prepare, pragma,
  convertPlaceholders, adaptSqliteSql,
};
