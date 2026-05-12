# CHANGELOG v9.3.7 — SQL Injection Audit (Etapa 7)

**Data:** Maio de 2026
**Tipo:** Patch — auditoria de segurança SQL
**Compatibilidade:** Drop-in. Sem migrations novas.
**Target:** elevar nota de 8.7 → 8.75

---

## 🎯 Por que existe

Primeira de 12 etapas adicionais (Etapas 7-18) acordadas pra fechar todos os bugs estáticos identificáveis antes dos testes reais.

Etapa 7 focou em **SQL injection e DoS via queries**.

---

## 🟢 Resultado: codebase já bem auditado pra SQL injection

Auditei 13 padrões de injection diferentes em **todos** os 145 arquivos backend:

| Padrão verificado | Achados |
|---|---|
| Template literal `db.run(\`...${var}...\`)` | 8 falsos positivos (todos com whitelist ou só literais) |
| Concatenação `'...' + var + '...'` | 0 |
| `LIMIT ${var}` / `OFFSET ${var}` dinâmico | 0 |
| `IN (${arr})` com array do user | 0 |
| `LIKE '%${var}%'` direto | 6 — **DoS via wildcards** (corrigido) |
| `req.params/body/query` direto em SQL | 0 |
| `db.exec(\`...${var}...\`)` | 0 |
| `db.prepare(\`...${var}...\`)` | 0 |
| `pragma()` com input | 0 |
| Subqueries dinâmicas | 0 |
| `OR/AND` construídos | 0 |
| `migration-runner` com SQL externo | 0 (lê de filesystem) |
| Services dinâmicos | 0 (todos placeholders) |

**0 SQL injections reais encontradas.** Codebase usa placeholders `?` consistentemente. Patterns dinâmicos como `UPDATE x SET ${updates.join(',')}` são seguros porque `updates` só recebe strings literais hardcoded (`'name = ?'`, etc) e os valores vão como parâmetros bound.

---

## 🟠 Bug #50 — DoS via LIKE wildcards (CORRIGIDO)

**Severidade:** Médio (DoS)
**Cenário:** 6 endpoints aceitam `?search=...` e injetam direto no LIKE como `%${search}%`. Problema:
- Cliente passa `?search=` com 100KB → query lenta
- Cliente passa `?search=%_%` → wildcards tornam scan completo
- Cliente passa `?search=10%` querendo "10%" literal → vira wildcard, busca "10" + qualquer coisa

Não é injection (placeholders bound), mas é **DoS barato**: atacante pode esgotar CPU do servidor com poucos requests.

**Fix:** Novo helper centralizado `src/utils/sql-helpers.js`:
```js
const MAX_SEARCH_LENGTH = 100;

function escapeLikeWildcards(str) {
  return String(str).replace(/[\\%_]/g, '\\$&');
}

function makeLikeTerm(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SEARCH_LENGTH) return null;
  return `%${escapeLikeWildcards(trimmed)}%`;
}

function safeInt(input, defaultValue, max = Infinity) {
  const n = parseInt(input, 10);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return Math.min(n, max);
}
```

Uso nas 5 routes corrigidas:
```js
const term = makeLikeTerm(req.query.search);
if (term) {
  sql += ` AND (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')`;
  params.push(term, term);
}
```

`ESCAPE '\\'` no SQL faz o motor SQLite/Postgres respeitar o escape do `%`/`_`.

### Routes corrigidas

| Route | Endpoint |
|---|---|
| `routes/contacts.js` | GET /api/v1/contacts?search= |
| `routes/memory.js` | GET /api/v1/memory?search= |
| `routes/knowledge.js` | GET /api/v1/knowledge/products?search= |
| `routes/knowledge.js` | GET /api/v1/knowledge/faqs?search= |
| `routes/admin.js` | GET /api/v1/admin/subscriptions?search= |
| `routes/ai.js` | GET /api/v1/ai/knowledge?search= |

Bonus: `contacts.js` agora também valida `?page=` e `?limit=` via `safeInt()` — antes `parseInt('abc')` virava NaN e quebrava o LIMIT, ou `?limit=99999999` permitido.

---

## 📊 Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `src/utils/sql-helpers.js` | NOVO — `makeLikeTerm`, `escapeLikeWildcards`, `safeInt` |
| `src/routes/contacts.js` | makeLikeTerm + safeInt em page/limit |
| `src/routes/memory.js` | makeLikeTerm |
| `src/routes/knowledge.js` | makeLikeTerm em 2 endpoints |
| `src/routes/admin.js` | makeLikeTerm |
| `src/routes/ai.js` | makeLikeTerm |

**0 deps novas, 0 breaking changes, 0 migrations.**

---

## 🧪 Validação

```
▶ Backend JS:        145 arquivos válidos (+1 sql-helpers.js)
▶ Extension JS:      140 arquivos válidos
▶ Migrations SQL:    7 arquivos
▶ Testes formais:    15/15 passing
```

---

## 🎯 Nota honesta

**8.75/10** (sobe de 8.7).

- (+0.05) DoS via LIKE corrigido em 6 endpoints
- (+0.00) 0 SQL injections reais (codebase já estava limpo nesse vetor)

Aprendizado da auditoria: o código tem **disciplina forte** com SQL injection. Padrão de placeholder `?` consistente, `safeIdentifier` whitelist em interpolação de identificadores. Quem auditou antes fez bem.

---

## ⏭️ Próximas etapas

Restam 11 etapas. Próximas (em ordem de impacto):

- **Etapa 8** — XSS e Input Sanitization (innerHTML, .html(), template strings em DOM)
- **Etapa 9** — Auth & Rate Limiting (cobertura, CORS, helmet)
- **Etapa 10** — Secrets e Vazamento (logs, .env.example, console.log)
- **Etapa 11** — TokenService & Billing (idempotência, transações)
- **Etapa 12** — Campaigns & Disparos (retomada de fila)
- **Etapa 13** — Autopilot & Auto-learning (loop fechamento)
- **Etapa 14** — Inputs Limites (mensagens 50k chars, áudio 30MB)
- **Etapa 15** — Concorrência Multi-tab
- **Etapa 16** — Recovery & Resilience
- **Etapa 17** — Popup & Dashboard frontend
- **Etapa 18** — Memory Leaks (frontend)

---

**Versão:** 9.3.7
**Codename:** "Audited (SQL-Safe)"
**Próxima:** Etapa 8 — XSS
