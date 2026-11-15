# Plano para produção — Vórtex Pro

Objetivo: lançar sem nada quebrado na frente do cliente. O plano cobre o projeto
inteiro (site, conta, cobrança, licença, **cada tela da extensão**, IA, tokens,
painel, e-mails, servidor, segurança, LGPD e Chrome Web Store), não só os pontos
levantados pelo dono.

## Como este plano funciona

- **Prova, não opinião.** Cada item fechado tem arquivo:linha, teste ou print.
  O que não deu para executar aqui fica marcado **NÃO VERIFICADO**, com o motivo.
- **Funciona ou sai.** Botão, campo ou número na tela que não funciona é
  corrigido ou removido. Nada fica "parecendo que funciona".
- **Teste que falha antes e passa depois**, um commit por problema, evidências em
  `audit/evidencias/producao/`.
- **Varredura por clique.** Uma tela só conta como verificada quando **cada**
  botão, campo, aba e número dela foi usado no navegador. A busca do Treinamento
  passou despercebida porque a tela foi verificada pela função (treinar e
  responder), não controle por controle. Essa é a regra daqui em diante.

Legenda: ✅ corrigido e testado · ✔️ verificado, sem defeito · 🔧 em correção ·
🔍 a verificar · 🔒 depende do dono (conta, chave, DNS, decisão) ·
⚠️ NÃO VERIFICADO aqui (motivo ao lado)

Prioridade: **P0** impede lançar · **P1** corrigir antes de escalar vendas ·
**P2** melhoria.

---

## Fase 0 — Bloqueios encontrados até agora (P0)

| # | Problema | Status | Prova |
|---|---|---|---|
| PROD-01 | Cadastro ("Começar trial grátis") e "Entrar" do site davam 500 "Erro: error" quando o site era aberto por um endereço fora de `CORS_ORIGIN` (www., outro domínio) | ✅ | `tests/integration/site-same-origin-cors.spec.js`; `cors-antes/depois.txt` |
| PROD-02 | Senha errada recarregava a página sem mensagem | ✅ | `site-1…site-2*.txt` |
| PROD-03 | Ícones vinham de `unpkg.com/lucide@latest`: com a CDN fora do ar o login quebrava e a **senha ia para a URL**; a versão nova da CDN tirou o ícone `chrome` | ✅ | `site-2…site-3*.txt` |
| PROD-04 | Confirmação do cadastro mostrava "Cupom aplicado −50%", "1º mês R$ 24,95" e "2º mês R$ 49,90" para **todo mundo** (sem cupom, inclusive no Pro) | ✅ | `site-3…site-4*.txt` |
| — | Cursor "bolinha" no cadastro, login e painel | ✅ | `site-5-cursor.txt` |
| TRN-01 | Busca do Treinamento não funcionava (aba Simulação, acento, troca de aba) | ✅ | `treino-*.txt` |
| TRN-02 | Botão "Sincronizar respostas aprovadas" nunca habilitava (parecia ativo) e era redundante: removido, aprovar já salva | ✅ | `treino-0-antes.txt` (INFO) → `treino-2*.txt` |
| TRN-03 | **Aprovar resposta na Simulação apagava os exemplos do navegador** (de onde o Autopilot lê) | ✅ | `treino-0-antes.txt` ("perdidos") → `treino-1*.txt` |
| TRN-05 | Treinamento abria sempre "Offline" com a conta conectada | ✅ | `treino-3b…treino-4*.txt` |
| TRN-06 | "Precisão 80%" sem dado nenhum: era a nota média dos exemplos | ✅ | `treino-3b…treino-4*.txt` |
| PROD-05 | Atrás do Caddy **todos os clientes tinham o mesmo IP**: 5 senhas erradas de quaisquer clientes em 15 min bloqueavam o login de **todos**. O Caddy mandava "IP:porta" (`{remote}`) | ✅ | `tests/integration/login-limit-per-client.spec.js`; `limite-login-antes/depois.txt` |
| TRN-04 | Com o WhatsApp aberto, gravações do aprendizado nele **apagavam exemplos criados no Treinamento** (e salvar no Treinamento apagava os do WhatsApp) | ✅ | `audit/harness/exemplos-entre-abas.js`; `abas-0-antes.txt` → `abas-1-depois.txt` |
| PROD-06 | "Entrar com Google" nunca aparecia: a CSP bloqueava `accounts.google.com/gsi/client` | ✅ | `site-6…site-7*.txt` (login com conta Google real: ⚠️ precisa do Client ID do dono) |
| PROD-07 | Ícone do site: `favicon.svg` e `apple-touch-icon` davam 404; 9 páginas sem ícone | ✅ | `site-8-prod07-icone.txt` |
| PLN-01 | Pacote avulso de tokens ("não expiram", diz o site) **sumia na renovação mensal** | ✅ | `tokens-pacote-antes/depois.txt`; `migrations/023` |
| PLN-02 | Site vendia plano "Anual -20%" que **não existe** na cobrança | ✅ | `pln02-antes.txt` → `site-9-pln02-anual.txt` |

---

## Fase 1 — Extensão: varredura de todas as telas (P0)

**Feita em duas passadas** (extensão real no Chromium + WhatsApp simulado +
backend de teste):

1. **Abertura** (`audit/harness/extensao-varredura.js`): as 14 telas do painel
   lateral, o popup e a página de CRM abrem SEM erro de script, sem pedido
   falho e com controles visíveis. Antes 14/17, depois **17/17**
   (`varredura-0-antes.txt` → `varredura-1-depois.txt`).
2. **Interações-chave** (`audit/harness/extensao-interacoes.js`): disparo gera
   a fila com os números digitados; extrator responde; "ocultar online" chega
   ao WhatsApp; config salva; exportar do backup responde; CRM salva contato
   novo; tarefa criada aparece na lista; resposta rápida salva; Autopilot
   mostra estado real; tela do servidor e popup renderizam. Antes 10/12,
   depois **12/12** (`interacoes-0-antes.txt` → `interacoes-1-depois.txt`).

Defeitos reais encontrados e corrigidos:

| # | Problema | Status |
|---|---|---|
| VAR-01 | Privacidade (ocultar online/digitando) e botões do SAPL rodavam na ABA ATIVA, não na do WhatsApp → falhavam em silêncio com outra aba em foco | ✅ |
| VAR-02 | Toda abertura do painel logava 3 erros de arquivo inexistente (scripts de teste no sidepanel.html; socket.io no manifest/backend-client) | ✅ |
| VAR-03 | **Todo comando do painel** (gerar tabela, extrair, exportar, iniciar) exigia a aba do WhatsApp EM FOCO — senão "Abra o WhatsApp Web" mesmo com ele aberto | ✅ |

O que fica para o roteiro com WhatsApp REAL (⚠️ `audit/ROTEIRO_TESTE_WHATSAPP_REAL.md`):
envio de disparo de verdade, extração de grupos com modal real, exportar
conversa com chat aberto, barra do topo e sugestão 🤖 em conversas reais (já
cobertas com IA real nas fases V1–V3), equipe com 2 contas.

## Fase 2 — Site (P0)

| Item | O que verificar | Status |
|---|---|---|
| Cadastro → painel; login; senha errada; resumo de preço; cursor; ícones; Google; anual | `audit/harness/site-producao.js` (12/12) | ✅ |
| Links internos das 10 páginas | nenhum 404 (`site-paginas.js`) | ✅ |
| Termos, privacidade e ajuda | conteúdo real; os 9 guias da ajuda abrem; guia de tokens corrigido (dizia ~750/interação; real ~1.800) | ✅ |
| Esqueci/redefinir senha (telas) | envio confirmado; token inválido → "Link inválido ou expirado" | ✅ (ponta a ponta com o link do e-mail: Fase 3) |
| Celular 390px | sem rolagem horizontal; cadastro completo no celular chega ao painel | ✅ |
| Erros de console | nenhum, fora CDNs bloqueadas AQUI (swagger via jsdelivr; sonda local do globo `cobe.js` documentada — o Docker baixa no build) | ✅ |
| Documentação da API (swagger via CDN) | ⚠️ NÃO VERIFICADO aqui (CDN bloqueada); fixar versão do swagger-ui é P2 | ⚠️ |

Evidências: `site-9-pln02-anual.txt`, `site-paginas.txt`, prints em scratch.

## Fase 3 — Conta e acesso (P0)

`tests/integration/conta-fluxos.spec.js` (9/9, banco e rotas reais; suíte do
backend 49 suítes / 256 testes verdes — a mensagem do commit 59b3843 escreveu
"265" por engano, o número certo é 256):

| Item | Status |
|---|---|
| Cadastro cria conta, workspace e trial de 7 dias exatos | ✅ |
| E-mail de boas-vindas monta (dry-run; envio real = SendGrid 🔒) | ✅ |
| Recuperar senha ponta a ponta: token com hash, troca, antiga inválida, uso único, expirado recusado, e-mail inexistente não é revelado | ✅ |
| 2FA: ativar com TOTP real, login em 2 passos (sem sessão antes do código), desativar exige senha + código | ✅ |
| Sessão única da extensão (LIC-02) | ✅ (PR #316) |
| Limite de tentativas por cliente (PROD-05) | ✅ |
| Excluir conta (LGPD) | ✅ rotas e rotina de purga têm testes (`lgpd-me`, `lgpd-retention-purge`); tela da ajuda explica |

## Fase 4 — Planos: o que o site promete × o que é liberado (P0, pedido do dono)

Comparação item a item fechada em
`audit/evidencias/producao/planos-comparacao.md`: preços, tokens (50k/500k),
pacotes avulsos (R$ 19, e "não expiram" — PLN-01), CRM 50/1.000/ilimitado,
tarefas 50/200/ilimitado, disparo 5/500/2.000 por dia, Autopilot e Treinamento
a partir do Starter, EXIT50 e o anual inexistente (PLN-02): tudo confere no
servidor e na extensão. Anotados (P2, sem promessa quebrada): "Conversas
ilimitadas" do Pro é um limite que não é aplicado nos planos menores; o Free
ganha um pouco a mais do que o anunciado; `LicenseService.js` é código morto
com números divergentes; "Equipe" não tem teto.

Status: ✅ (pendências P2 anotadas acima)

## Fase 5 — Cobrança (P0, pedido do dono)

- Trial de 7 dias → a primeira cobrança acontece de fato? Quem dispara (cron,
  MercadoPago)? O cartão é pedido em algum momento? Hoje o cadastro **não tem
  etapa de pagamento** (só cria a conta).
- Cupom EXIT50: 50% só na 1ª cobrança, preço cheio depois (Starter 24,95 →
  49,90; Pro 49,95 → 99,90).
- MercadoPago: cartão, PIX, boleto; webhooks (assinatura, idempotência,
  reenvio), renovação mensal, falha de pagamento (dunning), cancelamento,
  reembolso, troca de plano.
- Chave de acesso gerada e enviada por e-mail depois do pagamento.
- ⚠️ cobrança real exige credenciais do MercadoPago (🔒); aqui: modo teste e
  webhooks simulados com assinatura válida.

Status: ✅ (fluxo, cupom, webhook, idempotência, estorno, trial→past_due,
dunning, e-mail da chave — tudo testado, ver
`audit/evidencias/producao/pagamento-fluxo.md`) · ⚠️ cobrança real e envio de
e-mail dependem das credenciais do dono (MercadoPago, SendGrid) — go-live.
Importante p/ o dono: o cadastro **não** cobra no ato; o trial começa sem
cartão e a cobrança só ocorre quando o cliente configura o pagamento no painel.

## Fase 6 — IA em produção (P0/P1, pedido do dono)

**Tokens × preço** — ✅ fechado em
`audit/evidencias/producao/tokens-economia.md`: o saldo É debitado a cada
sugestão (idempotente, grava modelo/tokens); cada sugestão gasta ~1.700–2.100
tokens (medido), logo 50k ≈ 26 e 500k ≈ 263 sugestões/mês (o comentário antigo
"250/2.500" estava 10× otimista — corrigido). Custo gpt-4o-mini: Starter
~R$ 0,05, Pro ~R$ 0,54/mês → **margem > 99%, é lucro**. Não precisa reduzir
tokens por custo; dá até para aumentar a cota do Starter (decisão do dono 🔒).

**Chaves sob carga** (muitos clientes numa chave OpenAI/Groq):
- A chave não "cai" por uso; o que acontece é **limite por minuto** (429) e
  **crédito acabando** (a conta para até recarregar). Groq desta conta: 8.000
  tokens/min ≈ 3–4 sugestões/min.
- O que empresas grandes fazem, e o que verificar ou implementar aqui:
  1. **Nível de uso maior no provedor** (OpenAI sobe o limite conforme o gasto;
     pedir aumento) 🔒;
  2. **Mais de um provedor com troca automática** (já existe: Groq ⇄ OpenAI) —
     verificar que um 429 ou falta de crédito troca na hora;
  3. **Fila com controle de ritmo** (já existe fila Redis + worker) — verificar
     limitador global por provedor e respeito ao `Retry-After`;
  4. **Cota por cliente** (tokens do plano) para um cliente não esgotar a chave
     de todos;
  5. **Cache** de respostas repetidas (já existe) — medir acerto;
  6. **Alerta** de 429, de erro de crédito e de gasto diário, e **recarga
     automática** do crédito 🔒.
- Teste: provedor falso respondendo 429 e "insufficient_quota" sob 50 pedidos
  simultâneos → nenhum cliente fica sem resposta sem aviso; nada de bloqueio em
  cascata.

Status (tokens): ✅ · Status (chaves sob carga): ✅ analisado +
Retry-After (IA-61) implementado — `audit/evidencias/producao/chaves-ia-sob-carga.md`.
Já existe: fallback multi-provedor, circuit breaker, fila Redis, cota por
cliente, cache e alertas. Falta (🔒 conta do dono): subir o tier da OpenAI,
recarga automática e alerta de gasto.

## Fase 7 — Painel do cliente no site (P0, pedido do dono)

A aba "Tokens & Uso" foi verificada no navegador contra o banco
(`audit/harness/painel-tokens.js`, 7/7): saldo, total/ciclo, % usado,
consumido (30d), nº de sugestões, média por sugestão, compra de pacote no saldo
e no histórico ("Compra avulsa"), e formato brasileiro — tudo confere, inclusive
os tokens depois de comprar. Plano, nome e dias de trial vêm de `/auth/me`
(renderizados direto do banco). Faltam verificar no navegador: faturas
(`/billing/invoices`) e a chave de acesso / desvincular aparelho (Fase 3/5).

Status: ✅ (tokens) · 🔍 (faturas e chave — com a Fase 5)

## Fase 8 — E-mails e licença (P0)

- Modelos montam e disparam nos eventos certos: boas-vindas (cadastro),
  redefinir senha (link 1h), **pagamento confirmado com a chave WHL-… e o
  passo a passo de ativação**, trial expirado/dunning (cron testado), saldo
  baixo de tokens (`tokens.low_balance` → e-mail). Tudo em dry-run aqui.
- 🔒 Envio real: SENDGRID_API_KEY + domínio autenticado (SPF/DKIM). Sem a
  chave, produção loga alerta crítico avisando.
- Licença: chave gerada no pagamento (webhook testado), presa a 1 aparelho,
  desvincular pelo painel (fluxo verificado em `evidencias/licenca/`).
- 🔒 **Chave-mestra da extensão: remover antes do go-live** (mantida a pedido
  do dono para testes). `SUBSCRIPTION_MASTER_KEY` vazio em produção.

Status: ✅ (dry-run) · 🔒 envio real e chave-mestra no go-live

## Fase 9 — Infraestrutura (P0/P1)

- Produção usa **SQLite** (um servidor só). Ok para o lançamento, com backup.
  Postgres está desligado de propósito (o código ainda tem partes síncronas).
- Backup diário + **restauração testada** (`deploy/scripts/backup.sh`,
  `restore.sh`, `npm run dr:drill`).
- Caddy/TLS, redirecionamento www → domínio, cabeçalhos; `deploy.sh` e `health.sh`.
- Redis (fila da IA, limites): o que acontece se cair.
- Sentry e alertas chegando a alguém; uptime externo.
- Capacidade: teste de carga (k6) no cadastro, login e IA.

## Fase 10 — Segurança (P0/P1)

- Segredos fortes e fora do git; `.env` de produção.
- CORS/CSP (PROD-01, PROD-06), limites de tentativa (PROD-05).
- Rotas de administração e kill switch protegidas.
- Dependências com falha conhecida (`npm audit` no backend e na extensão).
- XSS nos campos que aparecem em tela (nome, mensagens, notas do CRM).
- Isolamento entre clientes (um cliente não vê dado de outro) — já há testes;
  conferir as rotas novas.

## Fase 11 — LGPD, termos e Chrome Web Store (P0)

- Política de privacidade e termos coerentes com o que a extensão coleta (lê
  conversas do WhatsApp, envia para IA, guarda mensagens apagadas).
- Consentimento de cookies antes de pixels (Meta/Google).
- Exclusão de dados/conta e prazo de retenção (já há rotina de limpeza — conferir).
- Chrome Web Store: permissões do `manifest.json` justificadas, descrição,
  política de privacidade publicada, ícones/prints; risco de reprovação por
  automação do WhatsApp — revisar textos 🔒.

## Fase 12 — Go-live (o que só o dono pode fazer) 🔒

- [ ] Domínio e DNS (A/AAAA, www), e-mail do Let's Encrypt
- [ ] `.env` de produção (segredos, `CORS_ORIGIN`, `PUBLIC_BASE_URL`)
- [ ] MercadoPago em produção (credenciais, URL do webhook, teste com cartão real de valor baixo)
- [ ] SendGrid (chave, domínio autenticado)
- [ ] OpenAI/Groq: limite de uso adequado, recarga automática, alerta de gasto
- [ ] Remover a chave-mestra da extensão e publicar a versão final na Chrome Web Store
- [ ] Backup externo (fora do servidor) configurado
- [ ] Teste final com WhatsApp real (`audit/ROTEIRO_TESTE_WHATSAPP_REAL.md`)

---

## Ordem de execução

1. Fase 0 (bloqueios) — em andamento.
2. Fase 1 (varredura da extensão) junto com a Fase 4 (planos), porque o bloqueio
   por plano aparece nas telas.
3. Fases 5, 6 e 7 (cobrança, IA/tokens, painel) — pedidos do dono.
4. Fases 2, 3, 8 (site, conta, e-mails/licença).
5. Fases 9, 10, 11 (infraestrutura, segurança, LGPD/Web Store).
6. Fase 12 com o dono e relatório final: funciona / não funciona / não verificado.

Este arquivo é atualizado a cada item fechado.
