# P4 — site, painel e extensão vendendo RESPOSTAS, com Business e cobrança anual

Decisões do dono que esta fase implementa:

- parar de vender em tokens e vender em **respostas da IA por mês**;
- cenário B de cota: **Starter 500 · Pro 2.500**;
- plano **Business — R$ 299,90 · 10.000 respostas**;
- **compra anual** com **2 meses grátis** (paga 10, usa 12);
- **não** encurtar o prompt.

Tudo abaixo foi executado. O que não foi, está marcado **NÃO VERIFICADO**.

---

## 1. Números que passaram a valer

Fonte única no backend; site, painel e extensão espelham e têm teste de trava.

| | Starter | Pro | Business |
|---|---|---|---|
| respostas/mês (`TokenService.PLAN_RESPOSTAS`) | 500 | 2.500 | 10.000 |
| mensal (`MercadoPagoService.PLAN_PRICES`) | R$ 49,90 | R$ 99,90 | R$ 299,90 |
| anual (10 meses cobrados) | R$ 499,00 | R$ 999,00 | R$ 2.999,00 |
| equivalente por mês no anual | R$ 41,58 | R$ 83,25 | R$ 249,92 |
| economia no ano | R$ 99,80 | R$ 199,80 | R$ 599,80 |

Pacotes avulsos (`TokenService.TOKEN_PACKAGES`), que não expiram:

| respostas | preço | R$/resposta |
|---|---|---|
| 200 | R$ 24,00 | 0,1200 |
| 600 | R$ 59,00 | 0,0983 |
| 2.000 | R$ 149,00 | 0,0745 |
| 6.000 | R$ 349,00 | 0,0582 |

Internamente 1 resposta = 1.920 tokens (`TOKENS_POR_RESPOSTA`), medido na
fase ECON-01. O cliente nunca vê esse número.

## 2. Margem com o custo medido

Custo real medido: **R$ 0,0066 por resposta** (Groq `llama-3.3-70b-versatile`
na geração; o classificador `gpt-4o-mini` é pago e não é debitado do cliente —
já está dentro desse número). Detalhe em `tokens-economia.md`.

| plano | mensal | custo/mês | margem | anual | custo/ano | margem |
|---|---|---|---|---|---|---|
| Starter | R$ 49,90 | R$ 3,30 | 93,4% | R$ 499,00 | R$ 39,60 | 92,1% |
| Pro | R$ 99,90 | R$ 16,50 | 83,5% | R$ 999,00 | R$ 198,00 | 80,2% |
| Business | R$ 299,90 | R$ 66,00 | 78,0% | R$ 2.999,00 | R$ 792,00 | 73,6% |

Pacotes: margem de 88,7% (6.000) a 94,5% (200).

O cenário da pergunta do dono — uma empresa deixando o Autopilot responder
sozinho e **gastando a cota inteira todo mês** — é exatamente a coluna
"custo/mês". Mesmo nele, nenhum plano fica no vermelho. Há ainda um teto duro:
`src/routes/ai-v2.js:516-526` devolve 402 quando o saldo cai abaixo de 100
tokens, **antes** de qualquer chamada ao provedor. Não existe estouro de cota.

Teste de trava: `tests/unit/pacotes-sem-duplicata.spec.js` exige que nenhum
pacote saia mais barato por resposta que o plano mais barato por resposta
(Business, R$ 0,030). Sem isso, recarregar valeria mais a pena que assinar.

## 3. Defeitos encontrados e corrigidos nesta fase

Os cinco primeiros são do próprio Business, que tinha entrado só pela metade
em P1–P3. Nenhum apareceu lendo o código com calma — apareceram ao exercitar
o caminho do cliente.

| id | o que acontecia | onde |
|---|---|---|
| PLN-03 | cliente de R$ 299,90 recebia features do **Free Lite** e todo gate pago respondia "Disponível a partir do plano Pro" | `modules/subscription-manager.js:186`, `modules/feature-gate.js:81` |
| PLN-03 | `checkLimit()` pulava **toda** conferência de cota do Business (`if (!limits) return next()`) | `src/middleware/subscription.js:98`, `src/services/LicenseService.js:22` |
| PLN-04 | clicar em "7 dias grátis" no Business dava **400** — `isIn(['starter','pro','free'])` | `src/routes/auth.js:255` e `:1138` |
| PKG-01 | a vitrine listava **8 pacotes**, 4 deles cópias (os ids antigos viraram apelidos no P1) | `src/routes/tokens.js:58` |
| EXT-01 | o chip da extensão mostrava "100 créditos" (coluna parada) ou "19.200.000 créditos" (tokens crus) para quem comprou 10.000 respostas; e `['starter','pro','enterprise']` deixava o Business fora da faixa de plano | `src/routes/subscription.js:146/410/504`, `src/routes/auth.js:806`, `modules/subscription-ui.js:99` |

Três listas de planos escritas como `a === 'starter' || a === 'pro'` foram
trocadas por listas nomeadas (`PLANOS_PAGOS`, `PLANOS_VALIDOS`, `PRECO_MENSAL`).
Foi esse formato que deixou o Business de fora em cinco lugares diferentes.
Um dos testes novos é genérico: *"todo plano citado em FEATURE_PLANS tem
entrada em PLAN_LIMITS"* — pega o próximo plano adicionado pela metade.

### Dois defeitos meus, pegos pelo navegador e não pela leitura

- `brl(2999)` devolvia **"R$ 2999,00"**: `toFixed(2)` não agrupa milhar.
- a tabela de histórico do painel continuou em tokens depois de eu trocar o
  saldo e os pacotes — saiu **"+19.200.000 tokens"** na primeira execução.

Os dois só apareceram porque a verificação é feita com o Chromium aberto na
página, comparando texto renderizado. Revisão de diff não teria pegado.

## 4. O que foi verificado, e como

Harnesses em `audit/harness/`, todos contra Chromium real (`--no-sandbox`).

**Página de vendas** (`index.html`), 25 checagens em 1400×1000 e 390×844:

- 4 cards na ordem Free / Starter / Pro / Business, **todos na mesma fileira**;
- **zero** ocorrências de "token" no texto da seção de planos;
- mensal 49,90 / 99,90 / 299,90 → anual 41,58 / 83,25 / 249,92;
- notas "R$ 499,00 / R$ 999,00 / R$ 2.999,00 cobrados por ano";
- o `href` dos 3 CTAs ganha e perde `&cycle=annual` ao alternar;
- `/index.html?cycle=annual` já abre no anual;
- celular: nenhum elemento da seção passa dos 390px;
- nenhum erro de página ou de console.

**Cadastro** (`signup.html`), 16 checagens em 1280×950 e 390×844:

- 4 cards numa fileira, nenhuma ocorrência de "token";
- `?plan=business&cycle=annual` pré-seleciona o Business e acende o aviso;
- resumo do passo 3: "Business (anual)" e "R$ 2.999,00/ano";
- trocar de plano dentro do passo 2 mantém o ciclo;
- celular: zero rolagem horizontal.

**Painel** (`dashboard.html`), 18 checagens contra o backend real, com conta
Business criada pela API:

- nenhuma ocorrência de "token" no texto da aba;
- saldo "10.000" e "de 10.000 respostas neste ciclo (0% usado)";
- **4** cards de pacote (não 8), com "R$ 0,12 por resposta";
- plano "BUSINESS", "R$ 299,90/mês · 10.000 respostas por mês";
- alternar mensal/anual muda o resumo, o rótulo do botão e trava o recorrente;
- nenhum erro de página ou de console.

**Varredura de botões do site** (`audit/harness/botoes-todas-paginas.js`),
todas as páginas, logado e deslogado:

```
botões de ação clicados: 74   |   links verificados: 48
MORTOS (não reagiram a nada): 0
desabilitados no momento do clique (comportamento, não defeito): 1
   dashboard.html/billing  "Assinar com renovação automática"  act=subscribeRecurring
LINKS QUEBRADOS: 0
```

**O harness precisou ser consertado antes de eu poder confiar nele.** Na
primeira execução depois do P4 ele acusou dois mortos:
"Assinar com renovação automática" e "Mudar plano". Fui conferir no navegador,
um por um: **os dois funcionam** — o primeiro mostra o toast
"Administrador precisa configurar MERCADOPAGO_ACCESS_TOKEN", o segundo abre o
prompt com os três planos.

A causa era o harness, e ela só apareceu agora porque o seletor de ciclo é o
primeiro botão do site que **desabilita outro botão**. `MARCAR()` pulava os
desabilitados, então quando o clique em "Anual" travava a renovação
automática, aquele elemento perdia o `data-btn-i`, **todos os índices depois
dele escorregavam um**, e o alvo gravado no começo passava a apontar pra outro
elemento — ou pra nenhum. Corrigido: agora os desabilitados também são
marcados (índices estáveis) e "desabilitado no momento do clique" virou uma
categoria própria no relatório, separada de "morto".

**Varredura de botões da extensão** (`audit/harness/botoes-extensao.js`),
painel lateral e tela de Treinamento:

```
clicáveis testados: 177
MORTOS: 0
```

**Suítes:** backend 58 conjuntos / 335 testes; extensão 209 testes; bundles em
sincronia (134 fontes, `verify:bundles` OK).

## 5. Decisões de produto tomadas aqui, e por quê

**O ciclo anual não é gravado no cadastro.** `workspaces.billing_cycle` só
vira `'annual'` quando o pagamento é aprovado (`webhooks-payment-saas.js`). Se
fosse gravado no signup, `renovarCotaAnual()` em `src/jobs/billingCron.js`
passaria a repor a cota mensal de quem está só no trial e nunca pagou — o
SELECT filtra por `billing_cycle='annual'` e só pula quem tem
`annual_period_end` vencido, que no trial seria `NULL`. No cadastro o ciclo é
preferência de tela, guardada em `localStorage`, e o painel abre nela.

**No anual, a renovação automática fica travada.** O preapproval do
MercadoPago é mensal; o backend não cria recorrência de 12 meses. O painel diz
isso e oferece "Pagar 12 meses agora", em vez de prometer algo que não existe.

**A resposta do FAQ sobre cancelamento mudou.** Dizia só "a cobrança para no
próximo ciclo". No anual o próximo ciclo está 12 meses à frente, então agora
diz que a renovação não acontece e o cliente usa até o fim dos 12 meses já
pagos.

**A cota continua mensal no plano anual.** `renovarCotaAnual()` repõe uma vez
por mês de competência, idempotente por `invoice_id`. O FAQ e o aviso do
cadastro dizem isso com todas as letras — ninguém recebe 120.000 respostas de
uma vez.

## 6. Pendências que este PR NÃO resolve

**Decisão do dono (risco de custo):** o trial de 7 dias concede a cota cheia
do plano escolhido. No Business isso são **10.000 respostas = R$ 66 de custo
por cadastro**, sem cartão. Starter R$ 3,30, Pro R$ 16,50. Hoje nada limita
quantas contas de trial Business podem ser abertas. Três saídas possíveis:
limitar a cota do trial (ex.: 200 respostas em qualquer plano), exigir cartão
no cadastro, ou aceitar o custo como aquisição. Não mexi nisso porque muda
regra de negócio que o dono não pediu.

**SITE-03 (achado nesta fase, fora do escopo):** dois enfeites da home
apontam para arquivos locais que nunca foram baixados, então em produção eles
**sempre** vêm de CDN de terceiros — mesma classe do `lucide@latest` já
corrigido:

- `index.html:2784` → `/js/vendor/cobe.js` (404; `js/vendor/` só tem
  `lucide.min.js`) → cai em `unpkg.com`, `cdn.jsdelivr.net`, `esm.sh`;
- `index.html:4372` → `assets/robot-scene.splinecode` (404 confirmado no
  backend real: `curl -o /dev/null -w '%{http_code}'` devolveu 404) → cai em
  `https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode`.

O `hero-demo.mp4` aparecia como 404 no meu servidor estático de teste, mas
responde **200** no backend real — era limitação do harness (não trata
requisição com `Range`), não defeito do site.

**Pré-existente, medido:** a página inicial tem 31–48px de rolagem horizontal
no celular, variando conforme a fase da animação de `.bg-glow`, `.hero-mesh` e
`.logo-strip-track`. Medido antes e depois desta mudança: já existia, e a
seção de planos não contribui (0px próprios).

**NÃO VERIFICADO:** cobrança anual ponta a ponta com o MercadoPago real
(preferência criada, pagamento aprovado, webhook gravando
`billing_cycle='annual'` e `annual_period_end`). Tudo aqui foi exercitado com
as credenciais de teste e o provedor falso. Só o dono pode rodar com as
chaves reais.

**🔒 Do dono, como antes:** credenciais MercadoPago e SendGrid; **remover a
chave-mestra `modules/subscription-manager.js:207` antes do go-live**;
domínio/DNS; tier da OpenAI e recarga automática; publicação na Chrome Web
Store; decidir sobre o banner de cookies; decidir sobre os nomes fictícios da
prova social (risco de CDC, já sinalizado).
