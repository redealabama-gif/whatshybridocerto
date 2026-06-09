# Registro de Verificação — Vórtex Pro

Histórico de verificações **manuais** feitas pelo dono do projeto em ambiente
**local real** (backend + extensão no Chrome + WhatsApp Web) — não só CI. Cada
entrada é um "carimbo" de que aquilo foi conferido funcionando de verdade.

---

## 2026-06-09 — ✅ Sugestão de resposta (botão 🤖): **PERFEITA**

A **sugestão de resposta de IA** (botão 🤖 no WhatsApp Web) foi verificada
**funcionando perfeitamente**: passa pela **inteligência avançada** (orquestrador
do backend) e devolve respostas **coerentes com a conversa** — não mais a frase
genérica/“cega ao conteúdo”.

Ambiente no momento da verificação:
- Backend `9.5.8` no ar em `localhost:3000` (`/health` → `{"status":"ok"}`).
- Migrations aplicadas, incluindo a `021_response_outcomes_pending` (Onda 3).
- CORS liberando a extensão (`chrome-extension://…`).
- Signup/auth emitindo tokens (workspace `pro`, 500k tokens).
- Extensão buildada com bundles novos (134 fontes).

Correções de IA relacionadas (já mergeadas): #281, #282, #283, #285, #286.

---

## 2026-06-09 — 🔍 Auditoria de prontidão para produção (repositório inteiro)

Auditoria executada com o **backend real rodando** (deps instaladas, 21 migrations
em banco zerado, servidor 9.5.8 no ar) e fluxos exercitados **ao vivo** via API:

- ✅ Signup → workspace pro + trial 7d + 500k tokens + JWT (201).
- ✅ Painel "Tokens e uso": consumo real registrado e lido de volta
  (consumido 2.000 / 2 requests / média 1.000 / gráfico by_day). Débito
  idempotente por `ai_request_id` (duplicata não cobra 2×). Os zeros que o
  dono via eram estado legítimo: só debita quando o LLM responde com sucesso.
- ✅ Assinatura: status, histórico de faturas, mudança de plano (pro↔starter)
  executada ao vivo; recorrência (preapproval MP) e dunning presentes.
- ✅ Chave de ativação: 1ª ativação vincula dispositivo, revalidação na mesma
  máquina libera, outro dispositivo recebe 423; persistida em
  `chrome.storage.local` (sobrevive fechar/abrir WhatsApp e navegador).
- ✅ Treinamento → resposta: FAQ sincronizada via `/training/sync` voltou
  como resposta ancorada no `/api/v2/ai/process` (sem provider LLM!), com
  guard de autopilot (`allowAutoSend`, `riskTier`) no payload.
- ✅ Autopilot: cadeia completa conectada (wpp-hooks → postMessage →
  EventBus `message:received` → fila → tier0). Bundles dist em sincronia
  (134 fontes), lógica das Ondas 1–3 compilada.
- ✅ Webhook MP: valor validado contra preço do plano, idempotência por
  `provider_ref`, tokens do plano concedidos, pacote avulso creditado sem
  duplicar, estorno/chargeback revoga acesso e zera tokens.
- ✅ Suítes: extensão 38/38 + 12/12; backend zero-dep 11/11.

Achados corrigidos no PR desta auditoria:
1. 🔴 "Equipe" vendida no Starter mas gateada em enterprise → liberada
   starter/pro (papéis granulares seguem enterprise).
2. 🟠 Redis configurado porém fora do ar congelava a API inteira (provado:
   `/health` pendurava) → store resiliente com timeout + `passOnStoreError`
   (fail-open). Re-testado: `/health` responde com Redis caído.
3. 🟠 SENDGRID ausente em produção era warn silencioso → error + alerta
   crítico no boot; email de boas-vindas agora explica a conexão por login.
4. 🟡 Escalação do autopilot (`autopilot:suggestion-only`) não tinha
   listener → notificação visual ao operador.
5. 🟡 Chave de ativação só chegava por email → agora visível no dashboard
   (aba Assinatura, owner/admin) com botão copiar. Provado ao vivo.
6. 🟡 Limites alinhados à landing: Free 50 contatos (era 100 no server),
   Pro contatos ilimitados na extensão (era 10k), disparo em massa
   Starter 500/dia e Pro 2.000/dia (era ilimitado em ambos).

Pendências de configuração para o dia do deploy (não são código):
`SENDGRID_API_KEY`, `MERCADOPAGO_ACCESS_TOKEN` + `MERCADOPAGO_WEBHOOK_SECRET`,
`PUBLIC_BASE_URL`, chaves LLM, Redis no ar (ou `REDIS_DISABLED=true`),
link real da Chrome Web Store no botão "Instalar extensão" do dashboard.
