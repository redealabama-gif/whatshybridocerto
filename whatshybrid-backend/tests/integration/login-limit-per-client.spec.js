/**
 * PROD-05 — limite de tentativas de login valia para TODOS os clientes juntos.
 *
 * Em produção o backend fica atrás do Caddy (deploy/caddy/Caddyfile). Sem
 * `trust proxy`, o Express vê o IP do Caddy em todo pedido: o limite de 5 senhas
 * erradas a cada 15 minutos (authLimiter, por IP) virava um só para o site
 * inteiro — 5 erros de quaisquer clientes bloqueavam o login de todo mundo.
 *
 * Aqui o pedido chega pelo endereço interno (127.0.0.1, como o Caddy na rede do
 * Docker) com o X-Forwarded-For que o Caddy põe com o IP do cliente.
 */

const fs = require('fs');
const path = require('path');
const { startRealServer } = require('./helpers/real-server');

const SENHA = 'Cliente#Teste2026';
let srv;

beforeAll(async () => {
  srv = await startRealServer({ CORS_ORIGIN: 'https://vortex.example,chrome-extension://*' });
}, 30000);
afterAll(async () => { if (srv) await srv.stop(); });

const login = (ip, email, password) => srv.request('POST', '/api/v1/auth/login', {
  headers: { 'X-Forwarded-For': ip },
  body: { email, password },
});

describe('PROD-05 — limite de tentativas de login por cliente', () => {
  const emailB = `cliente-b-${Date.now()}@example.com`;

  beforeAll(async () => {
    const r = await srv.request('POST', '/api/v1/auth/signup', {
      headers: { 'X-Forwarded-For': '198.51.100.20' },
      body: { email: emailB, password: SENHA, name: 'Cliente B', company: 'Loja B' },
    });
    expect(r.status).toBe(201);
  });

  test('5 senhas erradas do cliente A não bloqueiam o login do cliente B', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await login('203.0.113.10', 'cliente-a@example.com', `errada-${i}-123`);
      expect(r.status).toBe(401);
    }
    const b = await login('198.51.100.20', emailB, SENHA);
    expect({ status: b.status, message: b.body && b.body.message }).toMatchObject({ status: 200 });
  });

  test('o cliente A continua limitado (o limite não sumiu)', async () => {
    const r = await login('203.0.113.10', 'cliente-a@example.com', 'errada-6-123');
    expect(r.status).toBe(429);
  });

  test('o Caddy repassa só o IP do cliente (sem a porta)', () => {
    const caddy = fs.readFileSync(path.join(__dirname, '../../../deploy/caddy/Caddyfile'), 'utf8');
    const linhas = caddy.split('\n').filter((l) => /^\s*header_up\s+X-(Forwarded-For|Real-IP)\b/i.test(l));
    expect(linhas.length).toBeGreaterThan(0);
    // {remote} = IP:porta (RemoteAddr) — cada conexão viraria um "cliente" novo
    for (const l of linhas) expect(l).toMatch(/\{remote_host\}|\{client_ip\}/);
  });
});
