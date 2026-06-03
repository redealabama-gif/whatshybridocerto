# 🎯 Sistema de Escalonamento e SLA - Documentação Completa

## 📋 Visão Geral

O Sistema de Escalonamento e SLA do WhatsHybrid é uma solução completa para gerenciamento de atendimento humano, com tracking de SLA, fila priorizada de tickets, regras configuráveis, e métricas detalhadas.

## 🏗️ Arquitetura

O sistema é composto por 3 módulos principais:

### 1. `escalation-system.js` - Sistema Principal
- **Classe**: `EscalationSystem`
- **Funcionalidade**: Gerenciamento completo de tickets, SLA, agentes, regras e webhooks
- **Acesso Global**: `window.escalationSystem`

### 2. `escalation-integration.js` - Integração com SmartBot IA
- **Funcionalidade**: Conecta o sistema de escalation com o SmartBot IA para escalação automática
- **Acesso Global**: `window.escalationIntegration`

### 3. `escalation-system.test.js` - Testes
- **Funcionalidade**: 20 casos de teste para validação do sistema
- **Execução**: No console do navegador na página do WhatsApp Web

## 🚀 Recursos Principais

### ✅ Gerenciamento de Tickets
- Criação automática e manual de tickets
- Estados: `open`, `assigned`, `in_progress`, `resolved`, `closed`
- Prioridades: `urgent`, `high`, `medium`, `low`
- Histórico completo de mudanças
- Contexto e tags customizáveis

### ⏱️ Tracking de SLA
- Configuração por prioridade:
  - **Urgent**: 5min resposta / 30min resolução
  - **High**: 15min resposta / 60min resolução
  - **Medium**: 30min resposta / 120min resolução
  - **Low**: 60min resposta / 240min resolução
- Monitoramento automático a cada minuto
- Alertas de violação de SLA
- Métricas de tempo real

### 🎯 Regras de Escalonamento
- Sistema de regras configurável
- Condições suportadas:
  - Sentimento (positive/negative/neutral)
  - Intenção (complaint, inquiry, etc)
  - Urgência (high/medium/low)
  - Confiança do bot
  - Palavras-chave
  - Horário comercial
- Ações suportadas:
  - Escalar automaticamente
  - Atribuir a agente específico
  - Adicionar tags
  - Enviar notificações
  - Definir prioridade

### 👥 Gerenciamento de Agentes
- Registro de agentes com skills
- Status: `available`, `busy`, `away`, `offline`
- Capacidade configurável (max tickets simultâneos)
- Auto-atribuição inteligente por carga
- Estatísticas por agente

### 📊 Métricas e Relatórios
- Total de tickets escalados
- Total de tickets resolvidos
- Tempo médio de resposta
- Tempo médio de resolução
- Taxa de violação de SLA
- Estatísticas por período (hora/dia/semana/mês)
- Breakdown por prioridade

### 🔔 Notificações e Webhooks
- Notificações no navegador
- Webhooks HTTP para eventos:
  - `new_ticket` - Novo ticket criado
  - `ticket_assigned` - Ticket atribuído
  - `ticket_resolved` - Ticket resolvido
  - `sla_breach` - Violação de SLA
  - `all` - Todos os eventos
- Payload JSON completo

## 📖 API de Uso

### Inicialização

O sistema é inicializado automaticamente quando a extensão carrega:

```javascript
// Sistema principal
const escalation = window.escalationSystem;

// Integração
const integration = window.escalationIntegration;
```

### Criar Ticket Manualmente

```javascript
const ticket = escalation.createTicket({
  chatId: 'chat-id-123',
  phone: '5511999999999',
  customerName: 'João Silva',
  reason: 'Cliente insatisfeito com produto',
  priority: 'high',
  messages: [/* array de mensagens */],
  context: {
    sentiment: { sentiment: 'negative', score: 0.2 },
    intent: { primaryIntent: 'complaint' },
    urgency: { level: 'high' }
  },
  tags: ['produto', 'insatisfacao']
});

console.log('Ticket criado:', ticket.id);
```

### Escalar Mensagem Automaticamente

```javascript
const analysis = {
  sentiment: { sentiment: 'negative', score: 0.3 },
  intent: { primaryIntent: 'complaint' },
  urgency: { level: 'high' },
  confidence: 45,
  escalationReason: 'Cliente muito insatisfeito'
};

const message = {
  chatId: 'chat-123',
  phone: '5511999999999',
  text: 'Estou muito decepcionado!',
  senderName: 'Cliente',
  timestamp: Date.now()
};

const ticket = await escalation.escalateMessage(message, analysis);
```

### Gerenciar Tickets

```javascript
// Atribuir a um agente
escalation.assignTicket(ticket.id, 'agent-123');

// Registrar primeira resposta
escalation.recordFirstResponse(ticket.id, 'agent-123');

// Resolver ticket
escalation.resolveTicket(ticket.id, 'Problema resolvido com sucesso', 'agent-123');

// Fechar ticket
escalation.closeTicket(ticket.id, 'Cliente satisfeito');

// Reabrir ticket
escalation.reopenTicket(ticket.id, 'Cliente retornou com dúvida');
```

### Gerenciar Agentes

```javascript
// Registrar agente
const agent = escalation.registerAgent({
  name: 'Maria Souza',
  email: 'maria@example.com',
  maxLoad: 10,
  skills: ['atendimento', 'vendas', 'suporte']
});

// Atualizar status
escalation.updateAgentStatus(agent.id, 'available');

// Listar agentes disponíveis
const available = escalation.getAvailableAgents();

// Obter carga de trabalho
const load = escalation.getAgentLoad(agent.id);
```

### Configurar Regras

```javascript
// Adicionar regra customizada
const rule = escalation.addRule({
  name: 'VIP com urgência',
  conditions: [
    { type: 'urgency', value: 'high' },
    { type: 'keyword', value: 'VIP' }
  ],
  actions: [
    { type: 'escalate', reason: 'Cliente VIP com urgência' },
    { type: 'priority', priority: 'urgent' },
    { type: 'tag', tags: ['vip', 'urgente'] }
  ],
  priority: 100,
  enabled: true
});
```

### Configurar Webhooks

```javascript
// Adicionar webhook
const webhook = escalation.addWebhook(
  'https://api.example.com/escalation-webhook',
  ['new_ticket', 'sla_breach']
);

// Webhook receberá payload JSON:
{
  "event": "new_ticket",
  "message": "🎫 Novo ticket: Cliente insatisfeito",
  "data": {
    "ticket": { /* objeto ticket completo */ }
  },
  "timestamp": 1704391234567
}
```

### Obter Estatísticas

```javascript
// Estatísticas do dia
const stats = escalation.getStats('day');

console.log('Estatísticas:', {
  total: stats.total,
  open: stats.open,
  resolved: stats.resolved,
  slaBreaches: stats.slaBreaches,
  avgResponseTime: stats.avgResponseTime,
  avgResolutionTime: stats.avgResolutionTime,
  byPriority: stats.byPriority
});

// Períodos disponíveis: 'hour', 'day', 'week', 'month'
```

### Listar e Filtrar Tickets

```javascript
// Todos os tickets abertos
const openTickets = escalation.listTickets({ status: 'open' });

// Tickets urgentes
const urgentTickets = escalation.listTickets({ priority: 'urgent' });

// Tickets de um agente
const agentTickets = escalation.listTickets({ assignedTo: 'agent-123' });

// Tickets com SLA violado
const breachedTickets = escalation.listTickets({ slaBreached: true });

// Resultados são ordenados por prioridade e data
```

## 🔗 API de Integração

### Verificar Auto-Escalation

```javascript
const message = {
  chatId: 'chat-123',
  phone: '5511999999999',
  text: 'Mensagem do cliente',
  senderName: 'Cliente',
  timestamp: Date.now()
};

const analysis = {
  sentiment: { sentiment: 'negative', score: 0.3 },
  urgency: { level: 'high' },
  confidence: 40
};

// Verifica se deve escalar
const ticket = await integration.checkEscalation(message, analysis);

if (ticket) {
  console.log('Ticket criado automaticamente:', ticket.id);
}
```

### Forçar Escalation

```javascript
// Forçar escalation de uma conversa
const ticket = await integration.forceEscalate(
  'chat-123',
  'Solicitação do gerente'
);
```

### Status de Escalation

```javascript
// Obter status de escalation para um chat
const status = integration.getEscalationStatus('chat-123');

if (status.hasActiveTicket) {
  console.log('Ticket ativo:', status.ticket.id);
  console.log('Status:', status.status);
  console.log('Prioridade:', status.priority);
  console.log('Agente:', status.assignedTo);
  console.log('SLA:', status.slaStatus);
}
```

### Estatísticas Integradas

```javascript
// Obter estatísticas combinadas de escalation e SmartBot
const stats = integration.getStats('day');

console.log('Escalation:', stats.escalation);
console.log('SmartBot:', stats.smartBot);
```

## 🎨 Regras Padrão

O sistema vem com 3 regras padrão pré-configuradas:

### 1. Reclamação Urgente (Prioridade: 100)
```javascript
{
  conditions: [
    { type: 'intent', value: 'complaint' },
    { type: 'urgency', value: 'high' }
  ],
  actions: [
    { type: 'escalate', reason: 'Reclamação urgente detectada' },
    { type: 'priority', priority: 'urgent' }
  ]
}
```

### 2. Sentimento Muito Negativo (Prioridade: 90)
```javascript
{
  conditions: [
    { type: 'sentiment', value: 'negative' },
    { type: 'confidence_below', value: 50 }
  ],
  actions: [
    { type: 'escalate', reason: 'Cliente insatisfeito' },
    { type: 'priority', priority: 'high' }
  ]
}
```

### 3. Fora do Horário Comercial (Prioridade: 50)
```javascript
{
  conditions: [
    { type: 'time_range', start: 20, end: 8 }
  ],
  actions: [
    { type: 'escalate', reason: 'Mensagem fora do horário' },
    { type: 'priority', priority: 'low' }
  ]
}
```

## 💾 Persistência

Todos os dados são salvos automaticamente no Chrome Storage:

- **escalation_queue**: Fila de tickets
- **escalation_metrics**: Métricas agregadas
- **escalation_rules**: Regras customizadas
- **escalation_agents**: Dados dos agentes
- **escalation_webhooks**: Webhooks configurados

## 🧪 Testes

Execute os testes no console do navegador:

```javascript
// Carregar e executar testes
const script = document.createElement('script');
script.src = chrome.runtime.getURL('tests/escalation-system.test.js');
document.head.appendChild(script);
```

Os testes validam:
- Criação de instância
- Criação de tickets
- Determinação de prioridade
- Extração de tags
- Registro de agentes
- Atribuição de tickets
- Regras de escalation
- Webhooks
- Resolução e fechamento
- Métricas e estatísticas

## 📈 Exemplo de Workflow Completo

```javascript
// 1. Registrar agentes
const agent1 = escalation.registerAgent({
  name: 'João',
  email: 'joao@example.com',
  maxLoad: 5,
  skills: ['atendimento', 'suporte']
});

const agent2 = escalation.registerAgent({
  name: 'Maria',
  email: 'maria@example.com',
  maxLoad: 8,
  skills: ['vendas', 'atendimento']
});

// 2. Configurar webhook
escalation.addWebhook(
  'https://api.example.com/escalation',
  ['all']
);

// 3. Adicionar regra customizada
escalation.addRule({
  name: 'Cliente irritado mencionando cancelamento',
  conditions: [
    { type: 'sentiment', value: 'negative' },
    { type: 'keyword', value: 'cancelar' }
  ],
  actions: [
    { type: 'escalate', reason: 'Risco de churn' },
    { type: 'priority', priority: 'urgent' },
    { type: 'tag', tags: ['churn-risk'] }
  ],
  priority: 95
});

// 4. Mensagem chega e é analisada pelo SmartBot
// (Integração automática faz o resto)

// 5. Verificar tickets ativos
const activeTickets = escalation.listTickets({ 
  status: 'open' 
});

// 6. Obter estatísticas
const stats = escalation.getStats('day');
console.log(`${stats.total} tickets hoje`);
console.log(`${stats.slaBreaches} violações de SLA`);
console.log(`Tempo médio de resposta: ${Math.round(stats.avgResponseTime/1000)}s`);

// 7. Resolver ticket manualmente se necessário
escalation.resolveTicket(
  'TKT-123-ABC456',
  'Problema resolvido com reembolso',
  agent1.id
);
```

## 🔧 Troubleshooting

### Sistema não inicializa
```javascript
// Verificar se o módulo foi carregado
console.log('EscalationSystem:', typeof window.EscalationSystem);
console.log('escalationSystem:', window.escalationSystem);

// Forçar reinicialização
if (window.EscalationSystem && !window.escalationSystem) {
  window.escalationSystem = new window.EscalationSystem();
  await window.escalationSystem.initialize();
}
```

### Regras não estão funcionando
```javascript
// Listar regras ativas
console.log('Regras:', escalation.rules);

// Testar condições manualmente
const message = { text: 'teste cancelar', chatId: '123' };
const analysis = { sentiment: { sentiment: 'negative' } };
const result = escalation.evaluateRules(message, analysis);
console.log('Resultado:', result);
```

### SLA não está sendo monitorado
```javascript
// Verificar se monitor está ativo
console.log('SLA Monitor ativo:', !!escalation.slaMonitorInterval);

// Reiniciar monitor
escalation.startSLAMonitor();

// Forçar verificação imediata
escalation.checkSLABreaches();
```

## 🎯 Melhores Práticas

1. **Configure SLAs apropriados** para seu tipo de negócio
2. **Registre agentes** antes de ativar o sistema
3. **Customize regras** para seu caso de uso específico
4. **Configure webhooks** para integração com sistemas externos
5. **Monitore métricas** regularmente para otimizar atendimento
6. **Revise tickets resolvidos** para aprender e melhorar regras
7. **Mantenha agentes atualizados** com skills corretas
8. **Use tags** para categorizar e filtrar tickets

## 📞 Suporte

Para mais informações ou suporte, consulte a documentação principal do WhatsHybrid Pro.

---

**Versão**: 1.0.0  
**Última atualização**: Janeiro 2026  
**Módulos**: escalation-system.js, escalation-integration.js
