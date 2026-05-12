/**
 * Database — v9.0.0
 *
 * Entry point que delega para o driver configurado (sqlite ou postgres).
 * Mantém a API esperada pelo código existente: run, get, all, transaction,
 * exec, close, getDb, initialize, runMigrations.
 *
 * Para forçar driver: env var DB_DRIVER=sqlite|postgres
 * Para SQLite custom path: DB_PATH=/path/to/file.db
 * Para Postgres: DATABASE_URL=postgres://user:pass@host:5432/dbname
 */

const driver = require('./db');
const logger = require('./logger');

// Re-exporta API do driver
module.exports = {
  ...driver,

  /**
   * Aplica migrations idempotentes.
   * Chama runMigrations do legacy database.js (que conhece o schema completo)
   * E também aplica migrations versionadas em /migrations
   */
  async runMigrations() {
    const legacy = require('./database-legacy');

    // v9.5.0 BUG #148: schema completo (CREATE TABLE users, workspaces, ...)
    // só era aplicado quando legacy.initialize() era chamado. server.js usa
    // `driver.initialize()` (do sqlite-driver), que só abre a conexão sem
    // executar o SCHEMA. Resultado: queries em users/login_attempts crashavam
    // com "no such table: users". Em SQLite, exportamos SCHEMA do legacy e
    // aplicamos aqui.
    if (driver.driver === 'sqlite') {
      try {
        const { SCHEMA } = legacy;
        if (typeof SCHEMA === 'string' && SCHEMA.length > 0) {
          driver.exec(SCHEMA);
          logger.info('[DB] Base schema applied');
        }
      } catch (err) {
        logger.warn(`[DB] Schema exec issue: ${err.message}`);
      }
    }

    if (typeof legacy.runMigrations === 'function') {
      try {
        legacy.runMigrations(driver.driver === 'sqlite' ? driver.getDb() : null);
        logger.info('[DB] Legacy migrations applied');
      } catch (err) {
        logger.warn(`[DB] Legacy migrations issue: ${err.message}`);
      }
    }

    // Aplica migrations versionadas
    try {
      const { runVersionedMigrations } = require('./migration-runner');
      await runVersionedMigrations(driver);
    } catch (err) {
      logger.warn(`[DB] Versioned migrations issue: ${err.message}`);
    }
  },
};
