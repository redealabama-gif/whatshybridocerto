# HybridIntentClassifier.classifyWithRegex — por que preço vira "greeting"

limiar para pular o LLM: confidence > 0.8 (HybridIntentClassifier.js:400)

- **preco**: "Oi, quanto custa o plano mensal de vocês? Tem desconto no anual?" → intent=**greeting** conf=0.88 (LLM NÃO consultado)
  scores (soma de pattern.source.length): greeting=72/1m · pricing=49/2m · negotiation=44/1m · question=3/1m
- **preco sem "Oi"**: "Quanto custa o plano mensal de vocês? Tem desconto no anual?" → intent=**pricing** conf=0.85 (LLM NÃO consultado)
  scores (soma de pattern.source.length): pricing=49/2m · negotiation=44/1m · question=3/1m
- **entrega**: "Bom dia! Vocês entregam em Campinas? Qual o prazo?" → intent=**greeting** conf=0.95 (LLM NÃO consultado)
  scores (soma de pattern.source.length): greeting=72/1m · schedule=41/1m · question=3/1m
- **reclamacao**: "Comprei semana passada e até agora não chegou, estou bem chateado" → intent=**schedule** conf=0.95 (LLM NÃO consultado)
  scores (soma de pattern.source.length): schedule=41/1m
- **reembolso**: "Quero meu dinheiro de volta, vou no Procon" → intent=**purchase** conf=0.95 (LLM NÃO consultado)
  scores (soma de pattern.source.length): purchase=41/1m
- **saude**: "Esse suplemento cura diabetes? Posso parar o remédio?" → intent=**schedule** conf=0.95 (LLM NÃO consultado)
  scores (soma de pattern.source.length): schedule=41/1m · question=3/1m
