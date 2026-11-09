# HybridIntentClassifier.classifyWithRegex — por que preço vira "greeting"

limiar para pular o LLM: confidence > 0.8 (HybridIntentClassifier.js:400)

- **preco**: "Oi, quanto custa o plano mensal de vocês? Tem desconto no anual?" → intent=**pricing** conf=0.9 (LLM NÃO consultado)
  scores (soma de pattern.source.length): greeting=72/1m · pricing=49/2m · negotiation=44/1m · question=3/1m
- **preco sem "Oi"**: "Quanto custa o plano mensal de vocês? Tem desconto no anual?" → intent=**pricing** conf=0.9 (LLM NÃO consultado)
  scores (soma de pattern.source.length): pricing=49/2m · negotiation=44/1m · question=3/1m
- **entrega**: "Bom dia! Vocês entregam em Campinas? Qual o prazo?" → intent=**question** conf=0.75 (vai ao LLM se houver chave)
  scores (soma de pattern.source.length): schedule=74/1m · greeting=72/1m · question=3/1m
- **reclamacao**: "Comprei semana passada e até agora não chegou, estou bem chateado" → intent=**complaint** conf=0.65 (vai ao LLM se houver chave)
  scores (soma de pattern.source.length): schedule=74/1m · complaint=66/1m
- **reembolso**: "Quero meu dinheiro de volta, vou no Procon" → intent=**cancellation** conf=0.65 (vai ao LLM se houver chave)
  scores (soma de pattern.source.length): complaint=66/1m · cancellation=55/1m · purchase=41/1m
- **saude**: "Esse suplemento cura diabetes? Posso parar o remédio?" → intent=**question** conf=0.75 (vai ao LLM se houver chave)
  scores (soma de pattern.source.length): question=3/1m
