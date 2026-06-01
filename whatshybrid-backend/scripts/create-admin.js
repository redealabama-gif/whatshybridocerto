#!/usr/bin/env node
/**
 * create-admin — cria (ou promove) um usuário admin no SQLite.
 *
 * Uso:
 *   npm run create-admin -- --email=admin@admin.com --password=admin12345 --name=Admin
 *
 * Sem flags, usa defaults: admin@admin.com / admin12345 / Admin.
 * Se o email já existir, apenas garante role='admin' e atualiza a senha
 * (caso --password tenha sido passado).
 */

const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const uuidv4 = () => crypto.randomUUID();

function parseArgs(argv) {
  const out = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv);
const email = (args.email || 'admin@admin.com').toLowerCase().trim();
const password = args.password || 'admin12345';
const name = args.name || 'Admin';
const company = args.company || 'AdminCo';
const passwordExplicit = Boolean(args.password);

const dbPath = process.env.DATABASE_PATH ||
  path.join(__dirname, '..', 'data', 'whatshybrid.db');

let db;
try {
  db = new Database(dbPath);
} catch (err) {
  console.error(`\nNão consegui abrir o banco em ${dbPath}`);
  console.error(`Detalhe: ${err.message}`);
  console.error(`\nRode 'npm run migrate' primeiro pra criar o schema.\n`);
  process.exit(1);
}

const existing = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email);

if (existing) {
  const updates = ["role = 'admin'", 'updated_at = CURRENT_TIMESTAMP'];
  const params = [];
  if (passwordExplicit) {
    updates.push('password = ?');
    params.push(bcrypt.hashSync(password, 10));
  }
  params.push(existing.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  console.log(`\nUsuário '${email}' promovido para admin.`);
  if (passwordExplicit) console.log(`Senha atualizada.`);
  console.log(`\nLogin: ${email}`);
  if (passwordExplicit) console.log(`Senha: ${password}`);
  console.log(`\nAcesse http://localhost:3000/admin\n`);
  process.exit(0);
}

const userId = uuidv4();
const workspaceId = uuidv4();
const hashed = bcrypt.hashSync(password, 10);
const trialEnd = new Date();
trialEnd.setDate(trialEnd.getDate() + 365);

const tx = db.transaction(() => {
  db.prepare(
    `INSERT INTO users (id, email, password, name, role, workspace_id)
     VALUES (?, ?, ?, ?, 'admin', ?)`
  ).run(userId, email, hashed, name, workspaceId);

  db.prepare(
    `INSERT INTO workspaces (id, name, owner_id, plan, trial_end_at, subscription_status, credits)
     VALUES (?, ?, ?, 'pro', ?, 'active', 100000)`
  ).run(workspaceId, company, userId, trialEnd.toISOString());
});

tx();

console.log(`\nAdmin criado com sucesso!`);
console.log(`\nLogin: ${email}`);
console.log(`Senha: ${password}`);
console.log(`Role:  admin`);
console.log(`\nAcesse http://localhost:3000/admin\n`);
