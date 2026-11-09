# Chaves reais — fila-sem-worker-antes (2026-11-09T16:57:35.109Z)

Backend: http://127.0.0.1:3001. A extensão desiste do MÉTODO 0 após 30 s.

## compra_rastreio

Última mensagem do contato: "Esse rastreio é da transportadora Jet"

- MÉTODO 0 (/api/v2/ai/process): HTTP 200 em 48.3 s — **passa do limite de 30 s da extensão**; success=true; intent=information; llmFallback=false
  - resposta: "Ótimo saber que o rastreio é da transportadora Jet! Eles costumam ser bem eficientes. Assim que você receber o código, será possível acompanhar o status da entrega em tempo real. Isso traz mais tranquilidade, não é mesmo? Se precisar de mais informações ou tiver alguma dúvida sobre o processo, estou aqui para ajudar! Tem algo mais que você gostaria de saber?"
  - chamada fetch gpt-4o-mini: HTTP 200 em 1781 ms → "{ "intent": "information", "confidence": 0.3, "reasoning": "A mensagem fornece uma informação sobre o rastreio relacionado à transportadora Jet, mas não é uma solicitação de informação direta." }"
  - chamada fetch gpt-4o-mini: HTTP 200 em 1462 ms → "Ótimo saber que o rastreio é da transportadora Jet! Eles costumam ser bem eficientes. Assim que você receber o código, será possível acompanhar o status da entrega em tempo real. Isso traz mais tranqu"
- MÉTODO 3 (/api/v1/ai/complete): HTTP 404 em 0.5 s; erro: fail
  - chamada axios llama-3.3-70b-versatile: HTTP 404 em 456 ms — The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.

