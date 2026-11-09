# Chaves reais — fila-sem-worker-depois (2026-11-09T17:44:28.095Z)

Backend: http://127.0.0.1:3001. A extensão desiste do MÉTODO 0 após 30 s.

## compra_rastreio

Última mensagem do contato: "Esse rastreio é da transportadora Jet"

- MÉTODO 0 (/api/v2/ai/process): HTTP 200 em 2.6 s; success=true; intent=information; llmFallback=false
  - resposta: "Valeu pela confirmação! Estou ansioso para acompanhar o rastreio. Você sabe se tem alguma informação sobre como é o transporte com a Jet?"
  - chamada fetch gpt-4o-mini: HTTP 200 em 1583 ms → "{ "intent": "information", "confidence": 0.3, "reasoning": "A mensagem fornece uma informação sobre o rastreio, indicando a transportadora, mas não é uma solicitação de informação." }"
  - chamada fetch gpt-4o-mini: HTTP 200 em 1042 ms → "Valeu pela confirmação! Estou ansioso para acompanhar o rastreio. Você sabe se tem alguma informação sobre como é o transporte com a Jet?"
- MÉTODO 3 (/api/v1/ai/complete): HTTP 200 em 0.8 s; "Obrigado! Vou acompanhar o rastreio e entro em contato se precisar de algo."
  - chamada axios openai/gpt-oss-120b: HTTP 200 em 784 ms

