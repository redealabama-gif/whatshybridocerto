/**
 * PROD-01 — "Começar trial grátis" e "Entrar" do site davam erro ("Erro: error").
 *
 * O navegador manda o cabeçalho Origin também nos POST da MESMA origem. O CORS
 * só aceitava as origens escritas em CORS_ORIGIN (no docker-compose:
 * https://${DOMAIN},chrome-extension://*). Bastava o site ser aberto por um
 * endereço que não estivesse exatamente na lista (www., outro domínio, http) para
 * o cadastro e o login do PRÓPRIO site serem recusados — e a recusa virava 500
 * {"error":"error","message":"Algo deu errado"}.
 *
 * Sobe o servidor de verdade (src/server.js) em modo produção, com a lista de
 * origens padrão do compose, e faz os pedidos como o navegador faria.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '../../src/server.js');
const SITE = 'www.vortex.example'; // endereço pelo qual o cliente abriu o site
const SENHA = 'Cliente#Teste2026';

let proc;
let port;
let dir;
let saida = '';

function portaLivre() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function pedir(method, caminho, { host = SITE, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const dados = body ? JSON.stringify(body) : null;
    const headers = { Host: host };
    if (origin) headers.Origin = origin;
    if (dados) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(dados);
    }
    const r = http.request({ host: '127.0.0.1', port, method, path: caminho, headers }, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(buf);
        } catch (_) {
          /* não é JSON */
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    r.on('error', reject);
    if (dados) r.write(dados);
    r.end();
  });
}

async function esperarNoAr(ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try {
      const r = await pedir('GET', '/health', { host: `127.0.0.1:${port}` });
      if (r.status === 200) return;
    } catch (_) {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`servidor não subiu:\n${saida.slice(-3000)}`);
}

beforeAll(async () => {
  port = await portaLivre();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cors-'));
  proc = spawn(process.execPath, [SERVER], {
    cwd: dir, // trava do JobsRunner e afins ficam no diretório temporário
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DB_PATH: path.join(dir, 'site.db'),
      DATABASE_PATH: path.join(dir, 'site.db'),
      REDIS_DISABLED: 'true',
      BILLING_CRON_DISABLED: 'true',
      EMAIL_OUTBOX_DISABLED: 'true',
      AUTH_RATE_LIMIT_MAX: '100000',
      JWT_SECRET: 'abcdef0123456789abcdef0123456789abcdef0123',
      WEBHOOK_SECRET: 'abcdef0123456789abcdef',
      // Padrão do docker-compose com DOMAIN=vortex.example
      CORS_ORIGIN: 'https://vortex.example,chrome-extension://*',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (c) => {
    saida += c;
  });
  proc.stderr.on('data', (c) => {
    saida += c;
  });
  await esperarNoAr(25000);
}, 30000);

afterAll(async () => {
  if (proc && proc.exitCode === null) {
    const saiu = new Promise((r) => proc.once('exit', r));
    proc.kill('SIGKILL');
    await saiu;
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {
    /* ok */
  }
});

describe('PROD-01 — cadastro e login do próprio site', () => {
  const email = `site-${Date.now()}@example.com`;

  test('"Começar trial grátis": cadastro pelo site aberto em www. cria a conta', async () => {
    const r = await pedir('POST', '/api/v1/auth/signup', {
      origin: `https://${SITE}`,
      body: { email, password: SENHA, name: 'Cliente', company: 'Loja', plan: 'pro' },
    });
    expect({ status: r.status, message: r.body && r.body.message }).toMatchObject({ status: 201 });
  });

  test('"Entrar": login pelo site aberto em www. funciona', async () => {
    const r = await pedir('POST', '/api/v1/auth/login', {
      origin: `https://${SITE}`,
      body: { email, password: SENHA },
    });
    expect({ status: r.status, message: r.body && r.body.message }).toMatchObject({ status: 200 });
    expect(r.body.accessToken).toBeTruthy();
  });

  test('senha errada responde 401 com mensagem (não 500)', async () => {
    const r = await pedir('POST', '/api/v1/auth/login', {
      origin: `https://${SITE}`,
      body: { email, password: 'errada-123456' },
    });
    expect({ status: r.status, message: r.body && r.body.message }).toMatchObject({ status: 401 });
  });

  test('site de fora continua bloqueado — 403 com motivo, sem liberar CORS', async () => {
    const r = await pedir('POST', '/api/v1/auth/login', {
      origin: 'https://site-falso.example',
      body: { email, password: SENHA },
    });
    expect(r.status).toBe(403);
    expect(r.body && r.body.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('(controle) a extensão — outra origem, liberada na lista — continua com CORS', async () => {
    const ext = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    const r = await pedir('POST', '/api/v1/auth/login', {
      origin: ext,
      body: { email: 'ninguem@example.com', password: SENHA },
    });
    expect(r.status).toBe(401);
    expect(r.headers['access-control-allow-origin']).toBe(ext);
  });
});
