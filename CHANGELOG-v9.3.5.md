# CHANGELOG v9.3.5 — Multi-Tenant Isolation (Etapa 4)

**Data:** Maio de 2026
**Tipo:** Patch — bugs de isolamento multi-tenant
**Compatibilidade:** Drop-in. Sem migrations novas.
**Target:** elevar nota de 8.5 → 8.6

---

## 🎯 Por que existe

Continuação da auditoria de 6 etapas. Esta versão fecha **Etapa 4 (Multi-tenant isolation)**.

Status:
- ✅ Etapa 1 (Contracts): 14 bugs, 11 corrigidos (v9.3.3)
- ✅ Etapa 2 (Schema): 4 bugs, 3 corrigidos (v9.3.3)
- ✅ Etapa 3 (Race conditions): 6 bugs, 4 corrigidos (v9.3.4)
- ✅ Etapa 4 (Multi-tenant): 8 itens auditados, 3 bugs corrigidos (esta versão)
- ⏳ Etapa 5 (Error paths)
- ⏳ Etapa 6 (SQLite vs Postgres drift)

**Total acumulado: 32 itens, 21 bugs corrigidos.**

---

## 🟠 Bug #33 — 19 fallbacks `'default'` removidos

**Severidade:** Alta (potencial vazamento de dados entre clientes)

**Cenário:** Routes resolviam workspace assim:
```js
const workspaceId = req.workspaceId || req.user.workspace_id || 'default';
```

Se autenticação passasse mas `req.workspaceId` e `req.user.workspace_id` fossem null (DB inconsistente, user mal cadastrado, race entre middlewares), a request caía no pool comum `'default'`.

Resultado: dois clientes com o mesmo problema veriam dados um do outro — memória, knowledge base, learning patterns, autopilot maturity, tudo cruzado.

**Fix:** Substituí 19 ocorrências em 4 arquivos por:
```js
const workspaceId = req.workspaceId || req.user?.workspace_id;
if (!workspaceId) return res.status(401).json({ error: 'workspace_id missing in session' });
```

Falhar explicitamente é melhor do que vazar dados silenciosamente.

**Arquivos modificados:**
- `routes/ai-v2.js` (1)
- `routes/intelligence.js` (6)
- `routes/memory.js` (6)
- `routes/knowledge.js` (6)

**Não corrigi:** `recover.js` (`userId || 'default'` é sanitização pra path filesystem, não tenant) e `metrics.js` (`'default'` é pricing key fallback, não tenant).

---

## 🟡 Bug #34 — `_loadInteractionMetadataFromDB` sem workspace_id

**Severidade:** Defesa em profundidade

**Cenário:** `AIOrchestrator._loadInteractionMetadataFromDB(interactionId)` carregava metadata só por `interaction_id`. Como UUID é gerado server-side e o orchestrator já tem `this.tenantId`, era seguro **na prática** — mas se um bug futuro fizesse o orchestrator errado chamar este método (workspace A pedindo metadata de interaction de workspace B), vazaria.

**Fix:** Adicionado filtro `AND workspace_id = ?` usando `this.tenantId`.

---

## 🟠 Bug #35 — `JobsRunner.SYNC_CONTACTS` UPDATE sem workspace_id

**Severidade:** Defesa em profundidade

**Cenário:** Job `SYNC_CONTACTS` fazia:
```js
UPDATE contacts SET synced_at = ? WHERE id = ?
```

Sem filtro de `workspace_id`. Se job comprometido (payload forjado) for processado, pode marcar contatos de outros workspaces como "sincronizados" silenciosamente.

**Atenuação:** Job atualmente não é enqueued por nenhum caller (dead code). Risco zero hoje. Mas correção é trivial e protege futuro uso.

**Fix:**
```js
UPDATE contacts SET synced_at = ? WHERE id = ? AND workspace_id = ?
```

---

## 🟢 Auditorias com resultado positivo

Investigado e confirmado seguro:

- **`req.body.workspace_id` forjável:** 0 ocorrências encontradas. Nenhuma rota usa workspace do body sem validação.
- **`checkWorkspace` middleware:** Valida ativamente que workspace solicitado bate com `req.user.workspace_id`. Defesa correta.
- **`messages` queries:** Tabela sem `workspace_id` direto, mas todas queries fazem JOIN com `conversations` (que tem) ou são precedidas de validação da `conversation_id`.
- **`learning_patterns`, `chat_memories`:** Todos os accessos usam `workspace_id` via `this.tenantId`.
- **INSERTs em todas tabelas:** Verificado via script — todas as 16 tabelas com coluna `workspace_id` sempre incluem o campo no INSERT.
- **`audit_log search`:** Service criado mas sem callers. Não há vazamento ativo.

---

## 🟡 Anotado mas não corrigido

### Bug #38 — `logout()` não limpa `chrome.storage.local`

`BackendClient.logout()` só limpa `state` em memória. Se cliente desloga e loga com OUTRA conta, dados antigos no `chrome.storage` (CRM, tasks, knowledge, autopilot) podem persistir e ser usados pela conta nova.

**Não corrigi nesta sessão** porque é trabalho largo: precisa enumerar todas as keys `whl_*` no chrome.storage e decidir quais limpar (data sensível) vs preservar (config UI). Risco real mas merece análise dedicada.

**Workaround temporário:** usuário que troca conta deve desinstalar e reinstalar a extensão.

---

## 📊 Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `src/routes/ai-v2.js` | Removido fallback `'default'` (1 ocorrência) |
| `src/routes/intelligence.js` | Removido fallback `'default'` (6 ocorrências) |
| `src/routes/memory.js` | Removido fallback `'default'` (6 ocorrências) |
| `src/routes/knowledge.js` | Removido fallback `'default'` (6 ocorrências) |
| `src/ai/AIOrchestrator.js` | Adicionado `workspace_id` filter em `_loadInteractionMetadataFromDB` |
| `src/jobs/JobsRunner.js` | Adicionado `workspace_id` filter em SYNC_CONTACTS UPDATE |

**0 deps novas, 0 breaking changes, 0 migrations novas.**

---

## 🧪 Validação

```
▶ Backend JS:        154 arquivos válidos
▶ Extension JS:      140 arquivos válidos
▶ Migrations SQL:    7 arquivos
▶ Testes formais:    15/15 passing (autopilot-maturity)
```

---

## 🎯 Nota honesta

**8.6/10** (sobe de 8.5).

- (+0.1) 3 bugs corrigidos (1 alto, 2 defesa em profundidade) + auditoria honesta de 8 itens

Pra **8.7+:** completar Etapas 5-6 (estimo 10-15 bugs)
Pra **9.0+:** rodar local + 30 dias com 10+ clientes pagantes sem novos bugs

---

**Versão:** 9.3.5
**Codename:** "Audited (Tenant-Safe)"
**Próxima:** Etapa 5 — Error paths
