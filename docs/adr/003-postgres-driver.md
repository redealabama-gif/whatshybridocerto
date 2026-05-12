# ADR 003 — PostgreSQL Driver com Fallback SQLite

**Status:** Accepted
**Date:** 2026-05-07

## Contexto

SQLite + better-sqlite3 (WAL mode) trabalha bem até ~50 conexões concorrentes. Acima disso, deadlocks intermitentes começam a aparecer (Socket.IO + cron + workers + webhooks + extensão). Para escalar a 100+ clientes pagantes (target marketing v9), Postgres é necessário.

Mas: solo dev. Trocar tudo de uma vez pra Postgres + perder facilidade de dev local seria caro.

## Decisão

**Driver dual com seleção via env var `DB_DRIVER`:**

- `DB_DRIVER=sqlite` (default — dev/test)
- `DB_DRIVER=postgres` (produção a partir de 100+ clientes)

API uniforme nos drivers (`run`, `get`, `all`, `transaction`, `exec`, `close`). Conversões automáticas:
- Placeholders `?` → `$1, $2, ...`
- `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- `DATETIME DEFAULT CURRENT_TIMESTAMP` → `TIMESTAMP DEFAULT NOW()`

**Sem ORM.** Continua SQL puro com prepared statements. `pg` direto.

## Alternativas consideradas

1. **Migrar tudo pra Postgres + perder SQLite** — solo dev produtividade cai (rodar Postgres local pra cada feature dev é overhead)
2. **Prisma** — adiciona complexity, schema duplicado, geração de cliente
3. **Sequelize/TypeORM** — overhead pesado, ORM aprendizado
4. **Manter SQLite + scaling vertical** — VPS gigante eventualmente vira gargalo

## Consequências

✅ Dev local continua simples (SQLite default)
✅ CI roda em SQLite (rápido)
✅ Produção pode escalar via Postgres (pool 20+ conexões)
✅ Migration gradual: rotas críticas migram primeiro

❌ Code que assume DB síncrono (better-sqlite3) precisa virar async em alguns lugares quando rodar em pg
❌ Diferenças sutis de tipos (TIMESTAMP vs DATETIME, BOOLEAN vs INTEGER) podem causar bugs sutis
❌ Migration do dado real (SQLite → Postgres em prod) precisa janela de manutenção

## Plano de migração para Postgres em prod

1. Provisiona Postgres no docker-compose (já incluído)
2. Roda migrations versionadas no Postgres vazio
3. Script `scripts/migrate-sqlite-to-postgres.js` (ainda não escrito) copia dados
4. Verifica counts batem antes/depois
5. Switch `DB_DRIVER=postgres` em produção
6. SQLite fica como backup / rollback option por 30 dias

## Validação

Smoke tests devem passar com `DB_DRIVER=postgres` idênticos ao `sqlite`.
Load test (k6) com 100 VUs concorrentes precisa passar em Postgres.
