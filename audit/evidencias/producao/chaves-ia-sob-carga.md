# Chaves de IA sob carga (pergunta a do dono)

> "Com muitos clientes numa chave OpenAI/Groq, a chave cai ou é bloqueada? O que
> as empresas grandes fazem? Implementa a solução."

## O que acontece de fato com uma chave compartilhada

Uma chave de IA **não "cai"**. Sob carga ela encontra dois limites:

1. **Limite por minuto (429 — rate limit).** Temporário. A Groq desta conta tem
   ~8.000 tokens/min (TPM); como cada sugestão gasta ~1.800 tokens (ver
   `tokens-economia.md`), isso dá ~4 sugestões/min **somadas de todos os
   clientes** na chave Groq antes do 429. O provedor manda o cabeçalho
   `Retry-After` dizendo em quantos segundos tentar de novo.
2. **Crédito esgotado (402 / insufficient_quota).** A conta para de responder até
   recarregar. Foi o que o print "Incorrect API key / quota" mostrou com a chave
   de teste.

## O que já está implementado (e verificado)

| Prática ("o que as empresas grandes fazem") | No projeto | Onde |
|---|---|---|
| **Vários provedores com troca automática** | Groq ⇄ OpenAI ⇄ Anthropic; um 429/erro cai para o próximo na hora | `AIRouterService` fallback (IA-41/43) |
| **Circuit breaker** (pula o provedor que está falhando) | por (cliente, provedor), abre após N falhas | `BaseProvider`, `AIRouterService` (IA-12) |
| **Backoff / respeitar Retry-After** | 429 agora espera o tempo que o provedor pede (1s–1h), não 1h fixo | IA-61 (`airouter-retry-after.spec.js`) ✅ |
| **Fila com controle de ritmo (backpressure)** | fila Redis (BullMQ) com concorrência por tipo (realtime 10, batch 3) | `jobs/ai-worker.js` |
| **Cota por cliente** (um não esgota a chave do outro) | cada workspace tem saldo do plano; acima disso, 402 só para ele | `TokenService` + `middleware/tokenBalance` |
| **Cache de respostas repetidas** | dedup de prompts iguais | `AIRouterService.setCache` |
| **Alertas** | provedor fora e "todos os provedores falharam" vão ao alertManager; saldo baixo (10%) manda e-mail ao cliente | `AIRouterService:203/569`, `TokenService` → `emailListeners` (`tokens.low_balance`) |
| **Timeout por tentativa e teto de tentativas** | não trava a fila com um provedor lento | IA-11 |

## O que depende do dono (🔒 conta do provedor) — go-live

Essas não são código; são configuração da conta de IA:

1. **Subir o tier/limite na OpenAI** — o limite por minuto cresce conforme o
   histórico de gasto; pedir aumento ou pré-pagar sobe o TPM.
2. **Recarga automática de crédito** (auto-recharge) no painel da OpenAI, para a
   conta não parar no meio do mês.
3. **Alerta de gasto** (spend limit / usage alert) no painel da OpenAI/Groq.
4. **Chave dedicada por ambiente** (produção ≠ teste) e rotação.
5. Opcional: contratar tier pago da Groq se quiser mais que 8k TPM nela.

## Recomendação de melhoria futura (P2, não bloqueia)

- **Cooldown global no 429** (hoje é por cliente): como o limite é da CHAVE,
  quando o cliente A leva 429 na Groq, o cliente B também levaria — hoje B gasta
  uma tentativa para redescobrir antes de cair no fallback. Um cooldown curto
  compartilhado (respeitando o Retry-After) pouparia essa tentativa. O fallback
  já cobre o caso, então é eficiência, não correção.
- **Limitador global proativo por provedor** (manter-se abaixo do TPM antes de
  bater no 429), alimentado pela fila. Também P2.

## Resposta curta ao dono

A chave não "cai". Sob carga ela limita por minuto (429, passa sozinho) ou
acaba o crédito (até recarregar). O sistema já troca de provedor na hora,
respeita o tempo que o provedor pede, enfileira com ritmo, não deixa um cliente
esgotar o dos outros (cota por plano), cacheia repetições e avisa quando algo
falha ou o saldo cai. O que falta é **na sua conta de IA**: subir o limite,
ligar recarga automática e alerta de gasto.
