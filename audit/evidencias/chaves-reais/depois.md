# Chaves reais — depois (2026-11-09T17:44:28.142Z)

Backend: http://127.0.0.1:3000. A extensão desiste do MÉTODO 0 após 30 s.

## compra_rastreio

Última mensagem do contato: "Esse rastreio é da transportadora Jet"

- MÉTODO 0 (/api/v2/ai/process): HTTP 200 em 3.6 s; success=true; intent=information; llmFallback=false
  - resposta: "Valeu pela informação! E como costuma ser o prazo com a Jet? Tem alguma diferença em relação a outras transportadoras?"
  - chamada fetch gpt-4o-mini: HTTP 200 em 1637 ms → "{ "intent": "information", "confidence": 0.3, "reasoning": "A mensagem fornece uma informação sobre o rastreio relacionado à transportadora jet, mas não é uma solicitação de informação." }"
  - chamada fetch gpt-4o-mini: HTTP 200 em 1064 ms → "Show! Valeu pela info. Vou ficar atento ao rastreio e ao prazo. Se precisar de mais alguma coisa, só avisar!"
  - chamada fetch gpt-4o-mini: HTTP 200 em 863 ms → "Valeu pela informação! E como costuma ser o prazo com a Jet? Tem alguma diferença em relação a outras transportadoras?"
- MÉTODO 3 (/api/v1/ai/complete): HTTP 200 em 0.8 s; "Obrigado! Vou acompanhar o rastreio. Qualquer novidade me avisa."
  - chamada axios openai/gpt-oss-120b: HTTP 200 em 775 ms

## colega_trabalho

Última mensagem do contato: "Vão dizer que é assunto da outra unidade"

- MÉTODO 0 (/api/v2/ai/process): HTTP 200 em 2.2 s; success=true; intent=information; llmFallback=false
  - resposta: "Entendi, é que preciso de uma informação específica e não tô conseguindo por aqui. Se tiver algum jeito de me ajudar com um contato, seria ótimo!"
  - chamada fetch gpt-4o-mini: HTTP 200 em 1124 ms → "{ "intent": "information", "confidence": 0.3, "reasoning": "A mensagem sugere que a pessoa está comentando sobre um assunto que pode ser considerado de outra unidade, o que indica uma busca por inform"
  - chamada fetch gpt-4o-mini: HTTP 200 em 1032 ms → "Entendi, é que preciso de uma informação específica e não tô conseguindo por aqui. Se tiver algum jeito de me ajudar com um contato, seria ótimo!"
- MÉTODO 3 (/api/v1/ai/complete): HTTP 200 em 0.6 s; "É sobre a transferência de um colaborador que está pedindo documentação. Preciso mesmo de alguém que possa confirmar os procedimentos, porque lá parece que não têm acesso ao histórico. Você teria algum contato direto ou poderia me indicar alguém que realmente possa ajudar?"
  - chamada axios openai/gpt-oss-120b: HTTP 200 em 578 ms

## pessoal_tensa

Última mensagem do contato: "A conclusão é que você vai fazer de novo e pior"

- MÉTODO 0 (/api/v2/ai/process): HTTP 200 em 1.9 s; success=true; intent=complaint; llmFallback=false
  - resposta: "Eu entendo sua frustração e peço desculpas por isso. Eu realmente quero corrigir essa situação e garantir que você fique satisfeito. Vamos conversar sobre como posso resolver isso pra você?"
  - chamada fetch gpt-4o-mini: HTTP 200 em 971 ms → "{ "intent": "complaint", "confidence": 0.85, "reasoning": "A mensagem expressa uma insatisfação ou crítica em relação a uma ação que será repetida, sugerindo que será pior do que antes." }"
  - chamada fetch gpt-4o-mini: HTTP 200 em 958 ms → "Eu entendo sua frustração e peço desculpas por isso. Eu realmente quero corrigir essa situação e garantir que você fique satisfeito. Vamos conversar sobre como posso resolver isso pra você?"
- MÉTODO 3 (/api/v1/ai/complete): HTTP 200 em 0.7 s; "Desculpa mesmo, reconheço que falhei. Vou fazer o possível para corrigir isso agora e garantir que não se repita."
  - chamada axios openai/gpt-oss-120b: HTTP 200 em 660 ms

## loja_controle

Última mensagem do contato: "Quanto fica por mês para esse tamanho? E tem fidelidade?"

- MÉTODO 0 (/api/v2/ai/process): HTTP 200 em 0.8 s; success=true; intent=pricing; llmFallback=false
  - resposta: "Vou confirmar as informações sobre o preço e a fidelidade do plano Pro para vocês. Um momento!"
  - chamada fetch gpt-4o-mini: HTTP 200 em 802 ms → "Vou confirmar as informações sobre o preço e a fidelidade do plano Pro para vocês. Um momento!"
- MÉTODO 3 (/api/v1/ai/complete): HTTP 200 em 0.5 s; "Vou verificar o valor mensal para 3 dentistas e 2 recepcionistas e confirmar se há algum período de fidelidade. Já retorno em breve!"
  - chamada axios openai/gpt-oss-120b: HTTP 200 em 510 ms

