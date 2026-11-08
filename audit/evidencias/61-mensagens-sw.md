# Mensagens chrome.runtime.sendMessage × handlers

Tipos enviados por arquivos que rodam: 28 · tratados no SW: 17 · tratados no content: 5 · **sem handler encontrado: 9**

| tipo/action | enviado por | SW | content |
|---|---|---|---|
| ANTIBAN_UPDATE | utils/anti-ban.js | — | — |
| FETCH_PROXY | modules/ai-gateway.js, modules/backend-client.js | ✔ | — |
| FEW_SHOT_PUSH | modules/few-shot-learning.js | ✔ | — |
| FEW_SHOT_SYNC | modules/few-shot-learning.js | ✔ | — |
| MEMORY_PUSH | modules/memory-system.js | ✔ | — |
| MEMORY_QUERY | modules/memory-system.js | ✔ | — |
| QUEUE_PROGRESS_UPDATE | utils/scheduler.js | — | — |
| SCHEDULE_COMPLETED | utils/scheduler.js | — | — |
| START_SCHEDULED_CAMPAIGN | utils/scheduler.js | ✔ | — |
| SYNC_TRAINING_DATA | training/training.js | ✔ | — |
| UPDATE_CONFIDENCE | modules/confidence-system.js | ✔ | — |
| WHL_AUTOPILOT_EVENT | modules/smartbot-autopilot-v2.js | — | — |
| WHL_GROUPS_PROGRESS | content/content-parts/07-message-listeners.js | — | — |
| WHL_LOAD_ADVANCED | modules/optimizations/lazy-loader.js | ✔ | — |
| WHL_ONBOARDING_HIGHLIGHT | onboarding.js | ✔ | ✔ |
| WHL_OPEN_CHAT | modules/crm.js | ✔ | ✔ |
| WHL_OPEN_POPUP_TAB | content/top-panel-injector.js, sidepanel-fixes.js, sidepanel-ai-handlers.js | ✔ | — |
| WHL_OPEN_SIDE_PANEL_VIEW | content/top-panel-injector.js | ✔ | — |
| WHL_RECOVER_NEW_MESSAGE | modules/recover-dom.js | ✔ | ✔ |
| WHL_SEND_TEXT_DIRECT | modules/automation-engine.js | — | ✔ |
| WHL_SEND_TEXT_TO_PHONE | modules/team-system-simple.js | ✔ | — |
| WHL_SET_SIDE_PANEL_ENABLED | content/top-panel-injector.js | ✔ | — |
| chatUpdate | chatbackup/content.js | — | — |
| complete | chatbackup/content.js | — | — |
| download | chatbackup/content.js | ✔ | — |
| error | chatbackup/content.js | — | ✔ |
| mediaProgressDetailed | chatbackup/content.js | — | — |
| progress | chatbackup/content.js | — | — |
