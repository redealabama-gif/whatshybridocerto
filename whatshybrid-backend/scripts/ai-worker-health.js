#!/usr/bin/env node
/**
 * INF-01 — healthcheck do ai-worker (usado pelo docker-compose).
 *
 * O worker grava um carimbo de tempo em whl:ai-worker:heartbeat a cada 15 s.
 * Aqui lemos esse carimbo: se não existir ou estiver velho, saímos com código
 * 1 e o Docker marca o container como unhealthy (e reinicia, com a política
 * restart: unless-stopped + autoheal, ou pelo menos aparece no `docker ps`).
 *
 * Sem dependência extra: usa o protocolo RESP direto num socket TCP.
 * Uso: node scripts/ai-worker-health.js   (lê REDIS_URL; limite WORKER_HEARTBEAT_MAX_AGE_MS)
 */
'use strict';
const net = require('net');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MAX_AGE_MS = parseInt(process.env.WORKER_HEARTBEAT_MAX_AGE_MS, 10) || 90000;
const KEY = 'whl:ai-worker:heartbeat';

const url = new URL(REDIS_URL);
const socket = net.createConnection({ host: url.hostname, port: Number(url.port) || 6379 });
socket.setTimeout(5000);

let buffer = '';
const falhar = (motivo) => { console.error(`ai-worker unhealthy: ${motivo}`); socket.destroy(); process.exit(1); };

socket.on('connect', () => {
  const comandos = [];
  if (url.password) comandos.push(`*2\r\n$4\r\nAUTH\r\n$${url.password.length}\r\n${url.password}\r\n`);
  comandos.push(`*2\r\n$3\r\nGET\r\n$${KEY.length}\r\n${KEY}\r\n`);
  socket.write(comandos.join(''));
});
socket.on('timeout', () => falhar('Redis não respondeu em 5 s'));
socket.on('error', (e) => falhar(`Redis inacessível (${e.message})`));
socket.on('data', (chunk) => {
  buffer += chunk.toString();
  // resposta do GET: "$13\r\n1700000000000\r\n" ou "$-1\r\n" (sem chave)
  const semChave = /\$-1\r\n/.test(buffer);
  const m = buffer.match(/\$\d+\r\n(\d{10,})\r\n/);
  if (semChave) falhar('sem batimento no Redis (worker nunca subiu ou travou)');
  if (!m) return; // ainda chegando (ou é a resposta do AUTH)
  const idade = Date.now() - Number(m[1]);
  socket.destroy();
  if (idade > MAX_AGE_MS) falhar(`último batimento há ${Math.round(idade / 1000)} s (limite ${Math.round(MAX_AGE_MS / 1000)} s)`);
  console.log(`ai-worker ok (batimento há ${Math.round(idade / 1000)} s)`);
  process.exit(0);
});
