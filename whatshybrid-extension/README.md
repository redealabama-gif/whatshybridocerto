# Axion v7.1.0 Enterprise

Uma extensão para navegador que automatiza o envio de mensagens no WhatsApp Web.

## 🚀 Novidades v7.1.0 - AI Enterprise

### 🧠 AIService v1.0 - Serviço Unificado de IA
Abstração multi-provider com fallback automático, retry, rate limiting e cache.

**Providers Suportados:**
- **OpenAI** - GPT-4o, GPT-4o Mini, GPT-4 Turbo, o1
- **Anthropic** - Claude 3.5 Sonnet, Haiku, Opus
- **Venice AI** - Llama 3.3 70B, DeepSeek R1
- **Groq** - Llama 3.3 70B (ultra-rápido)
- **Google Gemini** - Gemini 2.0 Flash, 1.5 Pro
- **Ollama** - Modelos locais (Llama, Mistral)

**Features:**
- Fallback automático entre providers
- Retry com exponential backoff
- Rate limiting inteligente
- Cache de respostas (5 min TTL)
- Streaming support
- Token counting & cost tracking
- Health monitoring

```javascript
// Configurar provider
AIService.configureProvider('openai', {
  apiKey: 'sk-...',
  model: 'gpt-4o-mini',
  enabled: true
});

// Completar mensagem
const result = await AIService.complete([
  { role: 'system', content: 'Você é um assistente.' },
  { role: 'user', content: 'Olá!' }
]);

// Streaming
for await (const chunk of AIService.stream(messages, options)) {
  console.log(chunk);
}

// Funções de conveniência
await AIService.chat('Olá!', { systemPrompt: 'Seja amigável' });
await AIService.summarize(longText);
await AIService.translateText(text, 'inglês');
await AIService.extractJSON(text, schema);
```

### 🤖 CopilotEngine v1.0 - Motor de Copilot Enterprise
Sistema inteligente de assistência conversacional com context-awareness.

**Modos de Operação:**
- 🔴 **OFF** - Desativado
- 👁️ **PASSIVE** - Observa sem sugerir
- 💡 **SUGGEST** - Mostra sugestões de resposta
- 🤝 **ASSIST** - Ajuda a compor respostas
- 📝 **AUTO_DRAFT** - Gera rascunhos automáticos
- ⚡ **SEMI_AUTO** - Envia após aprovação
- 🤖 **FULL_AUTO** - Responde automaticamente

**Features:**
- Intent detection (12 intenções)
- Sentiment analysis (positivo/negativo/neutro)
- Entity extraction (telefone, email, valores, datas)
- Knowledge base integrada
- Personas customizáveis
- Multi-turn conversations
- Response scoring & confidence
- Learning from feedback

**Personas Incluídas:**
- 👔 Profissional - Formal e objetivo
- 😊 Amigável - Descontraído e acolhedor
- 💼 Vendas - Persuasivo e focado em conversão
- 🛠️ Suporte - Técnico e solucionador
- 🎩 Concierge - Luxo e exclusividade
- 🏆 Coach - Motivador e orientador

```javascript
// Definir modo
CopilotEngine.setMode('suggest');

// Definir persona
CopilotEngine.setActivePersona('sales');

// Analisar mensagem
const analysis = await CopilotEngine.analyzeMessage('Quanto custa?', chatId);
console.log(analysis.intent); // { id: 'purchase', ... }
console.log(analysis.sentiment); // { label: 'neutral', ... }

// Gerar resposta
const response = await CopilotEngine.generateResponse(chatId, analysis);

// Detectar intenção
const intent = CopilotEngine.detectIntent('Olá, bom dia!');
// { id: 'greeting', name: 'Saudação', ... }

// Analisar sentimento
const sentiment = CopilotEngine.analyzeSentiment('Excelente atendimento!');
// { label: 'positive', score: 0.8, emoji: '😊' }

// Extrair entidades
const entities = CopilotEngine.extractEntities('Meu email é teste@teste.com');
// { emails: ['teste@teste.com'], phones: [], ... }

// Adicionar à knowledge base
CopilotEngine.addToKnowledgeBase('faqs', {
  q: 'Qual o prazo de entrega?',
  a: 'O prazo é de 3 a 5 dias úteis.',
  tags: ['prazo', 'entrega']
});

// Criar persona personalizada
CopilotEngine.createCustomPersona({
  name: 'Minha Empresa',
  description: 'Atendimento personalizado',
  temperature: 0.6,
  systemPrompt: 'Você é o assistente da Minha Empresa...'
});
```

---

## 🧪 Testes

```javascript
// Testes do EventBus + StateManager
WHLTests.run();

// Testes do AIService + CopilotEngine
AITests.run();

// Ou via atalho
Ctrl+Shift+T
```

---

## 📊 Arquitetura Enterprise

```
┌─────────────────────────────────────────────────┐
│                  Axion                │
├─────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐            │
│  │   EventBus   │◄─┤ StateManager │            │
│  │    v2.0      │  │    v1.0      │            │
│  └──────┬───────┘  └──────┬───────┘            │
│         │                 │                     │
│  ┌──────▼─────────────────▼──────┐             │
│  │          AIService            │             │
│  │    (Multi-Provider Core)      │             │
│  └──────────────┬────────────────┘             │
│                 │                               │
│  ┌──────────────▼────────────────┐             │
│  │       CopilotEngine           │             │
│  │  (Intent/Sentiment/Context)   │             │
│  └───────────────────────────────┘             │
│                                                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │   CRM   │ │  Tasks  │ │Analytics│  ...     │
│  └─────────┘ └─────────┘ └─────────┘          │
└─────────────────────────────────────────────────┘
```

---

## 🎉 Melhorias Anteriores (v1.3.8)

### 🔒 Segurança Aprimorada
- ✅ **Correção de segurança postMessage**: Todas as comunicações agora validam origem
- ✅ **NetSniffer otimizado**: Usa apenas padrões específicos do WhatsApp
- ✅ **CodeQL scan limpo**: 0 vulnerabilidades detectadas
- ✅ **Limite de memória reduzido**: NetSniffer agora limitado a 5000 números (otimizado)

### 🏗️ Arquitetura Melhorada
- ✅ **Listeners consolidados**: Background script agora usa único listener organizado
- ✅ **Logging centralizado**: Sistema unificado de logs em todo o projeto
- ✅ **Validação de telefone**: Normalização correta para números brasileiros e internacionais
- ✅ **Cache inteligente**: Sistema LRU com proteção contra QuotaExceededError

### 📚 Documentação
- ✅ **Consolidada**: 41 arquivos markdown reduzidos para 2 (README + docs/DOCUMENTATION.md)
- ✅ **Documentação técnica**: Nova documentação completa para desenvolvedores

## ✨ Funcionalidades Principais

### 📊 Barra de Progresso em Tempo Real
A barra de progresso agora reflete o progresso real das operações em tempo real:
- ✅ Atualização imediata após cada mensagem enviada
- ✅ Estatísticas precisas (Enviados, Falhas, Pendentes)
- ✅ Porcentagem de conclusão atualizada instantaneamente
- ✅ Feedback visual durante toda a execução da campanha
- ✅ Barra de progresso na extração de contatos
- ✅ Contador de contatos em tempo real durante extração

### 📱 Integridade dos Números de Telefone
Os números de telefone utilizados são sempre os números reais dos contatos:
- ✅ Números vêm da entrada do usuário (textarea ou CSV)
- ✅ Sanitização apenas remove caracteres não-numéricos (espaços, hífens)
- ✅ Nenhum número aleatório é gerado ou utilizado
- ✅ Validação garante formato correto (8-15 dígitos)
- ✅ Extração de contatos usa SOMENTE números reais do WhatsApp Web
- ✅ Documentação completa das fontes de extração

### 🎨 Interface Aprimorada
- ✅ Logo Axion no painel principal
- ✅ Logo Axion no popup da extensão
- ✅ Design responsivo e bem posicionado

## 🚀 Funcionalidades

### Envio Automático de Mensagens
- Envio 100% automático via DOM manipulation
- Sem recarregamento de página
- Delays personalizáveis entre envios (min/max)
- Efeito de digitação para simular comportamento humano
- **NOVO**: Pressione Enter no campo de mensagem para gerar tabela automaticamente

### 📝 Templates de Mensagens
- **NOVO**: Sistema completo de templates reutilizáveis
- Organização por categoria (Vendas, Suporte, Marketing, Cobrança, Outros)
- Variáveis dinâmicas suportadas:
  - `{nome}` - Nome do contato
  - `{empresa}` - Empresa do contato
  - `{data}` - Data atual formatada (30/12/2025)
  - `{hora}` - Hora atual (14:30)
  - `{numero}` - Número do destinatário
  - `{saudacao}` - Saudação automática (Bom dia/Boa tarde/Boa noite)
- Interface visual para criar, editar e excluir templates
- Seletor de templates na tela principal
- Preview com variáveis processadas em tempo real

### Gerenciamento de Campanhas
- Importação de números via textarea ou CSV
- Preview da mensagem no estilo WhatsApp
- Suporte a imagens (enviadas automaticamente)
- **NOVO**: Botões visuais para anexar e remover imagens
- Controle de campanha: Iniciar, Pausar, Parar
- Sistema de retry automático em falhas
- Opção de continuar em erros

### Extração de Contatos
- Extração automática de números do WhatsApp Web
- **GARANTIA**: Extrai SOMENTE números reais dos contatos presentes
- **NUNCA** gera números aleatórios ou fictícios
- Barra de progresso em tempo real durante a extração
- Suporte a múltiplas fontes de dados do DOM
- Scroll automático para coletar todos os contatos
- Validação de números (8-15 dígitos)
- Contador de contatos em tempo real

### Estatísticas e Relatórios
- Contador de mensagens enviadas
- Contador de falhas
- Contador de pendentes
- Barra de progresso visual
- Exportação de relatórios em CSV
- Cópia rápida de números com falha

## 📋 Como Usar

1. **Instalação**
   - Clone o repositório
   - Abra Chrome e vá para `chrome://extensions/`
   - Ative "Modo do desenvolvedor"
   - Clique em "Carregar sem compactação"
   - Selecione a pasta do projeto

2. **Configuração**
   - Abra o WhatsApp Web
   - Clique no ícone da extensão
   - Configure os delays e opções
   - Cole os números de telefone (um por linha)
   - Digite sua mensagem
   - Opcionalmente, adicione uma imagem

3. **Execução**
   - Clique em "Gerar tabela" para criar a fila
   - Revise os números e a mensagem
   - Clique em "Iniciar Campanha"
   - Acompanhe o progresso em tempo real

## 🔧 Configurações

### Parâmetros de Automação
- **Delay mínimo**: Tempo mínimo entre envios (segundos)
- **Delay máximo**: Tempo máximo entre envios (segundos)
- **Retry**: Número de tentativas extras em caso de falha (0-5)
- **Agendamento**: Iniciar campanha em horário específico

### Opções Avançadas
- **Continuar em erros**: Não interromper campanha em falhas
- **Efeito digitação**: Simular digitação humana (recomendado)
- **Overlay busca**: Destacar campo de pesquisa durante operação
- **Fallback DOM→URL**: Tentar URL se DOM falhar

## 📊 Progresso e Estatísticas

A interface exibe em tempo real:
- **Enviados**: Quantidade de mensagens enviadas com sucesso
- **Falhas**: Quantidade de mensagens que falharam
- **Pendentes**: Quantidade de mensagens aguardando envio
- **Barra de Progresso**: Visualização gráfica do progresso (%)
- **Tabela de Fila**: Lista completa com status de cada contato

### Status dos Contatos
- 🔵 **pending**: Aguardando processamento
- 🟣 **opened**: Chat aberto, preparando envio
- 🟢 **sent**: Mensagem enviada com sucesso
- 🔴 **failed**: Falha no envio (após todas as tentativas)
- ⚠️ **invalid**: Número inválido (fora do formato)

## 🔒 Segurança e Integridade

### Números de Telefone
- **NUNCA** gera números aleatórios
- Utiliza SOMENTE os números fornecidos pelo usuário
- Sanitização remove apenas formatação (espaços, hífens, parênteses)
- Preserva completamente os dígitos originais

Exemplo de sanitização:
```
Entrada: +55 (11) 99999-8888
Saída: 5511999998888
```

### Extração de Contatos - Como Funciona
A extração de contatos é 100% segura e confiável:

**Fontes de dados reais:**
1. **#pane-side**: Painel lateral com conversas ativas
2. **data-id**: IDs únicos dos contatos do WhatsApp
3. **data-jid**: JID (Jabber ID) - formato interno do WhatsApp
4. **Células de chat**: Elementos visíveis de contato/grupo
5. **Links com telefone**: Números clicáveis no WhatsApp
6. **Padrões @c.us**: Formato interno do WhatsApp (número@c.us)
7. **Títulos e labels**: Informações acessíveis de contato

**Processo de extração:**
1. Inicia pelo topo da lista de conversas
2. Scroll automático e incremental para capturar todos os contatos
3. Extração em tempo real com barra de progresso
4. Coleta de múltiplas fontes do DOM
5. Validação de formato (8-15 dígitos)
6. Remoção de duplicatas
7. Ordenação alfabética

**Garantias:**
- ✅ Apenas números REAIS presentes no WhatsApp Web
- ✅ ZERO geração de números aleatórios ou fictícios
- ✅ Preserva formato original dos números
- ✅ Feedback visual em tempo real (progresso + contador)

### Validação
- Aceita números com 8 a 15 dígitos
- Formatos aceitos: internacional, nacional, local
- Números inválidos são marcados e podem ser revisados antes do envio

## 🐛 Troubleshooting

### A barra de progresso não atualiza
✅ **RESOLVIDO**: A barra agora atualiza em tempo real após cada operação, incluindo na extração de contatos.

### Os números extraídos não correspondem aos meus contatos
✅ **VERIFICADO**: Os números extraídos são 100% reais e vêm diretamente do WhatsApp Web. O extrator:
- Busca em múltiplas fontes do DOM oficial do WhatsApp
- Nunca gera números aleatórios
- Mostra progresso e contador em tempo real
- Valida apenas o formato, sem modificar os números

### A extração de contatos está lenta
✅ **NORMAL**: A extração é intencional lenta para:
- Garantir que todos os contatos sejam capturados
- Permitir que o WhatsApp Web carregue os elementos
- Evitar sobrecarga e possíveis bloqueios
- A barra de progresso mostra o andamento em tempo real

### Os números não correspondem aos meus contatos (envio)
✅ **VERIFICADO**: Os números utilizados são exatamente os números inseridos (após sanitização). Nenhum número aleatório é gerado.

### Mensagens não estão sendo enviadas
- Verifique se está logado no WhatsApp Web
- Certifique-se de que os números são válidos
- Verifique as configurações de delay
- Veja os logs no console do navegador (F12)

### Campanha parou no meio
- Verifique a opção "Continuar em erros"
- Revise o número de retries
- Alguns números podem estar bloqueados ou inválidos

## 📝 Estrutura de Arquivos

```
ultimo/
├── manifest.json           # Configuração da extensão
├── content/
│   ├── content.js         # Script principal (DOM manipulation)
│   └── extractor.contacts.js  # Extrator de contatos
├── popup/
│   ├── popup.html         # Interface do popup
│   └── popup.js           # Lógica do popup
├── icons/                 # Ícones da extensão
├── VERIFICATION.md        # Checklist de verificação
└── README.md             # Este arquivo
```

## 🔍 Detalhes Técnicos

### Manipulação DOM
O sistema utiliza manipulação direta do DOM do WhatsApp Web para:
- Abrir chats sem recarregar a página
- Digitar mensagens com efeito de digitação
- Enviar mensagens e imagens
- Extrair contatos disponíveis

### Armazenamento
- Utiliza `chrome.storage.local` para persistência
- Estado da campanha é salvo continuamente
- Rascunhos podem ser salvos e carregados

### Comunicação
- Content script se comunica com popup via `chrome.runtime`
- Extrator usa `window.postMessage` para isolamento

## 📄 Licença

Este projeto é open source e está disponível sob a licença MIT.

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:
1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

## 📞 Suporte

Para reportar bugs ou solicitar features, abra uma issue no GitHub.

---

**Nota**: Esta extensão é para uso educacional e de automação pessoal. Use com responsabilidade e respeite os termos de serviço do WhatsApp.
