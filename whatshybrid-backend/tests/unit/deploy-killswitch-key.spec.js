'use strict';

/**
 * IA-04 (deploy) — em produção o kill switch recusa a chave padrão
 * CHANGE_ME_IN_PRODUCTION: sem ADMIN_KILL_SWITCH_KEY, POST
 * /api/v1/admin/kill-switch/set responde 503. O docker-compose.yml entrega ao
 * container do backend só as variáveis que lista, e ADMIN_KILL_SWITCH_KEY não
 * estava na lista: a chave posta no .env nunca chegava ao processo e, no deploy
 * Docker, não havia como ligar o kill switch.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Bloco de um serviço do docker-compose.yml: da linha "  nome:" até a próxima
// linha com indentação de serviço (ou de seção de topo).
function serviceBlock(compose, name) {
  const lines = compose.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`serviço "${name}" não está no docker-compose.yml`);
  let end = start + 1;
  while (end < lines.length && !/^ {0,2}\S/.test(lines[end])) end++;
  return lines.slice(start + 1, end).join('\n');
}
const envNames = (block) => [...block.matchAll(/^\s*-\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

// Linhas que atribuem a variável (comentários não contam).
const assignments = (text, name) => text.split('\n').filter((l) => l.startsWith(`${name}=`));

// Trecho do install.sh que monta o .env novo (do cp do template ao log_ok).
function envSetupBlock(sh) {
  const start = sh.indexOf('cp .env.example .env');
  const end = sh.indexOf('log_ok ".env criado', start);
  if (start < 0 || end < 0) throw new Error('trecho que cria o .env não encontrado no install.sh');
  return sh.slice(start, end);
}

test('docker-compose.yml: o container do backend recebe ADMIN_KILL_SWITCH_KEY', () => {
  const backend = serviceBlock(read('docker-compose.yml'), 'backend');
  expect(envNames(backend)).toContain('ADMIN_KILL_SWITCH_KEY');
  // Vem só do .env: um valor padrão no compose seria uma chave pública.
  expect(backend).toMatch(/^\s*- ADMIN_KILL_SWITCH_KEY=\$\{ADMIN_KILL_SWITCH_KEY(:-)?\}\s*$/m);
});

test('.env.example (raiz e backend) trazem ADMIN_KILL_SWITCH_KEY vazia', () => {
  // Vazia de propósito: o install.sh copia o template para o .env, e um valor
  // de exemplo viraria a chave de produção (só CHANGE_ME_IN_PRODUCTION é recusada).
  expect(assignments(read('.env.example'), 'ADMIN_KILL_SWITCH_KEY')).toEqual(['ADMIN_KILL_SWITCH_KEY=']);
  expect(assignments(read('whatshybrid-backend/.env.example'), 'ADMIN_KILL_SWITCH_KEY')).toEqual([
    'ADMIN_KILL_SWITCH_KEY=',
  ]);
});

test('install.sh gera ADMIN_KILL_SWITCH_KEY aleatória no .env novo', () => {
  const block = envSetupBlock(read('deploy/scripts/install.sh'));
  expect(block).toMatch(/^\s*ADMIN_KILL_SWITCH_KEY=\$\(openssl rand -hex 32\)$/m);
  expect(block).toContain('sed -i "s|^ADMIN_KILL_SWITCH_KEY=.*|ADMIN_KILL_SWITCH_KEY=$ADMIN_KILL_SWITCH_KEY|" .env');
});
