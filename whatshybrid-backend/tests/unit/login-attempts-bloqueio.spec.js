/**
 * SEG-02 — o bloqueio por CONTA nunca barrou ninguém.
 *
 * LoginAttemptsService.isBlocked() conta as falhas com:
 *     WHERE created_at >= ?        , param = new Date(...).toISOString()
 * mas a coluna é DATETIME DEFAULT CURRENT_TIMESTAMP, que o SQLite grava como
 *     "2026-11-16 03:02:19"        (espaço, sem T, sem Z)
 * A comparação é de TEXTO. No mesmo dia, ' ' (0x20) < 'T' (0x54), então a
 * linha gravada é sempre MENOR que o corte e fica de fora: a contagem dá 0 e
 * o bloqueio não dispara nunca.
 *
 * Medido (node, banco limpo): 5 falhas gravadas -> a consulta encontra 0.
 *
 * O defeito só não aparecia quando a janela de 15 min cruzava a meia-noite
 * UTC: aí a parte da DATA decide a comparação e a contagem funciona por
 * acidente. Foi por isso que o teste de integração passou de madrugada e
 * falhou depois.
 *
 * Com o limite por IP em 5/15min e este por conta desligado, bastava trocar de
 * IP a cada tentativa para atacar uma conta sem limite nenhum.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let dir;
let db;
let service;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-attempts-'));
  process.env.DB_PATH = path.join(dir, 'teste.db');
  process.env.JWT_SECRET = 'x'.repeat(40);
  db = require('../../src/utils/database');
  db.exec(`CREATE TABLE IF NOT EXISTS login_attempts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL, ip TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  service = require('../../src/services/LoginAttemptsService');
});

afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });

beforeEach(() => db.run('DELETE FROM login_attempts'));

const falhar = (email, n, ip = '1.1.1.1') => {
  for (let i = 0; i < n; i++) service.recordAttempt(email, ip, false);
};

describe('SEG-02: bloqueio por conta', () => {
  test('3 senhas erradas na mesma conta bloqueiam', () => {
    falhar('alvo@example.com', 3);
    const r = service.isBlocked('alvo@example.com');
    expect(r.blocked).toBe(true);
    expect(r.failures).toBeGreaterThanOrEqual(3);
  });

  test('o tempo de espera é positivo e dentro do bloqueio de 15 min', () => {
    falhar('alvo2@example.com', 3);
    const r = service.isBlocked('alvo2@example.com');
    // Pega também o erro de fuso: o SQLite grava em UTC e new Date("... ...")
    // leria como hora LOCAL — num servidor a leste, o tempo restante sairia
    // negativo e o bloqueio não valeria.
    expect(r.retry_after_seconds).toBeGreaterThan(0);
    expect(r.retry_after_seconds).toBeLessThanOrEqual(15 * 60 + 5);
  });

  test('o IP não importa: 3 falhas de IPs diferentes bloqueiam igual', () => {
    ['203.0.113.1', '198.51.100.2', '192.0.2.3'].forEach((ip) => falhar('alvo3@example.com', 1, ip));
    expect(service.isBlocked('alvo3@example.com').blocked).toBe(true);
  });

  test('2 falhas ainda não bloqueiam', () => {
    falhar('alvo4@example.com', 2);
    expect(service.isBlocked('alvo4@example.com').blocked).toBe(false);
  });

  test('falhas antigas (fora da janela) não contam', () => {
    for (let i = 0; i < 5; i++) {
      db.run(
        "INSERT INTO login_attempts (id,email,ip,success,created_at) VALUES (?,?,?,0, datetime('now','-2 days'))",
        ['velho' + i, 'alvo5@example.com', '1.1.1.1']
      );
    }
    expect(service.isBlocked('alvo5@example.com').blocked).toBe(false);
  });

  test('logins bem-sucedidos não contam como falha', () => {
    for (let i = 0; i < 5; i++) service.recordAttempt('alvo6@example.com', '1.1.1.1', true);
    expect(service.isBlocked('alvo6@example.com').blocked).toBe(false);
  });

  test('outra conta não é afetada', () => {
    falhar('alvo7@example.com', 5);
    expect(service.isBlocked('alvo7@example.com').blocked).toBe(true);
    expect(service.isBlocked('inocente@example.com').blocked).toBe(false);
  });
});
