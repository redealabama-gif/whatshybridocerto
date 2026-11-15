# Tokens: contabilização, custo por sugestão e margem (Fase 6 / pergunta b do dono)

## 1. O saldo é debitado de verdade?

**Sim.** Prova no servidor real + banco (`scratchpad/tokens-probe.js`):

- Cadastro Pro credita 500.000 tokens (`token_transactions`: `plan_renewal` +500000).
- Cada sugestão pelo caminho real da extensão (`POST /api/v2/ai/process` →
  orquestrador → `AIRouterService._trackRequest` → `tokenService.consume`) grava
  um `consume` com o modelo e os tokens de entrada/saída, e o saldo cai:
  500.000 → 499.820 → 499.640 (−180 por sugestão no provedor **falso**, que
  reporta usage fixo de 120+60).
- O débito é **idempotente** por `ai_request_id` (reenvio não cobra 2×) e só
  debita em `status: success`.
- A preocupação antiga de "tokens=0" era do **pipeline-tracer** (observabilidade,
  outra tabela), não do débito de cobrança. O débito de cobrança está correto.

> Nota: `POST /api/v1/ai/complete` é um pass-through cru (axios, não passa pelo
> provedor falso no teste) e a extensão **não** o usa para sugestões — usa
> `/api/v2/ai/process`. O 401 "Incorrect API key" que aparece ao chamar
> `/ai/complete` no harness é a OpenAI recusando a chave `sk-fake`, não um bug.

## 2. Quantos tokens por sugestão (medição real)

`audit/evidencias/producao/tokens-prompt-medido.json` (capturado do corpo que o
orquestrador envia ao provedor, com base típica: 10 FAQs, 10 produtos, dados do
negócio):

| | valor |
|---|---|
| system prompt | 6.450 caracteres |
| prompt total (system + conversa) | 6.494 caracteres |
| **tokens de entrada estimados** | **~1.620 (4 ch/tok) a ~1.860 (3,5 ch/tok, pt-BR)** |
| resposta | ≤ `max_tokens` 400 (real ~60–150) |
| **total por sugestão** | **~1.700 a ~2.100 tokens** |

O prompt tem orçamento interno de ~2.000 tokens (`DynamicPromptBuilder`
`totalBudget=2000`, somatório de `DEFAULT_BUDGETS` ~3.140 com corte por
prioridade), então o número bate.

**Consequência:** 50k tokens ÷ ~1.900 ≈ **26 sugestões/mês** (Starter);
500k ÷ ~1.900 ≈ **263 sugestões/mês** (Pro). O comentário antigo do código
dizia "250 / 2.500 mensagens" — estava **10× otimista**. Corrigido em
`TokenService.js`. O site vende "50.000 tokens" sem prometer nº de mensagens,
então não há promessa quebrada ao cliente.

## 3. Custo real e margem (pergunta b: "lucro ou prejuízo?")

Modelo configurado: **gpt-4o-mini** (`OpenAIProvider` fixa esse modelo).
Preço gpt-4o-mini: entrada **US$ 0,15 / 1M**, saída **US$ 0,60 / 1M**
(câmbio usado: R$ 5,50 / US$).

| Item | Tokens | Custo OpenAI | Em R$ |
|---|---|---|---|
| 1 sugestão (~1.800 in + 120 out) | ~1.920 | US$ 0,00034 | **~R$ 0,002** |
| Starter — 50.000 tokens/mês | 50k (~93% in) | US$ 0,0098 | **~R$ 0,05** |
| Pro — 500.000 tokens/mês | 500k | US$ 0,098 | **~R$ 0,54** |

- **Starter R$ 49,90** com custo de IA ~**R$ 0,05** → margem de IA > 99%.
- **Pro R$ 99,90** com custo de IA ~**R$ 0,54** → margem de IA > 99%.
- Mesmo trocando para **gpt-4o cheio** (in US$ 2,50/M, out US$ 10/M):
  Starter ~R$ 0,88, Pro ~R$ 8,80 — ainda folgado.
- **Groq** (gpt-oss) é ainda mais barato/grátis até o limite de 8k TPM.

**Resposta ao dono:** é **lucro**, não prejuízo. O custo de IA é desprezível
diante do preço. **Não precisa reduzir a quantidade de tokens por custo.**

## 4. Recomendações

1. **Não reduzir tokens por medo de prejuízo** — a margem é enorme.
2. **Avaliar o contrário (produto, decisão do dono 🔒):** 26 sugestões/mês no
   Starter é pouco para um plano "pra começar a vender com IA". Se quiser que o
   cliente sinta valor, dá para **aumentar** a cota (o custo comporta) ou
   encurtar o prompt (menos tokens por sugestão → mais sugestões na mesma cota).
3. **Encurtar o prompt** é a alavanca mais barata: hoje ~1.800 tokens de entrada
   por sugestão. Cortar conhecimento irrelevante (já há orçamento por seção)
   reduz custo e multiplica as sugestões por cota.
4. **Alerta de saldo baixo** já existe (`LOW_BALANCE_THRESHOLD` 10%,
   `low_balance` no balance). Ligar e-mail/aviso quando dispara (ver Fase 6 IA).
5. Pacotes avulsos não expiram (PLN-01 ✅); a renovação mantém o comprado.
