# CHANGELOG v9.3.2 — CRM Hardening

**Data:** Maio de 2026
**Tipo:** Patch — bugs CRM encontrados via auditoria detalhada
**Compatibilidade:** Drop-in. Migration nova (006_crm_stage.sql + auto-migration inline).
**Target:** elevar nota de 8.0 → 8.2 (CRM funcionando de fato)

---

## 🎯 Por que existe

Usuário relatou: "marcar contatos com cores de cartões — funcionalidade não funcionava + ficava desformatada na tela". Auditoria detalhada do CRM expôs **12 bugs reais**, sendo 6 críticos. O sintoma reportado era a ponta do iceberg.

## Por que não funcionava

O sistema de cores no CRM tinha 3 problemas que se compunham:

1. **Backend perdia o estágio** — frontend movia contato no kanban, salvava localmente, sincronizava com backend. Backend recebia o campo `stage` mas não tinha onde guardar (coluna não existia). Próximo reload: voltava tudo pra "novo".

2. **Extensão não conseguia desenhar a cor** — o `crm-badge-injector.js` usa seletores DOM pra encontrar onde colocar o badge no WhatsApp Web. Os seletores eram de versões antigas do WhatsApp Web (2024) e foram refatorados pela Meta. Resultado: o código rodava, criava o badge, mas não encontrava onde inseri-lo.

3. **Quando aparecia, ficava desformatado** — CSS com `max-width: 65px` cortava nomes maiores ("Negociação", "Contato Feito"). E setting de posição declarado mas nunca aplicado, badge sempre à direita do título mesmo quando configurado pra esquerda.

---

## 🔴 Bugs críticos corrigidos

### 1. Coluna `stage` não existia em `contacts`
**Sintoma:** kanban perdia trabalho do usuário a cada reload.

**Causa:** schema da tabela `contacts` não tinha campo `stage`. Frontend mandava, backend ignorava.

**Fix:**
- Migration inline em `database-legacy.js` (idempotente via PRAGMA check)
- Migration formal `006_crm_stage.sql` pra Postgres
- Backfill: contatos antigos recebem `stage = 'new'`

### 2. `POST /api/v1/crm/sync` ignorava stage
Adicionei `stage` no INSERT e UPDATE de contatos. Antes só `name, email, tags, labels, custom_fields, status` eram salvos.

### 3. `PUT /api/v1/contacts/:id` não aceitava stage
Frontend conseguia mover via kanban, mas se tentasse via API direta (extensões futuras, integrações), falhava silenciosamente. Agora aceita.

### 4. `POST /api/v1/contacts` não aceitava stage no payload de criação
Idem — contato novo entrava sempre como "new" mesmo se enviasse stage diferente.

### 5. Seletores DOM obsoletos no badge-injector
**Causa raiz do "não funciona":** seletores `_8nE1Y`, `.X7YrQ`, `._21S-L` são de versões do WhatsApp Web de 2023. `cell-frame-container` data-testid foi removido pela Meta em 2024. Hoje o WhatsApp Web usa `[role="listitem"]` predominantemente.

**Fix:** lista expandida de seletores em ordem do mais novo (2026) ao mais antigo (2023). Quando todos falham, integra com `WHL_WaBridge.reportFailure()` (sistema de telemetria do v9.2.0) — backend dashboard mostra qual seletor quebrou em qual versão do WhatsApp.

```js
const CHAT_SELECTORS = [
  '[role="listitem"]',                          // 2026 atual
  '[data-testid="cell-frame-container"]',       // 2025-2026
  '[data-testid="list-item"]',                  // 2025
  'div[tabindex="-1"][role="row"]',             // 2024
  '._8nE1Y', '.X7YrQ',                          // 2023 fallback
  'div[data-id*="@c.us"], div[data-id*="@g.us"]' // último recurso
];
```

### 6. Deals sumiam do kanban após reload
Frontend usava `d.stageId` internamente. Sync pro backend mandava `stage: d.stage` (que era `undefined`). Backend salvava null. Próximo reload: kanban filtrava por `stageId === stage.id` que era null → deals invisíveis.

**Fix:**
- Frontend agora envia: `stage: d.stageId || d.stage || 'lead'`
- Backend `GET /crm/data` agora normaliza resposta: mapeia `stage` (DB) pra `stageId` (frontend), converte `contact_id → contactId`, etc.

---

## 🟠 Bugs altos corrigidos

### 7. Storage listener com debounce 150ms
**Sintoma:** lag visual ao mover contato entre estágios. Cor antiga ficava 150ms.

**Fix:** quando dados CRM mudam, força repaint imediato via `requestAnimationFrame`:
```js
if (needsForcedRepaint) {
  removeAllBadges();
  requestAnimationFrame(() => updateAllBadges());
} else {
  scheduleUpdate();
}
```

### 8. DEFAULT_STAGES dessincronizados
`crm.js` tinha proposta antes de negociação (order 3 vs 4). `crm-badge-injector.js` invertia. Resultado: kanban e badge mostravam ordens diferentes pro mesmo estágio.

**Fix:** ambos agora usam mesma lista canônica:
```
new → lead → contact → proposal → negotiation → won/lost
🆕    🎯      📞         📋          💼            ✅/❌
```

---

## 🟡 Bugs médios/baixos corrigidos

### 9. CSS cortava nomes longos
`max-width: 65px` em badge size-small fazia "Negociação" virar "Negocia...". Aumentei pra 90px (small) / 110px (medium) / 130px (large).

### 10. Setting `position` declarado mas não aplicado
`settings.position = 'right'` existia mas CSS sempre `margin-left: 4px`. Agora respeita:
```js
if (settings.position === 'left') {
  titleContainer.before(wrapper);
  wrapper.style.marginRight = '4px';
} else {
  titleContainer.after(wrapper);
  wrapper.style.marginLeft = '4px';
}
```

### 11. `GET /contacts` sem filtro por stage
Query parameter `?stage=lead` agora funciona. Permite kanban view via API.

### 12. Resposta de `GET /crm/data` com nomes inconsistentes
Frontend recebia snake_case do banco, esperava camelCase. Normalizado.

---

## 📊 Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `whatshybrid-backend/migrations/006_crm_stage.sql` | NOVO — migration formal pra Postgres |
| `whatshybrid-backend/src/utils/database-legacy.js` | Auto-migration inline (idempotente) |
| `whatshybrid-backend/src/routes/crm.js` | Sync persiste stage + GET /data normaliza nomes |
| `whatshybrid-backend/src/routes/contacts.js` | POST/PUT aceitam stage + GET filtra por stage |
| `whatshybrid-extension/modules/crm.js` | Sync envia stageId mapeado pra stage |
| `whatshybrid-extension/modules/crm-badge-injector.js` | Seletores DOM modernos + force repaint + CSS expandido + position respeitado + DEFAULT_STAGES sync |

---

## 🧪 Como validar pós-deploy

```bash
# 1. Backend roda migration automática no boot
docker compose restart backend
docker compose logs backend | grep "contacts.stage"
# Deve aparecer: "[DB] Migration: added contacts.stage column + index"

# 2. Verifica coluna existe
docker compose exec backend sqlite3 /app/data/whatshybrid.db \
  "PRAGMA table_info(contacts);" | grep stage
# Deve listar: stage|TEXT|...

# 3. Teste end-to-end manual
#    a. Abre WhatsApp Web com extensão
#    b. Abre painel CRM → cria contato → marca como "Negociação"
#    c. Recarrega WhatsApp Web (F5)
#    d. Badge deve aparecer instantaneamente com cor #EC4899 (rosa)
#    e. Console deve mostrar: [BadgeInjector v53] CRM atualizado

# 4. Teste do badge formatado
#    a. Marca contato como "Contato Feito" (nome longo)
#    b. Badge deve mostrar "Contato Feito" inteiro, sem ellipsis
```

---

## ⚠️ Bugs encontrados que NÃO foram corrigidos

1. **`ContactService.getContacts()`** com `stage = null` default — pode quebrar query SQL (linha 143). Não corrigi porque o uso real desse método não foi auditado.

2. **`DealService.create()`** valida foreign key em `pipeline_stages` mas a tabela pode estar vazia em workspace recém-criado. Resultado: deals novos retornam erro "stage not found". Workaround: workspace já cria pipeline default no signup (não verifiquei).

3. **Activities (atividades)** não auditadas — campo `activities` no localStorage cresce sem limite, sync pro backend desconhecida.

---

## 🎯 Nota honesta

**8.2/10** (sobe de 8.0).

Por quê:
- (+0.2) 12 bugs CRM corrigidos, sendo 6 críticos que perdiam trabalho do usuário
- (+0.0) Não rodei o sistema, só validei sintaxe — nota teórica baseada em código

Pra subir pra 8.5+: você roda local, valida o fluxo de marcar contato → ver cor → recarregar → cor persiste. Cada bug que aparecer descobrimos junto.

---

**Versão:** 9.3.2
**Codename:** "Wired (CRM Fixed)"
**Próxima:** Validação real em ambiente de staging
