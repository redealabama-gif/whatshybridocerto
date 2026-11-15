# Segurança (Fase 6)

| Item | Como foi verificado | Resultado |
|---|---|---|
| **Segredos no repositório** | `git grep` por padrões reais de chave (`sk-`, `gsk_`, `AKIA`, `SG.`, `APP_USR-`, `xox*-`), `.env` versionado, senha/segredo literal em `src/` e `config/` | ✅ nada encontrado: só `.env.example`; todo segredo vem de `process.env` |
| **Placeholders recusados em produção** | `config-placeholder-secrets.spec.js` + boot em modo produção | ✅ o servidor se recusa a subir com segredo de exemplo |
| **Rotas de administração** | chamada direta sem credencial a `/admin/stats`, `/admin/sql`, `/admin/killswitch`, `/admin/killswitch/ai`, `manual-confirm` | ✅ **401** em todas (as inexistentes dão 404) |
| **Kill switch** | `kill-switch.routes.spec.js`, `deploy-killswitch-key.spec.js` | ✅ protegido por chave; compose repassa |
| **CORS** | `site-same-origin-cors.spec.js` (servidor real em modo produção) | ✅ próprio site passa; origem de fora → 403 `CORS_ORIGIN_NOT_ALLOWED`, sem liberar cabeçalho |
| **CSP** | varredura das 10 páginas no navegador | ✅ sem violação; Google Sign-In liberado só no necessário (PROD-06) |
| **Limite de tentativas de login** | `login-limit-per-client.spec.js` com servidor real atrás de proxy | ✅ por cliente (PROD-05), não global |
| **Isolamento entre clientes** | `tenant-isolation.routes.spec.js`, `ai-tenant-isolation.routes.spec.js`, `learning-pipeline-tenant.spec.js` | ✅ um cliente não lê dado de outro |
| **Senha** | bcrypt; `auth-service.test.js`; redefinição com token de uso único e validade de 1 h (F3) | ✅ |
| **2FA** | ativar/entrar/desativar com TOTP real; desativar exige **senha + código** (F3) | ✅ |
| **XSS** | conta com `<img onerror>` e `<script>` no nome e na empresa → painel e login no navegador (`seguranca-xss.js`) | ✅ 4/4: nada executa, payload fica como texto, nenhum elemento injetado |
| **Dependências (produção)** | `npm audit --omit=dev` no backend e na extensão | ✅ extensão 0; backend: `qs` corrigido via `overrides` → 6.17.1 (SEG-01) |

## Risco aceito e documentado

- **uuid < 11.1.1 (3 avisos moderados)**: só nas cópias **aninhadas** de
  `node-cron@3` e `gaxios`. O aviso é sobre `uuid.v3/v5/v6` quando se passa um
  buffer; essas dependências usam `v4`. O `uuid` direto do projeto já está em
  11.1.1. Subir para `node-cron@4` é mudança que quebra → **P2 pós-lançamento**.

## Pendências (🔒 dono / go-live)

- Segredos fortes e distintos no `.env` de produção (JWT, WEBHOOK, ADMIN).
- `SUBSCRIPTION_MASTER_KEY` vazio e **chave-mestra removida da extensão**.
- HTTPS/HSTS pelo Caddy (já configurado) com domínio real.
