#!/usr/bin/env node
'use strict';
/**
 * Purga de retenção (LGPD art. 16 + higiene operacional).
 *
 * Política de minimização: dados deixam de ser guardados além do necessário.
 * DRY-RUN por padrão (só conta) — exige --apply para deletar.
 *
 * Categorias (janelas configuráveis por env):
 *   - refresh_tokens EXPIRADOS                → sempre (segurança/minimização)
 *   - webhook_inbox 'processed' antigos       → RETENTION_WEBHOOK_DAYS (90)
 *   - data_deletion_log antigos               → RETENTION_AUDIT_DAYS (365 ≈ 12m)
 *
 * NUNCA purga billing_invoices: retenção fiscal de 5 anos (Receita Federal).
 *
 * Comparação de datas: usamos o formato do SQLite ('YYYY-MM-DD HH:MM:SS', UTC),
 * que também é literal de timestamp válido no Postgres — assim a comparação
 * textual coincide com a cronológica nos dois drivers.
 *
 * Uso:
 *   node scripts/lgpd-retention-purge.js            # dry-run
 *   node scripts/lgpd-retention-purge.js --apply    # executa
 */

const db = require('../src/utils/database');

const envInt = (name, def) => parseInt(process.env[name], 10) || def;

/** ms epoch → 'YYYY-MM-DD HH:MM:SS' (UTC), formato do CURRENT_TIMESTAMP. */
function sqlTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Executa a purga. Opera no singleton de DB (mesma conexão do app/testes).
 * @returns {{ jobs: Array<{name:string,count:number}>, total:number, apply:boolean }}
 */
function purge({
  apply = false,
  webhookDays = envInt('RETENTION_WEBHOOK_DAYS', 90),
  auditDays = envInt('RETENTION_AUDIT_DAYS', 365),
  now = Date.now(),
} = {}) {
  const nowStr = sqlTime(now);
  const jobs = [
    {
      name: 'refresh_tokens expirados',
      where: `expires_at < ?`,
      table: 'refresh_tokens',
      params: [nowStr],
    },
    {
      name: `webhook_inbox processados > ${webhookDays}d`,
      where: `status = 'processed' AND received_at < ?`,
      table: 'webhook_inbox',
      params: [sqlTime(now - webhookDays * 86400000)],
    },
    {
      name: `data_deletion_log > ${auditDays}d`,
      where: `created_at < ?`,
      table: 'data_deletion_log',
      params: [sqlTime(now - auditDays * 86400000)],
    },
  ];

  const out = [];
  let total = 0;
  for (const j of jobs) {
    let count = 0;
    try {
      count = db.get(`SELECT COUNT(*) AS n FROM ${j.table} WHERE ${j.where}`, j.params).n;
    } catch (e) {
      out.push({ name: j.name, count: 0, skipped: e.message });
      continue;
    }
    if (apply && count > 0) {
      db.run(`DELETE FROM ${j.table} WHERE ${j.where}`, j.params);
    }
    total += count;
    out.push({ name: j.name, count });
  }
  return { jobs: out, total, apply };
}

module.exports = { purge, sqlTime };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  (async () => {
    // Em runtime real o schema já existe; runMigrations é idempotente e garante
    // que rodar isto numa máquina nova não quebre.
    if (typeof db.runMigrations === 'function') await db.runMigrations();
    console.log(`\n🧹 Purga de retenção (${apply ? 'APPLY' : 'dry-run'})\n`);
    const res = purge({ apply });
    for (const j of res.jobs) {
      if (j.skipped) {
        console.log(`   ⚠️  ${j.name}: pulado (${j.skipped})`);
      } else {
        console.log(
          `   ${apply ? '🗑️ ' : '🔎'} ${j.name}: ${j.count} ${apply ? 'removido(s)' : 'a remover'}`
        );
      }
    }
    console.log(`\n   💾 billing_invoices: PRESERVADAS (retenção fiscal 5 anos).`);
    console.log(
      `\n${apply ? '✅ purga aplicada' : 'ℹ️  dry-run — use --apply para executar'}: ${res.total} registro(s).\n`
    );
    process.exit(0);
  })().catch((e) => {
    console.error(`\n✗ purga falhou: ${e.message}`);
    process.exit(1);
  });
}
