# IA-58 — fatos da empresa sem base: amostras reais (gpt-4o-mini)

Ferramenta: `audit/harness/real-sampling.js` com conversas sintéticas, 3 amostras
por conversa, conta nova **sem treino** (nada na base). Backend real, chave real.
"Inventou" = afirmou fato da empresa que não estava na conversa nem na base.

| Conversa (última mensagem) | Antes | Depois |
|---|---|---|
| "Vocês têm estacionamento?" | 3/3 inventou ("Sim, temos estacionamento disponível! É só chegar e estacionar.") | **0/3** — "Preciso confirmar essa informação. Vou verificar e te aviso já já!" |
| "Quanto tempo dura a consulta de avaliação?" | 3/3 inventou ("cerca de 30 a 45 minutos") | 2/3 inventou; 1/3 confirma com ressalva ("Preciso confirmar…, mas geralmente 30 a 60 minutos") |
| "Aceitam cartão de crédito? Dá pra parcelar?" | 3/3 inventou ("aceitamos… até 12 vezes") | 3/3 afirma que aceita (1 cita "até 10 vezes"; 2 dizem que vai confirmar as condições) |
| Plano/fidelidade (loja, controle) | 3/3 "vou confirmar" | 2/3 "vou confirmar"; 1/3 acrescentou "geralmente temos opções sem fidelidade" |
| Rastreio (dono é o comprador), colega de trabalho, conversa pessoal tensa | sem fatos inventados | sem fatos inventados (1 fecho genérico em 3 no rastreio) |

**Resultado:** respostas que inventam fato da empresa sem base caíram de 9/9 para 5/9.
A mudança ajuda, mas **não resolve sozinha** com o gpt-4o-mini: perguntas que
parecem "padrão" (cartão, duração) ainda saem afirmadas. O que resolve de fato é
ter a informação na base (FAQ, dados do negócio, TXT) — com ela, as respostas
saíram certas nas verificações pela tela real (seção 13 do relatório).

Mitigação já existente no Autopilot: a extensão só envia sozinha saudação, FAQ
encontrada, resposta rápida ou produto encontrado; o resto vai para revisão
humana (verificação V1). As sugestões passam pelo operador antes de sair.

## Saída bruta (trechos)

Antes:
```
sem_base_estacionamento #1 :: Sim, temos estacionamento disponível! É só chegar e estacionar. Qualquer coisa, é só avisar.
sem_base_duracao #1 :: Geralmente, a consulta de avaliação dura cerca de 30 a 45 minutos. …
sem_base_cartao #1 :: Sim, aceitamos cartão de crédito e dá pra parcelar sim! Geralmente, temos opções de parcelamento em até 12 vezes …
loja_controle #1 :: Preciso verificar essas informações sobre preço e fidelidade. Vou confirmar e já te retorno, tudo bem?
```

Depois:
```
sem_base_estacionamento #1 :: Preciso confirmar essa informação. Vou verificar e te aviso já já!
sem_base_estacionamento #2 :: Preciso verificar essa informação. Vou confirmar e te aviso já já!
sem_base_duracao #1 :: A consulta de avaliação costuma durar em torno de 30 a 40 minutos. …
sem_base_duracao #3 :: Preciso confirmar essa informação, mas geralmente a consulta de avaliação costuma durar em torno de 30 a 60 minutos. Vou verificar e já te falo. …
sem_base_cartao #2 :: Sim, aceitamos cartão de crédito e você pode parcelar suas compras. Se precisar de mais detalhes sobre as condições, posso confirmar isso pra você! …
loja_controle #3 :: Preciso confirmar esses detalhes, mas o plano Pro é bem completo … Em relação à fidelidade, geralmente temos opções que não exigem essa condição. …
```
