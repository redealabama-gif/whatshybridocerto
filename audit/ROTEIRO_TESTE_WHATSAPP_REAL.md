# Roteiro seguro — testar a IA no seu WhatsApp real

O que foi verificado até aqui rodou com a extensão real e a IA real, mas num WhatsApp Web **simulado** (relatório, seção 13). Este roteiro confirma o mesmo no WhatsApp de verdade **sem risco de mandar mensagem errada para cliente**.

## Antes de começar

- Backend atualizado (deploy) e extensão atualizada: em `chrome://extensions`, recarregar a extensão; depois recarregar o WhatsApp Web.
- Um **número de teste** para fazer o papel de cliente (outro celular/chip ou alguém de confiança). Nunca use conversa de cliente real neste roteiro.
- O Autopilot não tem lista de "só estes contatos" — só lista de bloqueio. Por isso: **na sua conta real, deixe o Autopilot parado** e teste só as sugestões (Partes 1 a 3). Teste o Autopilot (Parte 4) numa **conta de WhatsApp de teste** aberta no WhatsApp Web.
- Como parar: botão **Parar** do Autopilot no painel lateral (agora cancela também a resposta que estava sendo gerada — IA-55). Se você configurou `ADMIN_KILL_SWITCH_KEY` no servidor, o kill switch de IA bloqueia tudo pelo servidor.

## Parte 1 — Treinamento (5 min)

1. Abra a tela de Treinamento **e espere alguns segundos antes de salvar qualquer coisa**. Confira se as FAQs e os produtos que você já tinha aparecem. Se a tela abrir vazia mas você tinha treino salvo, ela restaura do servidor sozinha (IA-59) — espere a mensagem "Treinamento restaurado do servidor".
2. Cadastre uma FAQ de teste. Ex.: pergunta "Vocês têm estacionamento?", resposta "Temos estacionamento conveniado na Rua X, 2 horas grátis."
3. Cadastre um produto de teste com preço (ex.: "Produto Teste", 123).
4. Clique na FAQ que acabou de criar: deve abrir a edição com o botão **Excluir** (IA-48). Feche sem excluir.
5. Opcional: importe uma planilha com as colunas **Nome, Preço, Descrição** (pode ser salva pelo Excel em português, em CSV ou XLSX). O preço tem de aparecer certo, não 0 (IA-49).

## Parte 2 — Sugestão de resposta (nada é enviado sem você)

1. Do número de teste, mande: "Quanto custa o Produto Teste? E vocês têm estacionamento?"
2. Na conversa, clique no 🤖. Esperado: o preço **123** e o estacionamento da sua FAQ. Não pode aparecer "R$ XXX".
3. **Aprovar só coloca o texto no campo de digitação** — você decide se envia (pode apagar).
4. Do número de teste, pergunte algo que você NÃO cadastrou (ex.: "Vocês atendem em domicílio?"). Esperado: a sugestão diz que vai confirmar. Se ela afirmar algo que você não cadastrou, use ✏️ Editar ou ❌ Reprovar — e cadastre a informação (sem base, o modelo ainda arrisca às vezes: relatório 13.4).

## Parte 3 — Aprendizado

1. Numa pergunta que você não cadastrou, clique ✏️ **Editar**, escreva a resposta certa e clique ✅ **Aprovar**.
2. Do número de teste, pergunte **a mesma coisa com outras palavras**. Esperado: a sugestão usa a sua correção (IA-54 e IA-57).
3. Opcional: aprove 5 vezes a sugestão da mesma pergunta (pode ser em conversas diferentes). A partir da 6ª, a sugestão segue a resposta aprovada.
4. Opcional, para quem acessa o banco do servidor: as tabelas `ai_feedback`, `learned_examples` e `learning_patterns` devem ter registros do seu workspace.

## Parte 4 — Autopilot (só na conta de teste)

1. No painel lateral da conta de teste: ligue o **Modo Copiloto**. O Autopilot só envia sozinho quando a confiança ("pontuação / limite") passa do limite; ela sobe conforme você aprova sugestões. Para o teste, aprove sugestões até passar do limite (ou baixe o "Threshold de Confiança" só nessa conta).
2. Clique em **Iniciar** no Autopilot.
3. Do número de teste, mande a pergunta da sua FAQ ("Vocês têm estacionamento?"). Esperado: o Autopilot responde com o texto da FAQ.
4. Mande uma pergunta sem FAQ, uma reclamação ("quero cancelar, péssimo atendimento") e um pedido de preço. Esperado: **nada é enviado** — vira sugestão para revisão.
5. Deixe outra conversa aberta e mande a FAQ do número de teste: o WhatsApp Web **não pode recarregar** (IA-44); o Autopilot abre a conversa certa ou deixa para revisão.
6. Mande uma mensagem e clique em **Parar** logo em seguida: nada deve ser enviado depois do "Parado" (IA-55).
7. Atenção: cumprimento ("Boa noite, tudo bem?") é respondido sozinho — inclusive de amigos e família (decisão pendente, relatório 13.5). Na conta de teste isso é esperado.

## Se algo sair diferente

Anote a conversa (pode ser print), o horário e o que apareceu no painel. Com isso dá para reproduzir no ambiente de teste e corrigir.
