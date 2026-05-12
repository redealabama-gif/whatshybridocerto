/**
 * SQLite driver — wraps better-sqlite3 com a API uniforme
 * Mantém o comportamento atual da v8.5.0 intacto.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const logger = require('../logger');

let db = null;

function initialize(dbPath) {
  const finalPath = dbPath || process.env.DB_PATH || path.join(__dirname, '../../../data/whatshybrid.db');

  // Cria diretório se não existir
  const dir = path.dirname(finalPath);
  if (finalPath !== ':memory:' && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(finalPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  logger.info(`[DB:SQLite] Initialized at ${finalPath} (WAL mode)`);
  return db;
}

function getDb() {
  if (!db) initialize();
  return db;
}

function run(sql, params = []) {
  try {
    const stmt = getDb().prepare(sql);
    const result = stmt.run(Array.isArray(params) ? params : Object.values(params));
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  } catch (error) {
    logger.error('[DB:SQLite] run error:', error.message, '| SQL:', sql.substring(0, 200));
    throw error;
  }
}

function get(sql, params = []) {
  try {
    const stmt = getDb().prepare(sql);
    return stmt.get(Array.isArray(params) ? params : Object.values(params));
  } catch (error) {
    logger.error('[DB:SQLite] get error:', error.message, '| SQL:', sql.substring(0, 200));
    throw error;
  }
}

function all(sql, params = []) {
  try {
    const stmt = getDb().prepare(sql);
    return stmt.all(Array.isArray(params) ? params : Object.values(params));
  } catch (error) {
    logger.error('[DB:SQLite] all error:', error.message, '| SQL:', sql.substring(0, 200));
    throw error;
  }
}

function exec(sql) {
  try {
    return getDb().exec(sql);
  } catch (error) {
    logger.error('[DB:SQLite] exec error:', error.message);
    throw error;
  }
}

function transaction(fn) {
  const wrapped = getDb().transaction(fn);
  return wrapped();
}

function close() {
  if (db) {
    db.close();
    db = null;
    logger.info('[DB:SQLite] Connection closed');
  }
}

function prepare(sql) {
  return getDb().prepare(sql);
}

function pragma(query) {
  return getDb().pragma(query);
}

module.exports = {
  driver: 'sqlite',
  initialize, getDb, run, get, all, exec, transaction, close, prepare, pragma,
};
