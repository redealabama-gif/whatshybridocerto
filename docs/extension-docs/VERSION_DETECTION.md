# 🔍 Sistema de Detecção de Versão do WhatsApp Web

## Visão Geral

O sistema de detecção de versão do WhatsApp Web foi implementado para garantir compatibilidade contínua da extensão WhatsHybrid com diferentes versões do WhatsApp Web. O sistema detecta automaticamente a versão em uso e adapta os seletores DOM conforme necessário.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                     SISTEMA DE VERSÃO                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐      ┌─────────────────────┐          │
│  │  VERSION DETECTOR   │      │ COMPATIBILITY MGR   │          │
│  │                     │      │                     │          │
│  │ • Detecta versão    │ ───▶ │ • Repara seletores  │          │
│  │ • Via webpack       │      │ • Health check      │          │
│  │ • Via fingerprints  │      │ • Auto-discovery    │          │
│  │ • Via meta tags     │      │ • Emergency fallback│          │
│  └─────────────────────┘      └─────────────────────┘          │
│            │                            │                       │
│            ▼                            ▼                       │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    SELETORES ATIVOS                        │ │
│  │  • MESSAGE_INPUT    • SEND_BUTTON    • CHAT_LIST          │ │
│  │  • ATTACH_BUTTON    • CAPTION_INPUT  • CHAT_HEADER        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                  │
│                              ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    CONTENT SCRIPTS                         │ │
│  │              (usam seletores adaptativos)                  │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Componentes

### 1. Version Detector (`version-detector.js`)

#### Métodos de Detecção

| Método | Precisão | Descrição |
|--------|----------|-----------|
| Webpack | 95% | Acessa módulos internos do WhatsApp via `webpackChunkwhatsapp_web_client` |
| Meta Tags | 80% | Analisa meta tags e scripts da página |
| Fingerprints | 60% | Usa seletores únicos de cada versão |
| Storage | 50% | Verifica localStorage do WhatsApp |

#### Exemplo de Uso

```javascript
// Inicializar detector
await WHL_VersionDetector.init();

// Obter versão atual
const version = WHL_VersionDetector.getVersion();
console.log('WhatsApp Web versão:', version);

// Obter informações completas
const info = WHL_VersionDetector.getVersionInfo();
console.log({
  version: info.version,
  detectedAt: new Date(info.detectedAt),
  buildHash: info.buildHash
});

// Escutar mudanças de versão
WHL_VersionDetector.onVersionChange((detection) => {
  console.log('Versão mudou para:', detection.version);
  console.log('Método de detecção:', detection.method);
  console.log('Confiança:', detection.confidence + '%');
});

// Obter seletor para elemento
const input = WHL_VersionDetector.getElement('MESSAGE_INPUT');
if (input) {
  input.focus();
}

// Testar saúde dos seletores
const health = await WHL_VersionDetector.testSelectorHealth();
console.log('Seletores funcionando:', health.working.length);
console.log('Seletores quebrados:', health.broken.length);
```

### 2. Compatibility Manager (`compatibility-manager.js`)

#### Funcionalidades

- **Auto-reparo de seletores**: Detecta e corrige automaticamente seletores quebrados
- **Descoberta dinâmica**: Analisa o DOM para encontrar novos seletores
- **Seletores de emergência**: Fallbacks genéricos que funcionam em múltiplas versões
- **Health check periódico**: Verifica integridade a cada 30 segundos

#### Exemplo de Uso

```javascript
// Inicializar gerenciador
await WHL_CompatibilityManager.init();

// Verificar e reparar seletores
const result = await WHL_CompatibilityManager.checkAndRepair();

// Ver seletores reparados
const repaired = WHL_CompatibilityManager.getRepairedSelectors();
console.log('Seletores reparados:', repaired);

// Ver seletores quebrados
const broken = WHL_CompatibilityManager.getBrokenSelectors();
console.log('Seletores ainda quebrados:', broken);

// Descobrir seletor dinamicamente
const selector = WHL_CompatibilityManager.discoverSelector('MESSAGE_INPUT');
console.log('Seletor descoberto:', selector);

// Ver estatísticas
const stats = WHL_CompatibilityManager.getStats();
console.log({
  totalChecks: stats.totalChecks,
  breaksDetected: stats.breaksDetected,
  successfulRepairs: stats.successfulRepairs
});

// Configurar
WHL_CompatibilityManager.setConfig('AUTO_REPAIR', true);
WHL_CompatibilityManager.setConfig('HEALTH_CHECK_INTERVAL', 60000);
```

## Seletores por Versão

### Versão Latest (2.3000+)

```javascript
{
  MESSAGE_INPUT: [
    '[data-testid="conversation-compose-box-input"]',
    'footer div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[data-tab="10"]'
  ],
  SEND_BUTTON: [
    '[data-testid="send"]',
    '[data-testid="compose-btn-send"]',
    'button[aria-label="Enviar"]',
    'span[data-icon="send"]'
  ],
  // ... outros seletores
}
```

### Versão 2.2300 (Junho 2023)

```javascript
{
  MESSAGE_INPUT: [
    'div[data-tab="10"]',
    'footer div[contenteditable="true"]'
  ],
  SEND_BUTTON: [
    'span[data-icon="send"]',
    '[data-testid="send"]'
  ]
}
```

### Seletores de Emergência

```javascript
{
  MESSAGE_INPUT: [
    '[contenteditable="true"][role="textbox"]',
    'footer [contenteditable="true"]',
    '#main footer div[contenteditable]'
  ],
  SEND_BUTTON: [
    '[data-icon="send"]',
    'span[data-icon="send"]',
    'footer button:last-child'
  ]
}
```

## Eventos

### Version Detector

| Evento | Descrição | Dados |
|--------|-----------|-------|
| `whl-version-change` | Versão detectada/mudou | `{ version, method, confidence, details }` |
| `whl-selector-health-issue` | Saúde crítica (<70%) | `{ working, broken, timestamp }` |

### Compatibility Manager

| Evento | Descrição | Dados |
|--------|-----------|-------|
| `whl-selector-repair` | Seletores reparados | `{ repaired, failed, details }` |
| `whl-persistent-break` | Quebra não reparável | `{ broken, suggestion }` |

#### Exemplo de Listener

```javascript
window.addEventListener('whl-version-change', (event) => {
  const { version, method, confidence } = event.detail;
  console.log(`Nova versão: ${version} (${method}, ${confidence}%)`);
});

window.addEventListener('whl-selector-repair', (event) => {
  const { repaired, failed } = event.detail;
  console.log(`Reparados: ${repaired}, Falharam: ${failed}`);
});
```

## Algoritmo de Descoberta de Seletores

### MESSAGE_INPUT

1. Procurar `contenteditable` no `<footer>`
2. Procurar `role="textbox"` visível
3. Analisar elementos na parte inferior da tela (>70% altura)
4. Verificar tamanho razoável (largura > 200px)

### SEND_BUTTON

1. Procurar ícone `data-icon="send"`
2. Procurar botões no footer, lado direito
3. Procurar por `aria-label` contendo "nviar" ou "end"

### CHAT_LIST

1. Procurar `#pane-side` (ID conhecido)
2. Procurar `role="listbox"` à esquerda
3. Procurar estrutura de dois painéis

## Fluxo de Reparo Automático

```
┌─────────────────┐
│ Health Check    │
│ (a cada 30s)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Seletores OK?   │────▶│ Continuar       │
└────────┬────────┘ Sim └─────────────────┘
         │ Não
         ▼
┌─────────────────┐
│ Tentar Seletores│
│ de Emergência   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Funcionou?      │────▶│ Atualizar       │
└────────┬────────┘ Sim │ Seletores Ativos│
         │ Não          └─────────────────┘
         ▼
┌─────────────────┐
│ Descoberta      │
│ Dinâmica DOM    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Funcionou?      │────▶│ Atualizar e     │
└────────┬────────┘ Sim │ Notificar       │
         │ Não          └─────────────────┘
         ▼
┌─────────────────┐
│ Notificar       │
│ Quebra Persistente│
└─────────────────┘
```

## Configurações

```javascript
const CONFIG = {
  AUTO_REPAIR: true,           // Reparar automaticamente
  NOTIFY_BREAKS: true,         // Notificar quebras
  FALLBACK_ENABLED: true,      // Usar seletores de emergência
  HEALTH_CHECK_INTERVAL: 30000, // 30 segundos
  REPAIR_COOLDOWN: 60000,      // 1 minuto entre reparos
  MAX_REPAIR_ATTEMPTS: 3       // Máximo de tentativas
};

// Alterar configuração
WHL_CompatibilityManager.setConfig('HEALTH_CHECK_INTERVAL', 60000);
```

## Manutenção

### Adicionar Nova Versão

1. Identificar seletores que mudaram
2. Adicionar entrada em `VERSION_SELECTORS`:

```javascript
VERSION_SELECTORS['2.3100'] = {
  MESSAGE_INPUT: [
    '[data-testid="novo-seletor"]',
    // ... outros seletores
  ]
};
```

3. Adicionar fingerprint em `VERSION_FINGERPRINTS`:

```javascript
VERSION_FINGERPRINTS.unshift({
  version: '2.3100+',
  selectors: ['[data-testid="elemento-unico-2.3100"]'],
  minMatches: 1
});
```

### Debug

```javascript
// Ativar logs de debug
localStorage.setItem('whl_debug', 'true');

// Ver estado completo
console.log(WHL_VersionDetector.getState());
console.log(WHL_CompatibilityManager.getState());

// Forçar re-detecção
await WHL_VersionDetector.detectVersion();

// Forçar verificação de saúde
await WHL_VersionDetector.testSelectorHealth();
```

## Limitações Conhecidas

1. **Webpack não acessível**: Em algumas versões, o webpack pode estar protegido
2. **CSP restritivo**: Content Security Policy pode bloquear algumas operações
3. **Mudanças drásticas**: Grandes mudanças de UI podem exigir atualização manual
4. **Tempo de detecção**: Detecção inicial leva ~2 segundos após carregamento

## Troubleshooting

### "Seletores não funcionando"

1. Verificar se WhatsApp Web carregou completamente
2. Executar `WHL_CompatibilityManager.checkAndRepair()`
3. Verificar `WHL_VersionDetector.testSelectorHealth()`
4. Analisar eventos `whl-selector-repair`

### "Versão não detectada"

1. Verificar console para erros
2. Tentar `WHL_VersionDetector.detectVersion()` manualmente
3. Verificar se página está em `web.whatsapp.com`

### "Reparo falha repetidamente"

1. WhatsApp Web pode ter mudado significativamente
2. Verificar se há nova versão da extensão
3. Reportar issue com os seletores quebrados

## API Completa

### WHL_VersionDetector

| Método | Retorno | Descrição |
|--------|---------|-----------|
| `init()` | `Promise<Object>` | Inicializa detector |
| `detectVersion()` | `Promise<Object>` | Detecta versão atual |
| `getVersion()` | `string` | Retorna versão atual |
| `getVersionInfo()` | `Object` | Info completa de versão |
| `getActiveSelectors()` | `Object` | Seletores ativos |
| `getElement(name)` | `Element\|null` | Obtém elemento por nome |
| `getWorkingSelector(name)` | `string\|null` | Seletor funcional |
| `testSelectorHealth()` | `Promise<Object>` | Testa todos seletores |
| `onVersionChange(cb)` | `void` | Registra listener |
| `offVersionChange(cb)` | `void` | Remove listener |
| `startMonitoring()` | `void` | Inicia monitoramento |
| `stopMonitoring()` | `void` | Para monitoramento |

### WHL_CompatibilityManager

| Método | Retorno | Descrição |
|--------|---------|-----------|
| `init()` | `Promise<void>` | Inicializa gerenciador |
| `checkAndRepair()` | `Promise<Object>` | Verifica e repara |
| `discoverSelector(name)` | `string\|null` | Descobre seletor |
| `getRepairedSelectors()` | `Object` | Seletores reparados |
| `getBrokenSelectors()` | `Array` | Seletores quebrados |
| `getStats()` | `Object` | Estatísticas |
| `setConfig(key, value)` | `void` | Altera configuração |
| `startHealthCheck()` | `void` | Inicia verificação |
| `stopHealthCheck()` | `void` | Para verificação |
