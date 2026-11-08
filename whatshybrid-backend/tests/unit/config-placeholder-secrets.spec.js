'use strict';

/**
 * Em produção, config/index.js recusa os valores de exemplo do .env.example
 * (REPLACE_WITH_...) — eles são públicos. Em dev/test continuam aceitos.
 *
 * Cada caso roda num processo separado porque o config valida no require().
 */
const { spawnSync } = require('child_process');
const path = require('path');

const BACKEND_DIR = path.join(__dirname, '..', '..');
const JWT_PLACEHOLDER = 'REPLACE_WITH_RANDOM_64CHAR_VALUE_RUN_COMMAND_ABOVE';
const WEBHOOK_PLACEHOLDER = 'REPLACE_WITH_GENERATED_WEBHOOK_SECRET';
const JWT_REAL = 'f3a9c1d27e8b4c6a9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e';
const WEBHOOK_REAL = 'WHK_8c1f0e9d2b3a4c5d6e7f8091a2b3c4d5';

function loadConfig(env) {
  const r = spawnSync(process.execPath, ['-e', "require('./config'); process.stdout.write('ok')"], {
    cwd: BACKEND_DIR,
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  return { ok: r.status === 0 && r.stdout === 'ok', stderr: r.stderr };
}

describe('config: valores de exemplo do .env.example', () => {
  test('produção recusa JWT_SECRET de exemplo', () => {
    const r = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: JWT_PLACEHOLDER,
      WEBHOOK_SECRET: WEBHOOK_REAL,
    });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/JWT_SECRET ainda é o valor de exemplo/);
  });

  test('produção recusa WEBHOOK_SECRET de exemplo', () => {
    const r = loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: JWT_REAL,
      WEBHOOK_SECRET: WEBHOOK_PLACEHOLDER,
    });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/WEBHOOK_SECRET ainda é o valor de exemplo/);
  });

  test('produção aceita segredos reais', () => {
    expect(
      loadConfig({ NODE_ENV: 'production', JWT_SECRET: JWT_REAL, WEBHOOK_SECRET: WEBHOOK_REAL }).ok
    ).toBe(true);
  });

  test('development aceita os valores de exemplo (primeira execução)', () => {
    expect(
      loadConfig({
        NODE_ENV: 'development',
        JWT_SECRET: JWT_PLACEHOLDER,
        WEBHOOK_SECRET: WEBHOOK_PLACEHOLDER,
      }).ok
    ).toBe(true);
  });
});
