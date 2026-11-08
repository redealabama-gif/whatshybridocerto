# Inventário de IA — grafo de carregamento (extensão)

Gerado por `node audit/scripts/inventario-ia.js` em 2026-11-08T19:01:57.080Z.

- Arquivos de IA encontrados: **69** · carregados em algum runtime: **53** · sem nenhum carregamento: **16**
- Fontes de carregamento consideradas: core/content/advanced (build-manifest.json), sidepanel.html (57 scripts), training/training.html, importScripts do service worker, manifest content_scripts, scripts injetados no page world, lazy-loader (copilot-engine, ai-suggestion-fixed, knowledge-base, few-shot-learning, campaign-manager, automation-engine, crm, analytics, business-intelligence, recover-advanced, recover-dom, text-to-speech, audio-sender, document-sender, team-system, escalation-system, training-debug-tools, training-stats).
- "Referenciado por" = arquivos **que rodam** que mencionam um global definido pelo arquivo.

| Arquivo | Linhas | Carregado em | Globais definidos | Referenciado por (runtime) |
|---|---:|---|---|---|
| `adapters/legacy-smartbot.js` | 30 | advanced-bundle, sidepanel.html | `SmartBot` `SmartBotIA` `SmartBotExtended` `SmartBotAIPlus` | modules/copilot-engine.js<br>modules/escalation-integration.js |
| `background/ai-handlers.js` | 530 | service-worker | — | — |
| `modules/advanced/autonomous-learning.js` | 296 | advanced-bundle | `WHLAutonomousLearning` | — |
| `modules/ai-ab-testing.js` | 222 | **⚫ nenhum** | `ResponseABTester` | — |
| `modules/ai-analytics-collector.js` | 230 | **⚫ nenhum** | `AIAnalyticsCollector` | — |
| `modules/ai-analytics.js` | 639 | advanced-bundle, sidepanel.html | `AIAnalytics` `aiAnalytics` | (por nome) modules/optimizations/smart-cache.js |
| `modules/ai-auto-learner.js` | 773 | content-bundle, sidepanel.html | `AIAutoLearner` `aiAutoLearner` | — |
| `modules/ai-backend-handlers.js` | 1390 | sidepanel.html | `_lastAnalyzedMessage` `_currentSuggestions` `rateSuggestion` `editSuggestion` `nextSuggestion` | modules/ai-suggestion-fixed.js<br>sidepanel-router.js |
| `modules/ai-conversation-memory.js` | 594 | **⚫ nenhum** | `ConversationMemory` `conversationMemory` | modules/ai-suggestion-fixed.js |
| `modules/ai-dynamic-prompt.js` | 587 | **⚫ nenhum** | `DynamicPromptBuilder` | modules/ai-suggestion-fixed.js |
| `modules/ai-embedding-provider.js` | 543 | **⚫ nenhum** | `EmbeddingProvider` | — |
| `modules/ai-feedback-system.js` | 623 | content-bundle, sidepanel.html | `AIFeedbackSystem` `aiFeedbackSystem` | modules/ai-analytics.js |
| `modules/ai-gateway.js` | 1644 | content-bundle | `AIGateway` | background/ai-handlers.js<br>modules/ai-service.js<br>modules/ai-suggestion-fixed.js<br>modules/anti-break-system.js<br>modules/api-config.js<br>modules/copilot-engine.js<br>(+2) |
| `modules/ai-hybrid-intent.js` | 521 | **⚫ nenhum** | `HybridIntentClassifier` | modules/ai-suggestion-fixed.js |
| `modules/ai-hybrid-search.js` | 707 | **⚫ nenhum** | `HybridSearch` | modules/ai-suggestion-fixed.js |
| `modules/ai-memory-advanced.js` | 803 | content-bundle, sidepanel.html | `AIMemoryAdvanced` `aiMemoryAdvanced` | modules/ai-suggestion-fixed.js<br>modules/copilot-engine.js |
| `modules/ai-response-cache.js` | 513 | content-bundle, sidepanel.html | `AIResponseCache` `aiResponseCache` | modules/optimizations/smart-cache.js<br>modules/ai-analytics.js<br>modules/ai-suggestion-fixed.js<br>modules/copilot-engine.js |
| `modules/ai-safety-filter.js` | 335 | content-bundle | `ResponseSafetyFilter` `aiSafetyFilter` | modules/ai-suggestion-fixed.js |
| `modules/ai-service.js` | 1209 | content-bundle, sidepanel.html | `AIService` | modules/ai-backend-handlers.js<br>modules/ai-gateway.js<br>modules/ai-suggestion-fixed.js<br>modules/copilot-engine.js<br>modules/graceful-degradation.js<br>modules/init.js<br>(+9) |
| `modules/ai-suggestion-fixed.js` | 2189 | advanced-bundle, lazy-loader (page world via <script>) | `WHLAIComponents` `AISuggestionFixed` | modules/init.js<br>modules/optimizations/lazy-loader.js |
| `modules/ai-validated-learning.js` | 501 | **⚫ nenhum** | `ValidatedLearningPipeline` | modules/ai-gateway.js<br>modules/ai-suggestion-fixed.js<br>modules/copilot-engine.js |
| `modules/automation-engine.js` | 1203 | advanced-bundle, lazy-loader (page world via <script>) | `AutomationEngine` | — |
| `modules/autopilot-handlers.js` | 655 | sidepanel.html | `APHandlers` | (por nome) modules/smartbot-autopilot-v2.js |
| `modules/backend-client.js` | 1357 | content-bundle, sidepanel.html, training.html | `BackendClient` | modules/ai-backend-handlers.js<br>modules/ai-memory-advanced.js<br>modules/ai-service.js<br>modules/ai-suggestion-fixed.js<br>modules/campaign-manager.js<br>modules/data-sync-manager.js<br>(+13) |
| `modules/backend-singleton.js` | 58 | **⚫ nenhum** | `BackendSingleton` | modules/campaign-manager.js |
| `modules/confidence-system.js` | 1094 | content-bundle, sidepanel.html | `ConfidenceSystem` `confidenceSystem` | background/ai-handlers.js<br>modules/ai-backend-handlers.js<br>modules/ai-suggestion-fixed.js<br>modules/quality/confidence-granular.js<br>modules/smartbot-autopilot-v2.js<br>modules/suggestion-injector.js<br>(+5) |
| `modules/copilot-engine.js` | 2888 | content-bundle, sidepanel.html, lazy-loader (page world via <script>) | `CopilotEngine` | adapters/legacy-smartbot.js<br>content/content-parts/10-other-listeners.js<br>modules/ai-backend-handlers.js<br>modules/ai-service.js<br>modules/ai-suggestion-fixed.js<br>modules/anti-break-system.js<br>(+16) |
| `modules/data-sync-manager.js` | 848 | content-bundle | `DataSyncManager` | modules/ai-memory-advanced.js<br>modules/anti-break-system.js<br>modules/scheduler-global.js |
| `modules/escalation-integration.js` | 320 | content-bundle | `escalationIntegration` | — |
| `modules/escalation-system.js` | 942 | content-bundle, lazy-loader (page world via <script>) | `EscalationSystem` `escalationSystem` | modules/escalation-integration.js<br>modules/optimizations/lazy-loader.js |
| `modules/examples/conversation-memory-usage.js` | 46 | **⚫ nenhum** | — | — |
| `modules/features/auto-learning.js` | 291 | content-bundle | `WHLAutoLearning` `WHLAutoLearningConfig` | — |
| `modules/features/behavioral-analysis.js` | 439 | content-bundle | `WHLBehavioralAnalysis` `WHLBehavioralConfig` | — |
| `modules/features/customer-feedback.js` | 842 | content-bundle | `WHLCustomerFeedback` `WHLFeedbackConfig` | modules/advanced/realtime-dashboard.js |
| `modules/features/multi-persona.js` | 377 | content-bundle | `WHLMultiPersona` `WHLPersonaConfig` | — |
| `modules/features/smart-templates.js` | 393 | content-bundle | `WHLSmartTemplates` `WHLTemplateConfig` | — |
| `modules/few-shot-learning.js` | 891 | content-bundle, training.html, lazy-loader (page world via <script>) | `FewShotLearning` `pickExamples` `fewShotLearning` | modules/ai-suggestion-fixed.js<br>modules/features/auto-learning.js<br>modules/features/customer-feedback.js<br>modules/optimizations/lazy-loader.js<br>modules/quality/dynamic-few-shot.js<br>scripts/integrity-check.js<br>(+9) |
| `modules/human-typing.js` | 187 | content-bundle, sidepanel.html | `HumanTyping` `humanType` `simulateHumanTyping` | modules/ai-suggestion-fixed.js<br>modules/automation-engine.js<br>modules/campaign-manager.js<br>modules/copilot-engine.js<br>modules/smartbot-autopilot-v2.js<br>modules/suggestion-injector.js<br>(+1) |
| `modules/idb-storage.js` | 238 | **⚫ nenhum** | `IDBStorage` `whlMigrateStorage` | modules/knowledge-base.js<br>modules/memory-system.js |
| `modules/kill-switch.js` | 265 | **⚫ nenhum** | `KillSwitch` | modules/smartbot-autopilot-v2.js |
| `modules/knowledge-base.js` | 1481 | content-bundle, sidepanel.html, training.html, lazy-loader (page world via <script>) | `KnowledgeBase` `KBSyncManager` `knowledgeBase` | modules/ai-suggestion-fixed.js<br>modules/confidence-system.js<br>modules/optimizations/lazy-loader.js<br>scripts/integrity-check.js<br>modules/copilot-engine.js<br>scripts/migrate-storage-keys.js<br>(+2) |
| `modules/knowledge-sync-manager.js` | 394 | content-bundle | `KnowledgeSyncManager` | modules/data-sync-manager.js |
| `modules/memory-event-queue.js` | 140 | content-bundle | `WHLMemoryEventQueue` | — |
| `modules/memory-system.js` | 1380 | content-bundle | `MemorySystem` `autoUpdateMemory` `memorySystem` | modules/ai-suggestion-fixed.js<br>modules/copilot-engine.js<br>modules/suggestion-injector.js<br>scripts/integrity-check.js<br>scripts/migrate-storage-keys.js |
| `modules/optimizations/lazy-loader.js` | 567 | content-bundle | `WHLLazyLoader` `WHLRequireModule` `WHLLazyClass` `WHLLazyConfig` | — |
| `modules/optimizations/request-batcher.js` | 625 | content-bundle | `WHLRequestBatcher` `WHLBatchedAPI` `WHLBatcherConfig` | — |
| `modules/optimizations/smart-cache.js` | 827 | content-bundle | `WHLSmartCache` `WHLCacheConfig` `aiResponseCache` | modules/advanced/realtime-dashboard.js<br>modules/ai-analytics.js<br>modules/ai-response-cache.js<br>modules/ai-suggestion-fixed.js<br>modules/copilot-engine.js |
| `modules/quality/confidence-granular.js` | 677 | content-bundle | `WHLGranularConfidence` `WHLConfidenceConfig` | modules/advanced/realtime-dashboard.js |
| `modules/quality/dynamic-few-shot.js` | 511 | content-bundle | `WHLDynamicFewShot` `WHLFewShotConfig` | modules/advanced/autonomous-learning.js<br>modules/features/auto-learning.js |
| `modules/quality/rag-local.js` | 839 | content-bundle | `WHLLocalRAG` `WHLRAGConfig` `WHLHNSWIndex` | modules/copilot-engine.js<br>modules/knowledge-base.js<br>training/modules/ai-client.js |
| `modules/smart-replies.js` | 970 | content-bundle, sidepanel.html | `SmartRepliesModule` | modules/init.js<br>modules/quick-commands.js<br>modules/suggestion-injector.js<br>sidepanel-fixes.js<br>sidepanel-handlers.js |
| `modules/smart-suggestions.js` | 503 | content-bundle | `SmartSuggestions` | modules/ai-suggestion-fixed.js<br>modules/init.js |
| `modules/smartbot-autopilot-v2.js` | 1989 | content-bundle, sidepanel.html | `AutopilotV2` `SmartBotAutopilot` `Autopilot` `AutoPilot` `autoPilot` | modules/optimizations/lazy-loader.js<br>scripts/integrity-check.js<br>modules/ai-suggestion-fixed.js<br>modules/backend-client.js<br>modules/event-bus-central.js<br>modules/feature-gate.js<br>(+6) |
| `modules/suggestion-injector.js` | 980 | content-bundle | `SuggestionInjector` | content/content-parts/10-other-listeners.js |
| `modules/tab-coordinator.js` | 507 | **⚫ nenhum** | `TabCoordinator` | modules/data-sync-manager.js<br>modules/smartbot-autopilot-v2.js |
| `modules/text-to-speech.js` | 890 | content-bundle, lazy-loader (page world via <script>) | `TextToSpeech` | content/content-parts/10-other-listeners.js<br>modules/optimizations/lazy-loader.js |
| `modules/training-debug-tools.js` | 394 | content-bundle, lazy-loader (page world via <script>) | `TrainingDebugTools` | modules/init.js |
| `modules/training-stats.js` | 254 | content-bundle, lazy-loader (page world via <script>) | `TrainingStats` `trainingStats` | modules/copilot-engine.js<br>sidepanel-ai-handlers.js |
| `modules/trust-system.js` | 670 | content-bundle, sidepanel.html | `TrustSystem` | modules/init.js<br>modules/quick-commands.js |
| `sidepanel-ai-handlers.js` | 601 | sidepanel.html | `removeFAQ` `removeCannedReply` | modules/knowledge-base.js |
| `training/modules/ai-client.js` | 457 | training.html | `CopilotEngine` `AIService` `TrainingAIClient` | adapters/legacy-smartbot.js<br>content/content-parts/10-other-listeners.js<br>modules/ai-backend-handlers.js<br>modules/ai-service.js<br>modules/ai-suggestion-fixed.js<br>modules/anti-break-system.js<br>(+19) |
| `training/modules/document-importer.js` | 425 | training.html | `DocumentImporter` `documentImporter` | training/training.js |
| `training/modules/interactive-training.js` | 497 | **⚫ nenhum** | `WHLInteractiveTraining` | — |
| `training/modules/speech-to-text.js` | 176 | **⚫ nenhum** | `WHLSpeechToText` `WHLSTTProviders` `WHLSTTLanguages` | (por nome) background/ai-handlers.js |
| `training/modules/voice-recorder.js` | 119 | **⚫ nenhum** | `WHLVoiceRecorder` | — |
| `training/plan-gate.js` | 145 | training.html | — | — |
| `training/simulation-engine.js` | 914 | training.html | `SimulationEngine` `simulationEngine` | training/training.js |
| `training/training.js` | 2286 | training.html | — | (por nome) background/ai-handlers.js, training/modules/ai-client.js, training/plan-gate.js |
| `utils/anti-ban.js` | 351 | sidepanel.html | `antiBanSystem` | sidepanel-router.js |

## Arquivos de IA SEM carregamento

- `modules/ai-ab-testing.js` (222 linhas) — globais: `ResponseABTester`; mencionado por runtime: ninguém
- `modules/ai-analytics-collector.js` (230 linhas) — globais: `AIAnalyticsCollector`; mencionado por runtime: ninguém
- `modules/ai-conversation-memory.js` (594 linhas) — globais: `ConversationMemory`, `conversationMemory`; mencionado por runtime: modules/ai-suggestion-fixed.js
- `modules/ai-dynamic-prompt.js` (587 linhas) — globais: `DynamicPromptBuilder`; mencionado por runtime: modules/ai-suggestion-fixed.js
- `modules/ai-embedding-provider.js` (543 linhas) — globais: `EmbeddingProvider`; mencionado por runtime: ninguém
- `modules/ai-hybrid-intent.js` (521 linhas) — globais: `HybridIntentClassifier`; mencionado por runtime: modules/ai-suggestion-fixed.js
- `modules/ai-hybrid-search.js` (707 linhas) — globais: `HybridSearch`; mencionado por runtime: modules/ai-suggestion-fixed.js
- `modules/ai-validated-learning.js` (501 linhas) — globais: `ValidatedLearningPipeline`; mencionado por runtime: modules/ai-gateway.js, modules/ai-suggestion-fixed.js, modules/copilot-engine.js
- `modules/backend-singleton.js` (58 linhas) — globais: `BackendSingleton`; mencionado por runtime: modules/campaign-manager.js
- `modules/examples/conversation-memory-usage.js` (46 linhas) — globais: —; mencionado por runtime: ninguém
- `modules/idb-storage.js` (238 linhas) — globais: `IDBStorage`, `whlMigrateStorage`; mencionado por runtime: modules/knowledge-base.js, modules/memory-system.js, modules/memory-system.js
- `modules/kill-switch.js` (265 linhas) — globais: `KillSwitch`; mencionado por runtime: modules/smartbot-autopilot-v2.js
- `modules/tab-coordinator.js` (507 linhas) — globais: `TabCoordinator`; mencionado por runtime: modules/data-sync-manager.js, modules/smartbot-autopilot-v2.js
- `training/modules/interactive-training.js` (497 linhas) — globais: `WHLInteractiveTraining`; mencionado por runtime: ninguém
- `training/modules/speech-to-text.js` (176 linhas) — globais: `WHLSpeechToText`, `WHLSTTProviders`, `WHLSTTLanguages`; mencionado por runtime: background/ai-handlers.js
- `training/modules/voice-recorder.js` (119 linhas) — globais: `WHLVoiceRecorder`; mencionado por runtime: ninguém
