# WhatsHybrid Pro — v9.5.6 (SaaS Multi-Device Parity)

**Data:** 2026-05-09
**Tipo:** Correção crítica de premissa SaaS (não-breaking)
**Filosofia:** "Se o cliente fez login, os dados dele estão lá. Ponto."

---

## O problema corrigido

Auditoria sistemática descobriu que **7 storage keys com dados do cliente
ficavam apenas em `chrome.storage.local`** — quando o cliente trocava de
máquina, esses dados sumiam silenciosamente. Pior: parte dos dados (CRM,
KB, exemplos) sincronizava normalmente, dando a falsa impressão de que tudo
voltava.

A premissa do SaaS é: cliente loga em qualquer máquina → continua de onde
parou. Isso agora vale para 100% dos dados que devem persistir.

---

## ALTERADO — `data-sync-manager.js`

### 7 módulos novos no `SYNC_MODULES`

Antes: 9 módulos sincronizavam (CRM, tasks, labels, recover_history,
ai_training_examples, ai_memory, knowledge, quick_replies, settings).

Agora: **+7 módulos críticos** que estavam ausentes:

| Storage | Módulo sync | Endpoint | Antes |
|---------|-------------|----------|-------|
| `whl_campaigns` | `campaigns` | `/api/v1/sync/campaigns` | 🔴 perdia campanhas inteiras |
| `whl_campaign_alarms` | `campaign_alarms` | `/api/v1/sync/campaign_alarms` | 🔴 agendamentos sumiam |
| `whl_conversation_memory` | `conversation_memory` | `/api/v1/sync/conversation_memory` | 🔴 contexto por chat se perdia |
| `whl_conversation_memory_stats` | `conversation_memory_stats` | `/api/v1/sync/conversation_memory_stats` | 🟠 estatísticas zerava |
| `whl_training_stats` | `training_stats` | `/api/v1/sync/training_stats` | 🟠 contadores ✓/✗/✏️ zerava |
| `whl_ai_memory_advanced` | `ai_memory_advanced` | `/api/v1/sync/ai_memory_advanced` | 🟠 perfil por contato sumia |
| `whl_smart_templates` | `smart_templates` | `/api/v1/sync/smart_templates` | 🟡 templates aprendidos sumiam |

Todos passam pelo handler genérico `POST /api/v1/sync/:module` (já existia
no backend) que salva em `sync_data`. Restauração via
`GET /api/v1/sync/:module/download` no `restoreFromBackend()`.

### `waitForRestored(timeoutMs)` — gate de prontidão

Novo helper público em `window.DataSyncManager.waitForRestored()` para
módulos que **não devem operar com dados parciais**. Retorna Promise que
resolve quando `dataSync:restored` foi emitido (ou rejeita após timeout).

Uso:
```js
await window.DataSyncManager.waitForRestored();
// agora é seguro ler whl_campaigns, whl_training_stats, etc.
```

Útil para: dashboard de campanhas, métricas de qualidade no UI, listagens
que mostram contagens — tudo que parece "vazio" quando lido antes do
restore concluir.

### Novo evento `dataSync:restored`

`init()` agora emite **dois** eventos no EventBus:
- `dataSync:ready` (compat — já existia)
- `dataSync:restored` (novo — específico para "dados do servidor já
  mesclados com local")

---

## ALTERADO — `ai-memory-advanced.js`

### Fix do bug silencioso `BackendClient.syncClientProfiles`

Linha 700-702 chamava `window.BackendClient.syncClientProfiles(batch)`
desde a v9.4.x, mas esse método **nunca existiu** no `BackendClient`.
O optional chaining (`?.`) silenciosamente fazia no-op — perfis ficavam
acumulando na fila `pendingSync` e nunca iam pro backend.

Agora redireciona para `DataSyncManager.syncModule('ai_memory_advanced')`
que de fato grava no backend via o endpoint genérico. Fallback legado
mantido caso alguém implemente o endpoint dedicado no futuro.

---

## NÃO FOI ALTERADO

- 9 módulos que já sincronizavam continuam idênticos
- Backend `/api/v1/sync/:module` handler genérico já aceitava qualquer nome
  de módulo — não precisou mudança
- `data-sync-manager.js` boot order já fazia `await restoreFromBackend()`
  antes de `state.initialized = true` — race condition do agente era
  sobre EventBus de outros módulos, agora coberto pelo `waitForRestored()`
- Schemas backend (`sync_data` table) já existiam

---

## Storage keys que CORRETAMENTE permanecem locais

Não devem sincronizar — runtime / preferências da máquina:
- `whl_onboarding_completed`, `whl_telemetry_consent` (prefs do usuário no device)
- `whl_realtime_dashboard_enabled`, `whl_chaos_engineering` (flags de debug)
- `whl_smart_cache`, `whl_request_batcher_cache` (caches efêmeros, perdíveis)
- `whl_access_token`, `whl_user`, `whl_credits` (auth/billing — backend é fonte de verdade)
- `whl_state`, `whl_active_view`, `whl_modules` (UI runtime)

---

## Validação

- ✅ `node --check` em `data-sync-manager.js` + `ai-memory-advanced.js`
- ✅ Build limpo (3 bundles)
- ✅ JSON manifests válidos
- ✅ **114 testes de backend passando, 0 falhas**
- ⚠️ Validação cross-device em browser real: não executada (ambiente headless)

---

## Métricas

| Bundle | v9.5.5 | v9.5.6 | Δ |
|--------|-------:|-------:|---:|
| `content-bundle.js` | 1355.7 KB | 1365.3 KB | +9 KB |
| `advanced-bundle.js` | 375.4 KB | 377.4 KB | +2 KB |
| **Total** | 1.831 KB | 1.842 KB | +11 KB |

11KB pelo aumento do `SYNC_MODULES` registry + helper `waitForRestored` +
fix do `ai-memory-advanced.syncWithBackend`.

---

## Compatibilidade & Migração

- **Não-breaking**: clientes existentes continuam funcionando. Os 7
  storage keys passam a sincronizar automaticamente — primeiro
  `setupStorageListener` push envia o estado atual, próximas mudanças
  sincronizam debounced.
- **Primeira execução pós-update**: nada acontece imediatamente. Quando o
  usuário fizer qualquer alteração nas chaves novas (criar campanha,
  reiniciar treinamento, etc.), o sync acontece automaticamente.
- **Nenhuma migration backend nova**: tabela `sync_data` já existia e
  aceita qualquer nome de módulo.
- **Cross-device**: a partir desta versão, fazer login em outro PC
  recupera CAMPANHAS, MEMÓRIA DE CONVERSA, PERFIS DE CONTATO e
  TEMPLATES INTELIGENTES junto com tudo que já voltava.

---

## O que recomendo testar manualmente após instalar

1. **PC1**: criar campanha de teste com 5 contatos, fazer 3 treinamentos
   na simulação, deixar o `ai-memory-advanced` aprender perfil de algum
   contato (mandar 5+ mensagens com aquele contato).
2. **PC2** (ou modo anônimo): instalar a extensão, fazer login com a mesma
   conta. Esperar ~5 segundos pelo `restoreFromBackend()`. Abrir o sidepanel.
3. **Verificar**: campanha aparece, contadores de treino estão corretos,
   ao abrir o chat com o contato a IA usa o perfil aprendido.
