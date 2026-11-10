/**
 * Sobe o servidor de verdade (src/server.js) num processo separado, em modo
 * produção, com banco SQLite temporário — para testar o que só aparece com o
 * app inteiro montado (CORS, proxy, limites de tentativa, cabeçalhos).
 *
 *   const srv = await startRealServer({ CORS_ORIGIN: '...' });
 *   const r = await srv.request('POST', '/api/v1/auth/login', { headers, body });
 *   await srv.stop();
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const SERVER = path.join(__dirname, '../../../src/server.js');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function startRealServer(env = {}) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-real-'));
  let output = '';
  const proc = spawn(process.execPath, [SERVER], {
    cwd: dir, // trava do JobsRunner e afins ficam no diretório temporário
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DB_PATH: path.join(dir, 'real.db'),
      DATABASE_PATH: path.join(dir, 'real.db'),
      REDIS_DISABLED: 'true',
      BILLING_CRON_DISABLED: 'true',
      EMAIL_OUTBOX_DISABLED: 'true',
      JWT_SECRET: 'abcdef0123456789abcdef0123456789abcdef0123',
      WEBHOOK_SECRET: 'abcdef0123456789abcdef',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (c) => { output += c; });
  proc.stderr.on('data', (c) => { output += c; });

  function request(method, pathname, { headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const h = { ...headers };
      if (data) {
        h['Content-Type'] = 'application/json';
        h['Content-Length'] = Buffer.byteLength(data);
      }
      const r = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: h }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(buf); } catch (_) { /* não é JSON */ }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }

  const deadline = Date.now() + 25000;
  for (;;) {
    try {
      const r = await request('GET', '/health');
      if (r.status === 200) break;
    } catch (_) { /* ainda subindo */ }
    if (Date.now() > deadline || proc.exitCode !== null) {
      proc.kill('SIGKILL');
      throw new Error(`servidor não subiu:\n${output.slice(-3000)}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  async function stop() {
    if (proc.exitCode === null) {
      const exited = new Promise((r) => proc.once('exit', r));
      proc.kill('SIGKILL');
      await exited;
    }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ }
  }

  return { port, request, stop, output: () => output };
}

module.exports = { startRealServer };
