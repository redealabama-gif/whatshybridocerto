# Compliance LGPD — Vórtex Pro

> Lei Geral de Proteção de Dados (Lei 13.709/2018). Este documento mapeia como o
> produto cumpre os direitos do titular, qual a base de retenção e quais são os
> subprocessadores. É evidência viva: cada item aponta para código/teste que o
> prova.

Última revisão: 2026-06-03 · Responsável: equipe Vórtex.

---

## 1. Direitos do titular (art. 18) — implementação

| Direito                     | Como exercer                              | Implementação                              | Prova (teste)                                            |
| --------------------------- | ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| Acesso / Portabilidade      | `GET /api/v1/me/export`                    | `src/routes/me.js` → JSON estruturado      | `tests/integration/lgpd-me.routes.spec.js`              |
| Exclusão (esquecimento)     | `POST /api/v1/me/delete-account`          | `src/routes/me.js` → anonimização + log    | `tests/integration/lgpd-me.routes.spec.js`              |
| Correção                    | endpoints `PUT` de cada recurso           | rotas REST existentes                       | —                                                       |
| Confirmação de tratamento   | export + este documento                   | —                                          | —                                                       |

**Export**: devolve usuário, workspace, contatos, conversas, deals, campanhas,
tarefas, faturas, transações de token, indicações e respostas de NPS — escopado
ao `workspace_id` do titular e **sem segredos** (`password`/`totp_secret`
removidos). Provado que NÃO vaza dados de outro tenant.

**Exclusão**: exige confirmação explícita (`{"confirmation":"EXCLUIR_MINHA_CONTA"}`),
anonimiza o usuário (email→`deleted_*`, nome, `status='deleted'`, TOTP nulo),
cancela o workspace, anonimiza PII de contatos (nome→`anônimo`, telefone→``),
revoga refresh tokens e grava `data_deletion_log` como `completed`. A anonimização
(em vez de DELETE físico) preserva integridade referencial e os registros que a
lei obriga manter (ver §3).

---

## 2. Isolamento e segurança

- **Multi-tenant**: todo dado é escopado por `workspace_id`; cobertura por
  `tests/integration/tenant-isolation.routes.spec.js` (acesso cruzado negado em
  leitura, escrita e sub-recursos; injeção de `workspace_id` ignorada).
- **Autenticação**: JWT HS256 + verificação de `status` do usuário; segredos
  obrigatórios e validados (`config/index.js`).
- **Segurança de API**: rate limit, helmet, CSRF, assinatura de webhook.
- **Pipeline de segurança**: gate bloqueante de dependências
  (`scripts/audit-gate.js`), SAST (CodeQL), secret scanning (gitleaks), Trivy e
  dependency review — ver `.github/workflows/{ci,security}.yml`.
- **DR**: backup com restore drill executável (`scripts/dr-restore-drill.js`,
  workflow `dr.yml`).

---

## 3. Retenção e minimização (art. 15–16)

Política aplicada por `scripts/lgpd-retention-purge.js` (dry-run por padrão;
`--apply` executa). Provado por `tests/integration/lgpd-retention-purge.spec.js`.

| Dado                              | Retenção             | Base                                   |
| --------------------------------- | -------------------- | -------------------------------------- |
| Faturas (`billing_invoices`)      | 5 anos               | obrigação fiscal (Receita Federal)     |
| Log de exclusão (`data_deletion_log`) | 12 meses         | prova de cumprimento de direito        |
| Webhooks processados (`webhook_inbox`) | 90 dias          | operacional (idempotência já garantida)|
| Refresh tokens expirados          | imediato             | segurança / minimização                |
| PII de conta excluída             | anonimizada na hora  | art. 18, IV                            |

Janelas configuráveis: `RETENTION_WEBHOOK_DAYS` (90), `RETENTION_AUDIT_DAYS`
(365). A purga **nunca** apaga `billing_invoices`.

Operação recomendada: cron diário no servidor →
`npm run lgpd:purge:apply` (workspace `whatshybrid-backend`).

---

## 4. Registro de subprocessadores (operadores)

Dados podem ser compartilhados com os operadores abaixo, estritamente para
executar o serviço. Todos via HTTPS.

| Subprocessador        | Finalidade                         | Dados transmitidos                          | Acionado por (env)            |
| --------------------- | ---------------------------------- | ------------------------------------------- | ----------------------------- |
| MercadoPago           | pagamentos (BR)                    | id de workspace, plano, valor               | `MP_*`                        |
| Stripe                | pagamentos (internacional)         | id de workspace, plano, valor, email        | `STRIPE_*`                    |
| OpenAI                | geração de respostas (IA)          | conteúdo de conversa enviado à IA           | `OPENAI_API_KEY`              |
| Anthropic             | geração de respostas (IA)          | conteúdo de conversa enviado à IA           | `ANTHROPIC_API_KEY`           |
| Groq                  | geração de respostas (IA)          | conteúdo de conversa enviado à IA           | `GROQ_API_KEY`                |
| SendGrid              | email transacional                 | email, nome, conteúdo do email              | `SENDGRID_API_KEY`            |
| Meta (CAPI)           | mensuração de conversão            | evento de compra (hasheado), valor          | `META_*`                      |
| Google Analytics (MP) | mensuração de conversão            | evento de compra, valor                     | `GA4_*`                       |
| Google OAuth          | login social                       | email, sub do Google                        | `GOOGLE_CLIENT_*`             |

Cada integração só é ativada quando a respectiva chave está configurada; sem
chave, o serviço roda em modo dry-run (não transmite dados).

---

## 5. Como exercer / DPO

- Titular autenticado: use os endpoints do §1.
- Solicitação manual / DPO: encaminhar ao canal de privacidade da empresa, que
  executa export/exclusão pelos mesmos endpoints administrativos.
- Incidentes: seguir o `RUNBOOK.md` (seção de incidentes) e notificar a ANPD e
  titulares quando aplicável (art. 48).
