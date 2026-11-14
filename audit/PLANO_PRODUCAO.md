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

Para cada tela: abrir no Chromium com a extensão real, o WhatsApp simulado e o
backend de teste; usar **cada** controle; anotar: funciona / não funciona
(corrigir ou remover) / depende de WhatsApp real (⚠️, vai para o roteiro manual
`audit/ROTEIRO_TESTE_WHATSAPP_REAL.md`).

| Tela | O que verificar | Status |
|---|---|---|
| Popup (`popup/popup.html`) | login, chave de acesso, plano mostrado, botões, links | 🔍 |
| Painel lateral — Principal (disparo) | lista de números, importar CSV/planilha, mensagem com variáveis, imagem/áudio/arquivo, intervalo, iniciar/pausar/parar, fila, relatório | 🔍 |
| Painel lateral — Extrator | extrair contatos/arquivados/bloqueados, exportar CSV | 🔍 |
| Painel lateral — Grupos | listar grupos, extrair membros, exportar | 🔍 |
| Painel lateral — Recover | mensagens apagadas/editadas, mídia, filtros, exportar | 🔍 |
| Painel lateral — CRM | contatos, etapas do funil, arrastar, notas, tags, busca | 🔍 |
| Painel lateral — Tarefas | criar, concluir, lembrete, busca/filtro | 🔍 |
| Painel lateral — IA / Autopilot | ligar/desligar, modo copiloto, limite, horário, regras, kill switch | 🔍 |
| Painel lateral — Respostas rápidas | criar, gatilho `/` no chat, editar, excluir | 🔍 |
| Painel lateral — Equipe | convidar, papéis, limites do plano | 🔍 |
| Painel lateral — Backup | exportar/importar dados | 🔍 |
| Painel lateral — Configurações / Servidor / SAPL | cada opção salva e tem efeito | 🔍 |
| Página CRM (`crm/crm.html`) | cada botão e campo | 🔍 |
| Treinamento — 6 abas | Simulação, Exemplos, FAQs, Produtos, Negócio, Importar: cada campo/botão, Exportar, Sincronizar, Laboratório de teste | 🔧 (busca, simulação e topo prontos; resto a varrer) |
| Dentro do WhatsApp | barra do topo, botão 🤖 e painel de sugestão, 👍/👎, Autopilot, banners do Recover | 🔍 (parte já coberta pelas fases de IA) |
| Bloqueio por plano | o que cada plano libera aparece liberado e o resto bloqueado com mensagem clara | 🔍 (ligado à Fase 4) |

Critério de pronto: tabela por tela com cada controle e o resultado, prints em
`audit/evidencias/producao/extensao/`.

## Fase 2 — Site (P0)

| Item | O que verificar | Status |
|---|---|---|
| Cadastro → painel; login; senha errada | navegador real | ✅ (`audit/harness/site-producao.js`) |
| Esqueci minha senha → e-mail → redefinir → entrar | ponta a ponta com o link do e-mail | 🔍 |
| Página inicial | cada botão/link, seção de preços igual aos planos reais, cupom de saída (EXIT50) | 🔍 |
| Termos, privacidade, ajuda, documentação da API | abrem, sem link quebrado, conteúdo coerente com o produto | 🔍 |
| Versão celular | cadastro, login, painel e página inicial em 390 px | 🔍 |
| Erros no console e arquivos 404 | nenhuma página com erro | ✅ PROD-06/07; documentação da API usa `swagger-ui-dist@5` da CDN jsdelivr (bloqueada aqui — ⚠️ NÃO VERIFICADO; fixar versão) |
| Pixels/analytics | disparam só com consentimento (ver Fase 11) | 🔍 |

## Fase 3 — Conta e acesso (P0)

| Item | Status |
|---|---|
| Cadastro cria conta, workspace e trial de 7 dias corretos (datas) | 🔍 |
| E-mail de boas-vindas (conteúdo, links) | 🔍 (⚠️ envio real depende do SendGrid) |
| Recuperar senha (token, validade, uso único) | 🔍 |
| 2FA (ativar, entrar, desativar, códigos de recuperação) | 🔍 |
| Sessão única da extensão (LIC-02) | ✔️ (PR #316) |
| Limite de tentativas de login por cliente (não global) | ✅ PROD-05 |
| Excluir conta (LGPD) | 🔍 |

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

Status: 🔍

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

Cada número e texto do `dashboard.html` comparado com o banco: plano, dias de
trial, saldo de tokens (inclusive depois de comprar), uso, faturas, datas e
valores em formato brasileiro, chave de acesso e desvincular aparelho.

Status: 🔍

## Fase 8 — E-mails e licença (P0)

- Cada e-mail (boas-vindas, senha, pagamento confirmado com a chave, falha de
  pagamento, fim do trial): conteúdo, links, remetente.
- 🔒 SendGrid: chave, domínio autenticado (SPF/DKIM) — sem isso os e-mails caem
  no spam ou nem saem (sem chave o servidor só simula o envio).
- 🔒 **Chave-mestra da extensão** (`modules/subscription-manager.js`): mantida a
  pedido do dono para testes; **remover antes do lançamento**.
  `SUBSCRIPTION_MASTER_KEY` no servidor de produção vazia.

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
