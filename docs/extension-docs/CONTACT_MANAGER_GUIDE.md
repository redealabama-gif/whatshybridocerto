# ContactManager - Guia de Uso

## 📇 Visão Geral

O **ContactManager** é um sistema completo de gerenciamento de contatos que integra os sistemas existentes do Axion:
- ContactImporter (importação Excel/CSV)
- Extractor v7 (extração de contatos)
- CRM Module (gerenciamento de negócios)

## 🎯 Recursos Principais

### ✅ Novos Recursos Implementados

- **Blacklist/Whitelist**: Bloqueio e permissão de números
- **Histórico de Interações**: Rastreamento completo de comunicações
- **Sistema de Tags**: Organização centralizada por categorias
- **Detecção de Inativos**: Identificação de contatos sem interação
- **Filtros Avançados**: Busca por múltiplos critérios

### 🔗 Integração com Sistemas Existentes

- Usa `normalizePhone()` compatível com os sistemas de validação existentes
- Sincroniza automaticamente com o CRM Module
- Persiste dados usando `chrome.storage.local`
- Registrado no `init.js` com prioridade 35 (antes do CRM)

## 📚 API Reference

### Inicialização

O ContactManager é inicializado automaticamente pelo `init.js`:

```javascript
// Já está disponível globalmente
const cm = window.ContactManager;

// Ou pode ser inicializado manualmente
await cm.initialize();
```

### Gerenciamento de Contatos

#### Adicionar Contato

```javascript
const contact = cm.addContact('11987654321', {
  name: 'João Silva',
  email: 'joao@example.com',
  tags: ['cliente', 'vip'],
  notes: 'Cliente preferencial',
  source: 'manual'
});
```

#### Obter Contato

```javascript
const contact = cm.getContact('5511987654321');
console.log(contact.name); // 'João Silva'
```

#### Atualizar Contato

```javascript
cm.updateContact('5511987654321', {
  name: 'João Silva Jr.',
  email: 'joao.jr@example.com'
});
```

#### Deletar Contato

```javascript
cm.deleteContact('5511987654321');
```

#### Listar Contatos com Paginação

```javascript
const result = cm.listContacts({
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc'
});

console.log(result.contacts); // Array de contatos
console.log(result.total); // Total de contatos
console.log(result.totalPages); // Total de páginas
```

### Blacklist e Whitelist

#### Blacklist (Bloquear)

```javascript
// Adicionar à blacklist
cm.addToBlacklist('5511999999999', 'Spam recorrente');

// Verificar se está na blacklist
if (cm.isBlacklisted('5511999999999')) {
  console.log('Número bloqueado');
}

// Remover da blacklist
cm.removeFromBlacklist('5511999999999');

// Listar todos os bloqueados
const blocked = cm.listBlacklist();
```

#### Whitelist (Permitir)

```javascript
// Adicionar à whitelist
cm.addToWhitelist('5511888888888');

// Remover da whitelist
cm.removeFromWhitelist('5511888888888');
```

### Sistema de Tags

```javascript
// Adicionar tag a um contato
cm.addTag('5511987654321', 'cliente');
cm.addTag('5511987654321', 'vip');

// Remover tag
cm.removeTag('5511987654321', 'vip');

// Listar todas as tags com contagem
const tags = cm.listTags();
// [{ tag: 'cliente', count: 25 }, { tag: 'vip', count: 10 }]

// Obter contatos por tag
const clientesVip = cm.getContactsByTag('vip');
```

### Histórico de Interações

```javascript
// Registrar uma interação
cm.recordInteraction('5511987654321', {
  type: 'message',
  direction: 'outgoing',
  content: 'Olá, como posso ajudar?',
  metadata: { campaignId: '123' }
});

// Obter histórico
const history = cm.getHistory('5511987654321', {
  limit: 50,
  type: 'message' // filtrar por tipo
});

// Limpar histórico
cm.clearHistory('5511987654321');
```

### Busca e Filtros

#### Busca Simples

```javascript
// Busca por texto em múltiplos campos
const results = cm.searchContacts('joão', {
  fields: ['name', 'phone', 'email', 'notes'],
  limit: 50
});
```

#### Filtros Avançados

```javascript
const filtered = cm.filterContacts({
  // Filtrar por tags
  tags: ['cliente', 'vip'],
  
  // Filtrar por data de criação
  createdAfter: Date.now() - (30 * 24 * 60 * 60 * 1000), // últimos 30 dias
  createdBefore: Date.now(),
  
  // Filtrar por última interação
  lastInteractionAfter: Date.now() - (7 * 24 * 60 * 60 * 1000), // última semana
  
  // Filtrar por contagem de mensagens
  minMessages: 5,
  maxMessages: 100,
  
  // Excluir blacklist (padrão: true)
  excludeBlacklist: true,
  
  // Apenas whitelist
  onlyWhitelist: false
});
```

#### Contatos Inativos

```javascript
// Contatos sem interação há mais de 30 dias
const inativos = cm.getInactiveContacts(30);

console.log(`${inativos.length} contatos inativos`);
```

### Importação e Exportação

#### Importar CSV

```javascript
const csvContent = `
phone,name,email,tags
5511987654321,João Silva,joao@example.com,cliente;vip
5511888888888,Maria Santos,maria@example.com,cliente
`;

const result = await cm.importFromCSV(csvContent, {
  skipHeader: true,
  phoneColumn: 0,
  nameColumn: 1,
  emailColumn: 2,
  tagColumn: 3,
  delimiter: ',',
  merge: true // mesclar com existentes
});

console.log(`Importados: ${result.imported}`);
console.log(`Duplicados: ${result.duplicates}`);
console.log(`Ignorados: ${result.skipped}`);
```

#### Importar JSON

```javascript
const jsonData = [
  {
    phone: '5511987654321',
    name: 'João Silva',
    email: 'joao@example.com',
    tags: ['cliente', 'vip']
  }
];

const result = await cm.importFromJSON(jsonData);
```

#### Exportar CSV

```javascript
// Exportar todos os contatos
const csv = cm.exportToCSV();

// Exportar com filtros
const csvFiltered = cm.exportToCSV({
  tags: ['cliente'],
  excludeBlacklist: true
});

// Criar download
const blob = new Blob([csv], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'contatos.csv';
a.click();
```

#### Exportar JSON

```javascript
const json = cm.exportToJSON();
console.log(json);
```

### Sincronização com CRM

```javascript
// Sincronizar com CRM manualmente
const result = await cm.syncWithCRM();
console.log(`Sincronizados: ${result.synced} contatos`);

// Iniciar sincronização automática (a cada 5 minutos)
cm.startAutoSync();

// Parar sincronização automática
cm.stopAutoSync();
```

### Estatísticas

```javascript
const stats = cm.getStats();
console.log(stats);
// {
//   totalContacts: 150,
//   blacklisted: 5,
//   whitelisted: 20,
//   totalTags: 8,
//   withHistory: 120
// }
```

## 🔧 Configuração

Você pode modificar a configuração do ContactManager:

```javascript
cm.config.autoSync = true; // Ativar/desativar auto-sync
cm.config.syncInterval = 300000; // Intervalo de sync (5 minutos)
cm.config.maxHistory = 100; // Máximo de registros de histórico por contato
cm.config.deduplicateOnImport = true; // Remover duplicados ao importar
```

## 🎯 Casos de Uso

### 1. Importar Lista e Bloquear Spammers

```javascript
// Importar lista
await cm.importFromCSV(csvContent);

// Identificar números com muitas mensagens mas sem resposta
const spam = cm.filterContacts({
  minMessages: 50,
  lastInteractionBefore: Date.now() - (60 * 24 * 60 * 60 * 1000) // 60 dias
});

// Adicionar à blacklist
spam.forEach(contact => {
  cm.addToBlacklist(contact.phone, 'Sem resposta há 60 dias');
});
```

### 2. Identificar Clientes VIP Inativos

```javascript
// Buscar clientes VIP sem interação recente
const vipInativos = cm.filterContacts({
  tags: ['vip'],
  lastInteractionBefore: Date.now() - (15 * 24 * 60 * 60 * 1000) // 15 dias
});

console.log(`${vipInativos.length} clientes VIP precisam de atenção`);
```

### 3. Exportar Relatório de Clientes Ativos

```javascript
const ativos = cm.filterContacts({
  lastInteractionAfter: Date.now() - (30 * 24 * 60 * 60 * 1000),
  minMessages: 3,
  excludeBlacklist: true
});

const csv = cm.exportToCSV({ 
  lastInteractionAfter: Date.now() - (30 * 24 * 60 * 60 * 1000),
  minMessages: 3
});

// Download do relatório
const blob = new Blob([csv], { type: 'text/csv' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `clientes-ativos-${new Date().toISOString().split('T')[0]}.csv`;
a.click();
```

## 🧪 Testes

Execute os testes no console do WhatsApp Web:

```javascript
// Carregar e executar testes
const script = document.createElement('script');
script.src = chrome.runtime.getURL('tests/contact-manager.test.js');
document.head.appendChild(script);
```

## 📝 Notas Importantes

1. **Normalização de Telefones**: Todos os números são automaticamente normalizados para o formato brasileiro com DDD 55
2. **Persistência**: Dados são salvos automaticamente no `chrome.storage.local`
3. **Limites**: O histórico é limitado a 100 registros por contato (configurável)
4. **Performance**: Use paginação ao listar muitos contatos
5. **Sincronização**: A sincronização com CRM é automática se `config.autoSync = true`

## 🔗 Integração com Sistemas Existentes

O ContactManager se integra perfeitamente com:

- **ContactImporter**: Use para importação avançada de Excel
- **Extractor v7**: Use para extrair contatos do WhatsApp
- **CRM Module**: Sincronização automática bidirecional
- **EventBus**: Emite eventos de mudanças (futuro)

## 🐛 Troubleshooting

### ContactManager não está definido

Verifique se o módulo está carregado no manifest.json e init.js.

### Dados não estão sendo salvos

Verifique as permissões do `chrome.storage` no manifest.json.

### Sincronização com CRM não funciona

Verifique se o CRMModule está carregado: `window.CRMModule`

## 📄 Licença

Parte do Axion v7.7.0
