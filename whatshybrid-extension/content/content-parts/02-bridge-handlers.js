/**
 * @file content/content-parts/02-bridge-handlers.js
 * @description Slice 1501-3000 do content.js original (refactor v9.0.0)
 * @lines 1500
 */

        const hour = new Date().getHours();
        if (hour < 8 || hour > 20) {
          console.warn(`[WHL Anti-Ban] ⛔ FORA DO HORÁRIO COMERCIAL: ${hour}h`);
          return {
            allowed: false,
            reason: 'business_hours',
            message: `Fora do horário comercial (8h-20h). Horário atual: ${hour}h`,
            current: antiBan.sentToday,
            limit: antiBan.dailyLimit || 200
          };
        }
      }
      
      // Warning se próximo do limite (80%)
      const warningThreshold = Math.floor((antiBan.dailyLimit || 200) * 0.8);
      if (antiBan.sentToday >= warningThreshold) {
        console.warn(`[WHL Anti-Ban] ⚠️ Próximo do limite: ${antiBan.sentToday}/${antiBan.dailyLimit || 200}`);
      }
      
      return {
        allowed: true,
        current: antiBan.sentToday,
        limit: antiBan.dailyLimit || 200,
        remaining: (antiBan.dailyLimit || 200) - antiBan.sentToday
      };
    } catch (e) {
      console.warn('[WHL Anti-Ban] Erro ao verificar limite:', e);
      return { allowed: true }; // Em caso de erro, permitir envio
    }
  }
  
  // Incrementar contador do Anti-Ban após envio bem-sucedido
  // v9.4.6 BUG #108 FIX: lock optimista pra prevenir race condition em
  // incrementAntiBanCounter quando 2+ abas WhatsApp Web executam simultâneamente.
  // Antes: tab A lê 100, tab B lê 100 (antes de A escrever), ambas gravam 101
  // → contador subconta → risco aumenta de banimento WhatsApp.
  // Agora: re-verifica timestamp após write, retry se outra tab escreveu.
  // Também coalesce calls dentro da MESMA tab (back-to-back rápido).
  let _antiBanInflight = false;
  async function incrementAntiBanCounter() {
    if (_antiBanInflight) {
      // Aguarda inflight finalizar antes de continuar
      await new Promise(r => setTimeout(r, 50));
    }
    _antiBanInflight = true;
    try {
      // Retry até 3x se outro write ocorreu durante nossa janela
      for (let attempt = 0; attempt < 3; attempt++) {
        const data = await safeChrome(() => chrome.storage.local.get('whl_anti_ban_data'));
        const antiBan = data?.whl_anti_ban_data || { sentToday: 0, dailyLimit: 200 };
        const previousTs = antiBan._lastWriteTs || 0;

        // Verificar reset diário
        const today = new Date().toISOString().split('T')[0];
        if (antiBan.lastResetDate !== today) {
          antiBan.sentToday = 0;
          antiBan.lastResetDate = today;
        }

        antiBan.sentToday = (antiBan.sentToday || 0) + 1;
        antiBan._lastWriteTs = Date.now();

        const percentage = Math.round((antiBan.sentToday / (antiBan.dailyLimit || 200)) * 100);

        await safeChrome(() => chrome.storage.local.set({
          whl_anti_ban_data: antiBan,
          whl_antiban_ui_update: {
            sentToday: antiBan.sentToday,
            dailyLimit: antiBan.dailyLimit || 200,
            percentage: percentage,
            timestamp: Date.now()
          }
        }));

        // Verifica se nossa escrita não foi sobrescrita por outra tab
        await new Promise(r => setTimeout(r, 30));
        const verify = await safeChrome(() => chrome.storage.local.get('whl_anti_ban_data'));
        const verifiedTs = verify?.whl_anti_ban_data?._lastWriteTs || 0;

        if (verifiedTs === antiBan._lastWriteTs) {
          // Nossa escrita venceu — sucesso
          console.log(`[WHL Anti-Ban] 📊 Contador: ${antiBan.sentToday}/${antiBan.dailyLimit || 200} (${percentage}%)`);
          if (percentage >= 80 && percentage < 100) {
            console.warn(`[WHL Anti-Ban] ⚠️ Próximo do limite diário!`);
          } else if (percentage >= 100) {
            console.error(`[WHL Anti-Ban] ⛔ Limite diário atingido!`);
          }
          return { current: antiBan.sentToday, limit: antiBan.dailyLimit, percentage };
        }

        // Outra tab escreveu por cima — retry com backoff jittered
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
        }
      }
      console.warn('[WHL Anti-Ban] ⚠️ Não conseguiu confirmar incremento após 3 retries — concorrência alta');
    } catch (e) {
      console.warn('[WHL Anti-Ban] Erro ao incrementar:', e);
    } finally {
      _antiBanInflight = false;
    }
  }

  function ensurePanel() {
    let panel = document.getElementById('whlPanel');
    if (panel) return panel;

    const style = document.createElement('style');
    style.id = 'whlStyle';
    style.textContent = `
      #whlPanel{position:fixed;top:80px;right:16px;width:480px;max-height:78vh;overflow:auto;
        background:rgba(8,6,20,.96);color:#fff;border-radius:18px;padding:12px;z-index:999999;
        font-family:system-ui;box-shadow:0 22px 55px rgba(0,0,0,.6);border:1px solid rgba(111,0,255,.35)}
      #whlPanel .topbar{display:flex;align-items:center;justify-content:space-between;gap:10px}
      #whlPanel .title{font-weight:900}
      #whlPanel .whl-logo{width:28px;height:28px;border-radius:6px}
      #whlPanel .muted{opacity:.75;font-size:12px;line-height:1.35}
      #whlPanel input,#whlPanel textarea{width:100%;margin-top:6px;padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.12);
        background:rgba(255,255,255,.06);color:#fff;outline:none;box-sizing:border-box;max-width:100%}
      #whlPanel textarea{min-height:84px;resize:vertical}
      
      /* OTIMIZAÇÃO: Progress indicator para extração de grupos */
      #whlPanel .extraction-progress {
        background: linear-gradient(135deg, rgba(111,0,255,0.15), rgba(0,168,132,0.15));
        border: 1px solid rgba(111,0,255,0.3);
        border-radius: 12px;
        padding: 12px;
        margin: 10px 0;
        display: none;
        animation: slideInUp 0.3s ease;
      }
      
      #whlPanel .extraction-progress.active {
        display: block;
      }
      
      #whlPanel .extraction-progress .progress-bar-container {
        background: rgba(0,0,0,0.3);
        border-radius: 8px;
        height: 8px;
        overflow: hidden;
        margin: 8px 0;
      }
      
      #whlPanel .extraction-progress .progress-bar-fill {
        height: 100%;
        background: linear-gradient(90deg, #6f00ff, #00a884);
        transition: width 0.3s ease;
        border-radius: 8px;
      }
      
      #whlPanel .extraction-progress .progress-text {
        color: #00a884;
        font-size: 12px;
        font-weight: bold;
        text-align: center;
        margin-top: 4px;
      }
      
      #whlPanel .extraction-progress .progress-count {
        color: #fff;
        font-size: 11px;
        text-align: center;
        opacity: 0.8;
      }
      
      /* CORREÇÃO ISSUE 04: Garantir contraste nas caixas de extração */
      #whlPanel #whlExtractedNumbers,
      #whlPanel #whlArchivedNumbers,
      #whlPanel #whlBlockedNumbers,
      #whlPanel #whlGroupMembersNumbers {
        background: rgba(0, 0, 0, 0.4) !important;
        color: #fff !important;
        border: 1px solid rgba(255, 255, 255, 0.3) !important;
      }
      
      /* CORREÇÃO BUG 5: Seção de Arquivados - Fundo VERDE */
      #whlPanel .extract-section:has(#whlArchivedNumbers),
      #whlPanel #whlArchivedSection {
        background: rgba(34, 197, 94, 0.2) !important;
        border: 1px solid rgba(34, 197, 94, 0.5) !important;
        border-radius: 8px;
        padding: 10px;
        margin-top: 10px;
      }

      #whlPanel #whlArchivedNumbers {
        background: rgba(0, 0, 0, 0.3) !important;
        color: #fff !important;
        border: 1px solid rgba(34, 197, 94, 0.5) !important;
      }

      /* CORREÇÃO BUG 6: Seção de Bloqueados - Fundo VERMELHO ESCURO */
      #whlPanel .extract-section:has(#whlBlockedNumbers),
      #whlPanel #whlBlockedSection {
        background: rgba(185, 28, 28, 0.2) !important;
        border: 1px solid rgba(185, 28, 28, 0.5) !important;
        border-radius: 8px;
        padding: 10px;
        margin-top: 10px;
      }

      #whlPanel #whlBlockedNumbers {
        background: rgba(0, 0, 0, 0.3) !important;
        color: #fff !important;
        border: 1px solid rgba(185, 28, 28, 0.5) !important;
      }
      
      /* Garantir que labels e contadores sejam visíveis */
      #whlPanel .extract-section label {
        color: #fff !important;
        font-weight: bold;
      }
      
      #whlPanel .muted,
      #whlNormalCount,
      #whlArchivedCount,
      #whlBlockedCount {
        color: #fff !important;
      }
      
      #whlArchivedCount {
        color: #4ade80 !important; /* Verde claro */
        font-weight: bold;
      }

      #whlBlockedCount {
        color: #f87171 !important; /* Vermelho claro */
        font-weight: bold;
      }
      
      #whlNormalCount,
      #whlArchivedCount,
      #whlBlockedCount {
        font-weight: bold;
      }
      
      /* PR #78: Highlighted input fields for Numbers and Message */
      #whlPanel .whl-input-highlight {
        background: linear-gradient(135deg, rgba(0,168,132,0.08), rgba(111,0,255,0.08));
        border: 2px solid rgba(0,168,132,0.3);
        border-radius: 12px;
        padding: 16px;
        margin: 10px 0;
        box-shadow: 0 4px 12px rgba(0,168,132,0.1);
        transition: all 0.3s ease;
      }
      
      #whlPanel .whl-input-highlight:hover {
        border-color: rgba(0,168,132,0.5);
        box-shadow: 0 6px 20px rgba(0,168,132,0.2);
      }
      
      #whlPanel .whl-input-highlight .title {
        color: #00a884 !important;
        font-weight: bold;
        font-size: 14px;
        margin-bottom: 8px;
      }
      
      #whlPanel .whl-input-highlight textarea {
        background: rgba(0,0,0,0.3) !important;
        border: 2px solid rgba(0,168,132,0.4) !important;
        margin-top: 0;
      }
      
      #whlPanel .whl-input-highlight textarea:focus {
        border-color: #00a884 !important;
        box-shadow: 0 0 0 3px rgba(0,168,132,0.1);
      }
      
      #whlPanel button{margin-top:8px;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.12);
        background:rgba(255,255,255,.06);color:#fff;font-weight:900;cursor:pointer;box-sizing:border-box}
      #whlPanel button.primary{background:linear-gradient(180deg, rgba(111,0,255,.95), rgba(78,0,190,.95));
        box-shadow:0 14px 30px rgba(111,0,255,.25)}
      #whlPanel button.danger{border-color:rgba(255,120,120,.35);background:rgba(255,80,80,.10)}
      #whlPanel button.success{background:linear-gradient(180deg, rgba(0,200,100,.85), rgba(0,150,80,.85))}
      #whlPanel button.warning{background:linear-gradient(180deg, rgba(255,200,0,.75), rgba(200,150,0,.75))}
      #whlPanel .row{display:flex;gap:10px;box-sizing:border-box}
      #whlPanel .card{margin-top:12px;padding:12px;border-radius:16px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);box-sizing:border-box;overflow:hidden}
      #whlPanel table{width:100%;font-size:12px;margin-top:10px;border-collapse:collapse}
      #whlPanel th,#whlPanel td{padding:6px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}
      #whlPanel th{opacity:.75;text-align:left}
      #whlPanel .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800}
      #whlPanel .pill.pending{background:rgba(0,255,255,.10);border:1px solid rgba(0,255,255,.25)}
      #whlPanel .pill.opened{background:rgba(111,0,255,.10);border:1px solid rgba(111,0,255,.25)}
      #whlPanel .tiny{font-size:11px;opacity:.72}
      #whlPanel .iconbtn{width:36px;height:36px;border-radius:14px;margin-top:0}
      #whlPanel .progress-bar{width:100%;height:24px;background:rgba(255,255,255,.08);border-radius:12px;overflow:hidden;margin-top:10px}
      #whlPanel .progress-fill{height:100%;background:linear-gradient(90deg, rgba(111,0,255,.85), rgba(78,0,190,.85));transition:width 0.3s ease}
      #whlPanel .stats{display:flex;gap:12px;margin-top:10px;font-size:12px}
      #whlPanel .stat-item{padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);flex:1;text-align:center}
      #whlPanel .stat-value{font-size:18px;font-weight:900;display:block;margin-top:4px}
      #whlPanel .status-badge{display:inline-block;padding:4px 12px;border-radius:999px;font-size:11px;font-weight:800;margin-left:8px}
      #whlPanel .status-badge.running{background:rgba(120,255,160,.10);border:1px solid rgba(120,255,160,.35);color:rgba(120,255,160,1)}
      #whlPanel .status-badge.paused{background:rgba(255,200,0,.10);border:1px solid rgba(255,200,0,.35);color:rgba(255,200,0,1)}
      #whlPanel .status-badge.stopped{background:rgba(255,80,80,.10);border:1px solid rgba(255,80,80,.35);color:rgba(255,80,80,1)}
      #whlPanel input[type="number"]{width:80px}

      
      /* ===== Automation settings layout (clean) ===== */
      #whlPanel .settings-grid{
        display:grid;
        grid-template-columns:1fr 1fr;
        gap:12px;
        margin-top:12px;
      }
      #whlPanel .settings-grid .cell{
        padding:12px;
        border-radius:14px;
        background:rgba(255,255,255,.05);
        border:1px solid rgba(255,255,255,.12);
        box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
      }
      #whlPanel .settings-grid .label{
        opacity:.85;
        font-size:12px;
        margin-bottom:8px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:10px;
      }
      #whlPanel .settings-grid input[type="number"],
      #whlPanel .settings-grid input[type="datetime-local"]{
        width:100% !important;
        margin:0;
      }
      #whlPanel .settings-toggles{
        display:grid;
        grid-template-columns:1fr;
        gap:10px;
        margin-top:12px;
        padding-top:12px;
        border-top:1px solid rgba(255,255,255,.10);
      }
      #whlPanel .settings-toggles label{
        padding:10px 12px;
        border-radius:14px;
        background:rgba(255,255,255,.04);
        border:1px solid rgba(255,255,255,.10);
      }
      #whlPanel .settings-toggles input{transform:scale(1.05)}
      #whlPanel .settings-footer{
        margin-top:12px;
        padding-top:10px;
        border-top:1px solid rgba(255,255,255,.10);
      }
      @media (max-width: 520px){
        #whlPanel .settings-grid{grid-template-columns:1fr}
      }

      /* PR #78: Tooltips and help text */
      #whlPanel .whl-tooltip {
        display: inline-block;
        position: relative;
        cursor: help;
        color: #00a884;
        font-size: 16px;
        margin-left: 6px;
        vertical-align: middle;
      }
      
      #whlPanel .whl-help-text {
        font-size: 11px;
        color: #00a884;
        background: rgba(0,168,132,0.1);
        padding: 6px 10px;
        border-radius: 6px;
        margin-top: 6px;
        border-left: 3px solid #00a884;
      }

      /* ===== TABS SYSTEM ===== */
      #whlPanel .whl-tabs {
        display: flex;
        gap: 0;
        margin-bottom: 12px;
        border-bottom: 2px solid rgba(111,0,255,.35);
      }

      #whlPanel .whl-tab {
        flex: 1;
        padding: 12px 16px;
        background: rgba(255,255,255,.05);
        border: none;
        border-bottom: 3px solid transparent;
        color: rgba(255,255,255,.6);
        font-weight: 700;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      #whlPanel .whl-tab:hover {
        background: rgba(255,255,255,.10);
        color: rgba(255,255,255,.9);
      }

      #whlPanel .whl-tab.active {
        background: rgba(111,0,255,.15);
        border-bottom: 3px solid rgba(111,0,255,.85);
        color: #fff;
      }

      #whlPanel .whl-tab-content {
        display: none;
      }

      #whlPanel .whl-tab-content.active {
        display: block;
      }

      /* ===== QUEUE TABLE CONTAINER - SUPER EXPANDIDO ===== */
      #whlPanel .whl-queue-container {
        max-height: 800px !important; /* AUMENTADO de 600px para 800px */
        overflow-y: auto;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 12px;
        background: rgba(0,0,0,.15);
        margin-top: 10px;
        scroll-behavior: smooth;
      }

      /* Header fixo */
      #whlPanel .whl-queue-container thead {
        position: sticky;
        top: 0;
        background: rgba(30,20,50,.98);
        z-index: 10;
      }

      /* Células mais compactas para mostrar mais linhas */
      #whlPanel .whl-queue-container td,
      #whlPanel .whl-queue-container th {
        padding: 6px 8px !important;
        font-size: 12px;
      }

      #whlPanel tbody tr:nth-child(even) {
        background: rgba(255,255,255,.03);
      }

      /* Linhas da tabela com destaque melhor */
      #whlPanel tbody tr {
        transition: background 0.2s ease;
      }

      #whlPanel tbody tr:hover {
        background: rgba(111,0,255,.15);
      }

      #whlPanel tbody tr.current {
        background: rgba(111,0,255,.25);
        border-left: 3px solid rgba(111,0,255,.85);
      }

      /* Status badges com cores mais visíveis */
      #whlPanel .pill.sent {
        background: rgba(0,200,100,.25);
        border: 1px solid rgba(0,200,100,.50);
        color: #4ade80;
        font-weight: 600;
      }

      #whlPanel .pill.failed {
        background: rgba(255,80,80,.25);
        border: 1px solid rgba(255,80,80,.50);
        color: #f87171;
        font-weight: 600;
      }

      #whlPanel .pill.pending {
        background: rgba(255,200,0,.20);
        border: 1px solid rgba(255,200,0,.40);
        color: #fbbf24;
      }

      #whlPanel .pill.confirming {
        background: rgba(255, 200, 0, .25);
        border: 1px solid rgba(255, 200, 0, .50);
        color: #fbbf24;
        animation: pulse 1s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }


      /* Additions */
      #whlPanel .tip{position:relative;display:inline-block}
      #whlPanel .tip[data-tip]::after{content:attr(data-tip);position:absolute;left:0;top:120%;
        background:rgba(5,4,18,.96);border:1px solid rgba(0,255,255,.22);color:#fff;
        padding:8px 10px;border-radius:12px;font-size:12px;line-height:1.35;min-width:220px;max-width:360px;
        opacity:0;pointer-events:none;transform:translateY(-4px);transition:opacity .12s ease,transform .12s ease;z-index:999999;
        box-shadow:0 18px 40px rgba(0,0,0,.6)}
      #whlPanel .tip:hover::after{opacity:1;transform:translateY(0)}
      #whlPanel .wa-preview{display:flex;justify-content:flex-end}
      #whlPanel .wa-bubble{max-width:92%;padding:10px 12px;border-radius:18px 18px 6px 18px;
        background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.10);white-space:pre-wrap}
      #whlPanel .wa-meta{margin-top:6px;text-align:right;font-size:11px;opacity:.75}


      /* ===== Automation settings FINAL (aligned & separated) ===== */
      #whlPanel .settings-wrap{margin-top:10px}
      #whlPanel .settings-section-title{
        font-size:12px;
        opacity:.78;
        letter-spacing:.2px;
        margin:10px 0 8px;
      }
      #whlPanel .settings-table{
        border-radius:16px;
        overflow:hidden;
        border:1px solid rgba(255,255,255,.14);
        background:rgba(255,255,255,.03);
      }
      #whlPanel .settings-row{
        display:grid;
        grid-template-columns: 1fr 180px;
        gap:14px;
        align-items:center;
        padding:12px 12px;
      }
      #whlPanel .settings-row + .settings-row{border-top:1px solid rgba(255,255,255,.10)}
      #whlPanel .settings-label{display:flex;flex-direction:column;gap:3px}
      #whlPanel .settings-label .k{font-weight:900;font-size:12px}
      #whlPanel .settings-label .d{font-size:11px;opacity:.70;line-height:1.25}
      #whlPanel .settings-control{display:flex;justify-content:flex-end;align-items:center}
      #whlPanel .settings-control input[type="number"],
      #whlPanel .settings-control input[type="datetime-local"]{
        width:180px !important;
        margin:0 !important;
      }
      #whlPanel .settings-row.toggle{grid-template-columns: 1fr 48px}
      #whlPanel .settings-row.toggle .settings-control{justify-content:flex-end}
      #whlPanel .settings-row.toggle input[type="checkbox"]{width:18px;height:18px}
      #whlPanel .settings-footer{
        margin-top:12px;
        padding-top:10px;
        border-top:1px solid rgba(255,255,255,.10);
      }
      @media (max-width:520px){
        #whlPanel .settings-row{grid-template-columns:1fr}
        #whlPanel .settings-control{justify-content:flex-start}
        #whlPanel .settings-control input[type="number"],
        #whlPanel .settings-control input[type="datetime-local"]{width:100% !important}
        #whlPanel .settings-row.toggle{grid-template-columns:1fr 48px}
      }


      /* ===== Preview WhatsApp FINAL ===== */
      #whlPanel .wa-chat{
        margin-top:10px;
        padding:14px;
        border-radius:16px;
        background:
          radial-gradient(160px 160px at 20% 20%, rgba(111,0,255,.10), transparent 60%),
          radial-gradient(200px 200px at 80% 10%, rgba(0,255,255,.08), transparent 60%),
          rgba(0,0,0,.18);
        border:1px solid rgba(255,255,255,.10);
        display:flex;
        justify-content:flex-end;
      }
      #whlPanel .wa-chat .wa-bubble{
        position:relative;
        max-width:92%;
        padding:10px 12px 8px;
        border-radius:18px 18px 6px 18px;
        background:rgba(0, 92, 75, .86);
        border:1px solid rgba(120,255,160,.22);
        box-shadow:0 14px 30px rgba(0,0,0,.38);
        color:#e9edef;
      }
      #whlPanel .wa-chat .wa-bubble::after{
        content:"";
        position:absolute;
        right:-6px;
        bottom:0;
        width:12px;height:12px;
        background:rgba(0, 92, 75, .86);
        border-right:1px solid rgba(120,255,160,.22);
        border-bottom:1px solid rgba(120,255,160,.22);
        transform:skewX(-20deg) rotate(45deg);
        border-bottom-right-radius:4px;
      }
      #whlPanel .wa-chat .wa-time{
        margin-top:6px;
        text-align:right;
        font-size:11px;
        opacity:.75;
        display:flex;
        justify-content:flex-end;
        align-items:center;
        gap:6px;
      }
      #whlPanel .wa-chat .wa-ticks{font-size:12px;opacity:.9}

      /* ========================================= */
      /* PR #79: VISUAL PREMIUM - Part 1: MICROANIMAÇÕES */
      /* ========================================= */

      /* CSS Variables for 3D Theme */
      :root {
        --whl-primary: #6f00ff;
        --whl-secondary: #00a884;
        --whl-accent: #7c3aed;
        --whl-bg-dark: #0a0a14;
        --whl-bg-card: #12121f;
        --whl-bg-hover: #1a1a2e;
        --whl-gradient-primary: linear-gradient(135deg, #6f00ff, #7c3aed);
        --whl-gradient-secondary: linear-gradient(135deg, #00a884, #00d4aa);
        --whl-gradient-mixed: linear-gradient(135deg, #6f00ff, #00a884);
        --whl-gradient-glow: linear-gradient(135deg, rgba(111,0,255,0.3), rgba(0,168,132,0.3));
        --whl-shadow-sm: 0 2px 4px rgba(0,0,0,0.3);
        --whl-shadow-md: 0 4px 12px rgba(0,0,0,0.4);
        --whl-shadow-lg: 0 8px 30px rgba(0,0,0,0.5);
        --whl-shadow-glow: 0 0 20px rgba(111,0,255,0.3);
      }

      /* Keyframe Animations */
      @keyframes slideInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes scaleIn {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      /* Enhanced 3D Buttons */
      #whlPanel button {
        position: relative;
        transform: translateY(0);
        transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        overflow: hidden;
      }

      #whlPanel button::after {
        content: '';
        position: absolute;
        inset: 0;
        background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%);
        opacity: 0;
        transform: scale(0);
        transition: all 0.5s ease;
        pointer-events: none;
      }

      #whlPanel button:active::after {
        opacity: 1;
        transform: scale(2);
      }

      /* Primary Button 3D */
      #whlPanel button.primary {
        background: linear-gradient(180deg, #8b2eff 0%, #6f00ff 50%, #5a00cc 100%);
        border: none;
        box-shadow: 
          0 4px 0 #4a00a8,
          0 6px 20px rgba(111,0,255,0.4),
          inset 0 1px 0 rgba(255,255,255,0.2);
        text-shadow: 0 1px 2px rgba(0,0,0,0.3);
      }

      #whlPanel button.primary:hover {
        transform: translateY(-2px);
        box-shadow: 
          0 6px 0 #4a00a8,
          0 10px 30px rgba(111,0,255,0.5),
          inset 0 1px 0 rgba(255,255,255,0.3);
      }

      #whlPanel button.primary:active {
        transform: translateY(2px);
        box-shadow: 
          0 2px 0 #4a00a8,
          0 4px 10px rgba(111,0,255,0.3),
          inset 0 1px 0 rgba(255,255,255,0.1);
      }

      /* Secondary Button 3D */
      #whlPanel button.secondary {
        background: linear-gradient(180deg, #00d4aa 0%, #00a884 50%, #008866 100%);
        box-shadow: 
          0 4px 0 #006644,
          0 6px 20px rgba(0,168,132,0.4),
          inset 0 1px 0 rgba(255,255,255,0.2);
      }

      #whlPanel button.secondary:hover {
        transform: translateY(-2px);
        box-shadow: 
          0 6px 0 #006644,
          0 10px 30px rgba(0,168,132,0.5),
          inset 0 1px 0 rgba(255,255,255,0.3);
      }

      #whlPanel button.secondary:active {
        transform: translateY(2px);
        box-shadow: 
          0 2px 0 #006644,
          0 4px 10px rgba(0,168,132,0.3),
          inset 0 1px 0 rgba(255,255,255,0.1);
      }

      /* Danger Button 3D */
      #whlPanel button.danger {
        background: linear-gradient(180deg, #ff6b7a 0%, #ff4757 50%, #cc3344 100%);
        box-shadow: 
          0 4px 0 #aa2233,
          0 6px 20px rgba(255,71,87,0.4),
          inset 0 1px 0 rgba(255,255,255,0.2);
      }

      #whlPanel button.danger:hover {
        transform: translateY(-2px);
        box-shadow: 
          0 6px 0 #aa2233,
          0 10px 30px rgba(255,71,87,0.5),
          inset 0 1px 0 rgba(255,255,255,0.3);
      }

      #whlPanel button.danger:active {
        transform: translateY(2px);
        box-shadow: 
          0 2px 0 #aa2233,
          0 4px 10px rgba(255,71,87,0.3),
          inset 0 1px 0 rgba(255,255,255,0.1);
      }

      /* Ghost Button */
      #whlPanel button.ghost {
        background: transparent;
        border: 2px solid rgba(111,0,255,0.5);
        color: #6f00ff;
        box-shadow: none;
      }

      #whlPanel button.ghost:hover {
        background: rgba(111,0,255,0.1);
        border-color: #6f00ff;
        transform: translateY(-2px);
        box-shadow: 0 4px 15px rgba(111,0,255,0.2);
      }

      #whlPanel button.ghost:active {
        transform: translateY(0);
        box-shadow: 0 2px 8px rgba(111,0,255,0.15);
      }

      /* Cards with entrance animation */
      #whlPanel .card {
        animation: slideInUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        animation-delay: calc(var(--card-index, 0) * 0.1s);
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      #whlPanel .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 30px rgba(111, 0, 255, 0.2);
      }

      /* Enhanced inputs with animated focus */
      #whlPanel textarea,
      #whlPanel input[type="text"],
      #whlPanel input[type="number"] {
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        border: 2px solid transparent;
        background: linear-gradient(#1a1a2e, #1a1a2e) padding-box,
                    linear-gradient(135deg, #6f00ff33, #00a88433) border-box;
      }

      #whlPanel textarea:focus,
      #whlPanel input:focus {
        background: linear-gradient(#1a1a2e, #1a1a2e) padding-box,
                    linear-gradient(135deg, #6f00ff, #00a884) border-box;
        box-shadow: 0 0 20px rgba(111, 0, 255, 0.3);
        transform: scale(1.01);
        outline: none;
      }

      /* Enhanced tabs with animated indicator */
      #whlPanel .whl-tabs {
        position: relative;
      }

      #whlPanel .whl-tab {
        transition: all 0.2s ease;
      }

      #whlPanel .whl-tab:hover {
        color: #fff;
        transform: translateY(-1px);
      }

      #whlPanel .whl-tab.active {
        color: #fff;
        text-shadow: 0 0 10px rgba(111, 0, 255, 0.5);
      }

      /* Enhanced panel with glassmorphism */
      #whlPanel {
        background: linear-gradient(
          135deg,
          rgba(10,10,20,0.95) 0%,
          rgba(18,18,35,0.98) 50%,
          rgba(10,10,20,0.95) 100%
        );
        backdrop-filter: blur(20px);
        border: 1px solid rgba(111,0,255,0.15);
        box-shadow: 
          0 25px 50px rgba(0,0,0,0.5),
          inset 0 1px 0 rgba(255,255,255,0.05),
          0 0 100px rgba(111,0,255,0.1);
      }

      /* ========================================= */
      /* PR #79: VISUAL PREMIUM - Part 2: RECOVER TIMELINE */
      /* ========================================= */

      /* Timeline Container */
      .whl-recover-timeline {
        background: linear-gradient(180deg, rgba(26,26,46,0.95), rgba(15,15,30,0.98));
        border-radius: 16px;
        padding: 20px;
        border: 1px solid rgba(111,0,255,0.2);
        margin-top: 10px;
      }

      .timeline-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 15px;
        border-bottom: 1px solid rgba(255,255,255,0.1);
      }

      .timeline-header h3 {
        color: #fff;
        font-size: 16px;
        margin: 0;
      }

      .timeline-header .badge {
        background: linear-gradient(135deg, #6f00ff, #00a884);
        color: #fff;
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
      }

      /* Timeline Items */
      .timeline-content {
        position: relative;
        padding-left: 30px;
      }

      .timeline-content::before {
        content: '';
        position: absolute;
        left: 10px;
        top: 0;
        bottom: 0;
        width: 2px;
        background: linear-gradient(180deg, #6f00ff, #00a884);
        border-radius: 2px;
      }

      .timeline-item {
        position: relative;
        margin-bottom: 20px;
        animation: slideInUp 0.4s ease forwards;
      }

      .timeline-dot {
        position: absolute;
        left: -24px;
        top: 20px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #6f00ff;
        border: 3px solid #1a1a2e;
        box-shadow: 0 0 10px rgba(111,0,255,0.5);
      }

      .timeline-item.deleted .timeline-dot {
        background: #ff4757;
        box-shadow: 0 0 10px rgba(255,71,87,0.5);
      }

      .timeline-item.edited .timeline-dot {
        background: #ffa502;
        box-shadow: 0 0 10px rgba(255,165,2,0.5);
      }

      /* Timeline Card */
      .timeline-card {
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        padding: 15px;
        transition: all 0.3s ease;
      }

      .timeline-card:hover {
        background: rgba(255,255,255,0.06);
        border-color: rgba(111,0,255,0.3);
        transform: translateX(5px);
      }

      .card-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .contact-name {
        color: #fff;
        font-weight: bold;
        font-size: 14px;
      }

      .message-type {
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: bold;
      }

      .message-type.deleted {
        background: rgba(255,71,87,0.2);
        color: #ff4757;
      }

      .message-type.edited {
        background: rgba(255,165,2,0.2);
        color: #ffa502;
      }

      .timestamp {
        margin-left: auto;
        color: rgba(255,255,255,0.5);
        font-size: 12px;
      }

      .card-body {
        margin: 10px 0;
      }

      .original-message {
        color: rgba(255,255,255,0.8);
        font-size: 14px;
        line-height: 1.5;
        margin: 0;
        padding: 8px;
        background: rgba(0,0,0,0.2);
        border-radius: 6px;
      }

      .edited-message {
        color: #00a884;
        font-size: 14px;
        line-height: 1.5;
        margin: 0;
        padding: 8px;
        background: rgba(0,168,132,0.1);
        border-radius: 6px;
      }

      .arrow {
        color: rgba(255,255,255,0.3);
        text-align: center;
        margin: 8px 0;
        font-size: 16px;
      }

      .card-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.08);
      }

      .card-footer .date {
        color: rgba(255,255,255,0.5);
        font-size: 11px;
      }

      .copy-btn {
        background: rgba(111,0,255,0.2);
        border: 1px solid rgba(111,0,255,0.3);
        color: #fff;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .copy-btn:hover {
        background: rgba(111,0,255,0.4);
        transform: translateY(-1px);
      }

    `;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'whlPanel';
    panel.innerHTML = `
      <div class="topbar">
        <div>
          <div class="title" style="display:flex;align-items:center;gap:8px">
            <img src="${getIconURL('48.png')}" alt="WhatsHybrid Lite" class="whl-logo" />
            <span>WhatsHybrid Lite</span>
            <span class="status-badge stopped" id="whlStatusBadge">Parado</span>
          </div>
        </div>
        <button class="iconbtn" id="whlHide" title="Ocultar">—</button>
      </div>

      <!-- Tabs no topo do painel -->
      <div class="whl-tabs">
        <button class="whl-tab active" data-tab="principal">📱 Principal</button>
        <button class="whl-tab" data-tab="extrator">📥 Extrator</button>
        <button class="whl-tab" data-tab="grupos">👥 Grupos</button>
        <button class="whl-tab" data-tab="recover">🔄 Recover</button>
        <button class="whl-tab" data-tab="config">⚙️ Configurações</button>
      </div>

      <!-- Conteúdo da Aba Principal -->
      <div class="whl-tab-content active" id="whl-tab-principal">
        
        <div class="card">
          <!-- PR #78: Highlighted numbers field -->
          <div class="whl-input-highlight">
            <div class="title" style="font-size:14px;color:#00a884;font-weight:bold;margin-bottom:8px">📱 Números (um por linha)</div>
            <div class="muted" style="margin-bottom:8px">Cole sua lista aqui. Ex: 5511999998888</div>
            <textarea id="whlNumbers" placeholder="5511999998888
5511988887777" style="min-height:120px;background:rgba(0,0,0,0.3);border:2px solid #00a884"></textarea>
          </div>

          <div style="margin-top:10px">
            <div class="muted">📊 Importar CSV (phone,message opcional)</div>
            <div class="row" style="margin-top:6px">
              <button id="whlSelectCsvBtn" style="flex:1">📁 Escolher arquivo</button>
              <button id="whlClearCsvBtn" style="width:120px;display:none" title="Remover arquivo CSV">🗑️ Remover</button>
            </div>
            <input id="whlCsv" type="file" accept=".csv,text/csv" style="display:none" />
            <div class="tiny" id="whlCsvHint" style="margin-top:6px"></div>
          </div>

          <!-- PR #78: Highlighted message field -->
          <div class="whl-input-highlight" style="margin-top:16px">
            <div class="title" style="font-size:14px;color:#00a884;font-weight:bold;margin-bottom:8px">💬 Mensagem padrão</div>
            <div class="muted" style="margin-bottom:8px">
              Use variáveis: {{nome}}, {{first_name}}, {{phone}}
            </div>
            <div style="position:relative">
              <textarea id="whlMsg" placeholder="Digite sua mensagem…" style="min-height:120px;background:rgba(0,0,0,0.3);border:2px solid #00a884;padding-right:50px"></textarea>
              <button id="whlEmojiBtn" style="position:absolute;right:10px;top:10px;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.15);cursor:pointer;font-size:18px;line-height:1" title="Inserir emoji">😊</button>
            </div>
          </div>
          
          <!-- PR #78: Emoji Picker -->
          <div id="whlEmojiPicker" style="display:none;position:absolute;z-index:100000;background:rgba(8,6,20,0.98);border:1px solid rgba(111,0,255,0.35);border-radius:12px;padding:10px;max-width:300px;box-shadow:0 10px 30px rgba(0,0,0,0.5)">
            <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;max-height:200px;overflow-y:auto"></div>
          </div>
          
          <div style="margin-top:10px">
            <div class="muted">📸 Selecionar imagem (será enviada automaticamente)</div>
            <div class="row" style="margin-top:6px">
              <button id="whlSelectImageBtn" style="flex:1">📎 Anexar Imagem</button>
              <button id="whlClearImageBtn" style="width:120px" title="Remover imagem">🗑️ Remover</button>
            </div>
            <input id="whlImage" type="file" accept="image/*" style="display:none" />
            <div class="tiny" id="whlImageHint" style="margin-top:6px"></div>
          </div>
          
          <button id="whlSaveMessage" class="iconbtn primary" style="width:100%; margin-top:8px;">
            💾 Salvar Mensagem
          </button>

          <div class="card" style="margin-top:10px">
            <div class="title" style="font-size:13px">📱 Preview (WhatsApp)</div>
            <div class="muted">Como vai aparecer no WhatsApp:</div>
            <div class="wa-chat">
              <div class="wa-bubble">
                <img id="whlPreviewImg" alt="preview" style="display:none;width:100%;max-width:300px;max-height:300px;object-fit:contain;border-radius:12px;margin-bottom:8px;border:1px solid rgba(255,255,255,.10)" />
                <div id="whlPreviewText" style="white-space:pre-wrap"></div>
                <div class="wa-time"><span id="whlPreviewMeta"></span><span class="wa-ticks">✓✓</span></div>
              </div>
            </div>
          </div>

          <div class="row">
            <button class="primary" style="flex:1" id="whlBuild">Gerar tabela</button>
            <button style="width:170px" id="whlClear">Limpar</button>
          </div>

          <div class="tiny" id="whlHint"></div>
        </div>

        <div class="card">
          <div class="title" style="font-size:13px">📊 Progresso da Campanha</div>
          
          <div class="stats">
            <div class="stat-item">
              <div class="muted">Enviados</div>
              <span class="stat-value" id="whlStatSent">0</span>
            </div>
            <div class="stat-item">
              <div class="muted">Falhas</div>
              <span class="stat-value" id="whlStatFailed">0</span>
            </div>
            <div class="stat-item">
              <div class="muted">Pendentes</div>
              <span class="stat-value" id="whlStatPending">0</span>
            </div>
          </div>

          <div class="progress-bar">
            <div class="progress-fill" id="whlProgressFill" style="width:0%"></div>
          </div>
          <div class="tiny" style="margin-top:6px;text-align:center" id="whlProgressText">0%</div>
          <div class="tiny" style="margin-top:4px;text-align:center;color:#fbbf24" id="whlEstimatedTime"></div>

          <div class="row" style="margin-top:10px">
            <button class="success" style="flex:1" id="whlStartCampaign">▶️ Iniciar Campanha</button>
            <button class="warning" style="width:100px" id="whlPauseCampaign">⏸️ Pausar</button>
            <button class="danger" style="width:100px" id="whlStopCampaign">⏹️ Parar</button>
          </div>
        </div>

        <div class="card">
          <div class="title" style="font-size:13px">Tabela / Fila</div>
          <div class="muted" id="whlMeta">0 contato(s)</div>

          <div class="whl-queue-container">
            <table>
              <thead><tr><th>#</th><th>Número</th><th>Status</th><th>Ações</th></tr></thead>
              <tbody id="whlTable"></tbody>
            </table>
          </div>

          <div class="row" style="margin-top:8px">
            <button style="flex:1" id="whlSkip">Pular atual</button>
            <button class="danger" style="width:170px" id="whlWipe">Zerar fila</button>
          </div>

          <div class="tiny" id="whlStatus" style="margin-top:8px"></div>
        </div>

      </div>

      <!-- NOVA Aba Extrator -->
      <div class="whl-tab-content" id="whl-tab-extrator">
        <div class="card">
          <div class="title" style="font-size:13px">📥 Extrair Contatos</div>
          <div class="muted">Coleta números disponíveis no WhatsApp Web.</div>
          
          <div class="row" style="margin-top:10px">
            <button class="success" style="flex:1" id="whlExtractContacts">📥 Extrair contatos</button>
            <button style="width:150px" id="whlCopyExtracted">📋 Copiar Todos</button>
          </div>
          
          <!-- Seção: Contatos Normais -->
          <div class="extract-section" style="margin-top:12px">
            <label style="display:block;font-weight:700;margin-bottom:6px">
              📱 Contatos Normais (<span id="whlNormalCount">0</span>)
            </label>
            <textarea id="whlExtractedNumbers" placeholder="Clique em 'Extrair contatos'…" style="min-height:200px"></textarea>
            <button style="width:100%;margin-top:6px" id="whlCopyNormal">📋 Copiar Normais</button>
          </div>
          
          <!-- CORREÇÃO BUG 5: Seção: Contatos Arquivados - Fundo VERDE -->
          <div class="extract-section archived" id="whlArchivedSection" style="margin-top:12px;background:rgba(34,197,94,0.2);border:1px solid rgba(34,197,94,0.5);border-radius:8px;padding:12px">
            <label style="display:block;font-weight:700;margin-bottom:6px;color:#fff">
              📁 Arquivados (<span id="whlArchivedCount" style="color:#4ade80;font-weight:bold">0</span>)
            </label>
            <textarea id="whlArchivedNumbers" placeholder="Nenhum contato arquivado" style="min-height:120px;background:rgba(0,0,0,0.3);color:#fff;border:1px solid rgba(34,197,94,0.5)"></textarea>
            <button style="width:100%;margin-top:6px" id="whlCopyArchived">📋 Copiar Arquivados</button>
          </div>
          
          <!-- CORREÇÃO BUG 6: Seção: Contatos Bloqueados - Fundo VERMELHO ESCURO -->
          <div class="extract-section blocked" id="whlBlockedSection" style="margin-top:12px;background:rgba(185,28,28,0.2);border:1px solid rgba(185,28,28,0.5);border-radius:8px;padding:12px">
            <label style="display:block;font-weight:700;margin-bottom:6px;color:#fff">
              🚫 Bloqueados (<span id="whlBlockedCount" style="color:#f87171;font-weight:bold">0</span>)
            </label>
            <textarea id="whlBlockedNumbers" placeholder="Nenhum contato bloqueado" style="min-height:120px;background:rgba(0,0,0,0.3);color:#fff;border:1px solid rgba(185,28,28,0.5)"></textarea>
            <button style="width:100%;margin-top:6px" id="whlCopyBlocked">📋 Copiar Bloqueados</button>
          </div>
          
          <div class="tiny" id="whlExtractStatus" style="margin-top:10px;opacity:.8"></div>
          
          <button class="primary" style="width:100%;margin-top:8px" id="whlExportExtractedCsv">📥 Exportar CSV</button>
        </div>
      </div>

      <!-- Nova Aba: Grupos -->
      <div class="whl-tab-content" id="whl-tab-grupos">
        <div class="card">
          <div class="title">👥 Extrair Membros de Grupos</div>
          <div class="muted">Selecione um grupo para extrair os números dos participantes.</div>
          
          <div class="row" style="margin-top:10px">
            <button class="primary" style="flex:1" id="whlLoadGroups">🔄 Carregar Grupos</button>
          </div>
          
          <select id="whlGroupsList" size="8" style="width:100%;margin-top:10px;min-height:200px;background:rgba(255,255,255,0.05);color:#fff;border-radius:8px;padding:8px;border:1px solid rgba(255,255,255,0.1)">
            <option disabled style="color:#888">Clique em "Carregar Grupos" primeiro...</option>
          </select>
          
          <div class="row" style="margin-top:10px">
            <button class="success" style="flex:1" id="whlExtractGroupMembers">📥 Extrair Contatos</button>
          </div>
          
          <div style="margin-top:10px">
            <div class="muted">Membros extraídos: <span id="whlGroupMembersCount">0</span></div>
            
            <!-- OTIMIZAÇÃO: Progress indicator para extração -->
            <div id="whlExtractionProgress" class="extraction-progress">
              <div class="progress-text" id="whlExtractionProgressText">Iniciando...</div>
              <div class="progress-bar-container">
                <div class="progress-bar-fill" id="whlExtractionProgressBar" style="width: 0%"></div>
              </div>
              <div class="progress-count" id="whlExtractionProgressCount">0 membros</div>
            </div>
            
            <textarea id="whlGroupMembersNumbers" placeholder="Números dos membros..." style="min-height:200px;margin-top:6px"></textarea>
          </div>
          
          <button class="primary" style="width:100%;margin-top:10px" id="whlExportGroupCsv">📥 Exportar CSV</button>
        </div>
      </div>

      <!-- Nova Aba: Recover Ultra++ -->
      <div class="whl-tab-content" id="whl-tab-recover">
        <div class="card">
          <div class="title">🧠 RECOVER (Anti-Revoke)</div>
          <div class="muted">Recupera mensagens apagadas automaticamente. Sempre ativo.</div>
          
          <div class="stats" style="margin-top:10px;display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
            <div class="stat-item" style="text-align:center">
              <div class="muted" style="font-size:11px">Mensagens Recuperadas</div>
              <span class="stat-value" id="whlRecoveredCount" style="font-size:16px">0</span>
            </div>
            <div class="stat-item" style="text-align:center">
              <div class="muted" style="font-size:11px">Status</div>
              <span class="stat-value" id="whlRecoverStatus" style="font-size:13px;color:#4ade80">🟢 Ativo</span>
            </div>
          </div>
          
          <div class="whl-recover-timeline">
            <div class="timeline-header">
              <h3>📜 Timeline de Mensagens</h3>
              <span class="badge"><span id="whlRecoveredBadgeCount">0</span> mensagens</span>
            </div>
            
            <div class="timeline-content" id="whlRecoverHistory">
              <div class="muted" style="text-align:center;padding:20px">Nenhuma mensagem recuperada ainda...</div>
            </div>
          </div>
          
          <div class="row" style="margin-top:10px">
            <button class="primary" style="flex:1" id="whlExportRecovered">📥 Exportar JSON</button>
            <button class="danger" style="flex:1" id="whlClearRecovered">🗑️ Limpar Histórico</button>
          </div>
        </div>
      </div>

      <!-- Conteúdo da Aba Configurações -->
      <div class="whl-tab-content" id="whl-tab-config">

        <div class="card">
          <div class="title" style="font-size:13px">⚙️ Configurações de Automação</div>

          <div class="settings-wrap">
            <div class="settings-section-title">Parâmetros</div>
            <div class="settings-table">
              <div class="settings-row">
                <div class="settings-label">
                  <div class="k">🕐 Delay mínimo</div>
                  <div class="d">Tempo mínimo entre envios (seg)</div>
                </div>
                <div class="settings-control">
                  <input type="number" id="whlDelayMin" min="1" max="120" value="2" />
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-label">
                  <div class="k">🕐 Delay máximo</div>
                  <div class="d">Tempo máximo entre envios (seg)</div>
                </div>
                <div class="settings-control">
                  <input type="number" id="whlDelayMax" min="1" max="120" value="6" />
                </div>
              </div>

              <div class="settings-row">
                <div class="settings-label">
                  <div class="k">📅 Agendamento</div>
                  <div class="d">Inicia no horário definido</div>
                </div>
                <div class="settings-control">
                  <input type="datetime-local" id="whlScheduleAt" />
                </div>
              </div>
            </div>

            <!-- PR #78: Removed obsolete settings (Worker Oculto, Continuar em erros, Retry) -->
            
            <div class="settings-footer tiny" id="whlSelectorHealth"></div>
          </div>
        </div>

        <div class="card">
          <div class="title" style="font-size:13px">💾 Rascunhos</div>
          
          <div class="row" style="margin-top:10px">
            <input type="text" id="whlDraftName" placeholder="Nome do rascunho..." style="flex:1;padding:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff">
            <button style="width:100px;margin-left:8px" id="whlSaveDraft">💾 Salvar</button>
          </div>
          
          <div style="margin-top:10px;max-height:200px;overflow-y:auto">
            <table id="whlDraftsTable" style="width:100%;border-collapse:collapse">
              <thead>
                <tr style="border-bottom:1px solid rgba(255,255,255,0.1)">
                  <th style="padding:8px;text-align:left;font-size:11px">Nome</th>
                  <th style="padding:8px;text-align:left;font-size:11px">Data</th>
                  <th style="padding:8px;text-align:center;font-size:11px">Contatos</th>
                  <th style="padding:8px;text-align:center;font-size:11px">Ações</th>
                </tr>
              </thead>
              <tbody id="whlDraftsBody">
                <tr>
                  <td colspan="4" style="padding:12px;text-align:center;opacity:0.6;font-size:11px">Nenhum rascunho salvo</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="title" style="font-size:13px">📈 Relatórios</div>
          
          <div class="row" style="margin-top:10px">
            <button style="flex:1" id="whlExportReport">📈 Exportar relatório</button>
            <button style="flex:1" id="whlCopyFailed">📋 Copiar falhas</button>
          </div>
          <div class="tiny" id="whlReportHint" style="margin-top:6px"></div>
        </div>

      </div>
    `;
    document.body.appendChild(panel);
    return panel;
  }


  // ===== WHL FEATURES =====
  // Constants
  const PROGRESS_BAR_HIDE_DELAY = 3000; // ms to wait before hiding progress bar after completion
  
  // Use centralized phone validation from phone-validator.js
  const whlSanitize = window.WHL_PhoneValidator?.sanitizePhone || ((t) => String(t||'').replace(/\D/g,''));
  const whlIsValidPhone = window.WHL_PhoneValidator?.isValidPhone || function(t) {
    const s = whlSanitize(t);
    // Brazilian phone numbers should have at least 10 digits (DDD + number)
    return s.length >= 10 && s.length <= 15;
  };

  // Item 7: Detect and fix encoding errors in CSV processing
  function whlCsvToRows(text) {
    // Try to detect and fix encoding issues
    let processedText = String(text || '');
    
    // Fix common encoding issues (UTF-8 BOM, ISO-8859-1, Windows-1252)
    if (processedText.charCodeAt(0) === 0xFEFF) {
      // Remove UTF-8 BOM
      processedText = processedText.substring(1);
    }
    
    // Detect replacement characters indicating encoding issues
    try {
      // If text contains replacement character (�), try to decode as Latin-1
      if (processedText.includes('�')) {
        whlLog.warn('Possível erro de encoding detectado no CSV - caracteres especiais podem estar corrompidos');
        // Try to fix common encoding issues
        processedText = processedText.normalize('NFKD');
      }
    } catch (e) {
      whlLog.warn('Erro ao verificar encoding:', e);
    }
    
    const lines = processedText.replace(/\r/g,'').split('\n').filter(l=>l.trim().length);
    const rows = [];
    for (const line of lines) {
      const sep = (line.includes(';') && !line.includes(',')) ? ';' : ',';
      // minimal quoted handling
      const parts = [];
      let cur = '', inQ = false;
      for (let i=0;i<line.length;i++){
        const ch=line[i];
        if (ch === '"') { inQ = !inQ; continue; }
        if (!inQ && ch === sep) { parts.push(cur.trim()); cur=''; continue; }
        cur += ch;
      }
      parts.push(cur.trim());
      rows.push(parts);
    }
    return rows;
  }

  async function whlUpdateSelectorHealth() {
    const issues = [];
    // Verificar se campo de mensagem existe (para envio de imagem)
    if (!getMessageInput()) issues.push('Campo de mensagem não encontrado');
    const st = await getState();
    st.selectorHealth = { ok: issues.length===0, issues };
    await setState(st);
  }

  // DEPRECATED: Overlay functions removed - not needed for URL mode

  // Item 17: Display loading and feedback when exporting CSV
  async function whlExportReportCSV() {
    const hintEl = document.getElementById('whlReportHint');
    
    try {
      if (hintEl) {
        hintEl.textContent = '⏳ Exportando...';
        hintEl.style.color = '#fbbf24';
      }
      
      const st = await getState();
      const rows = [['phone','status','retries','timestamp']];
      const ts = new Date().toISOString();
      (st.queue||[]).forEach(x => rows.push([x.phone||'', x.status||'', String(x.retries||0), ts]));
      
      const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whl_report_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      if (hintEl) {
        hintEl.textContent = `✅ Exportado com sucesso! ${rows.length - 1} registros`;
        hintEl.style.color = '#4ade80';
      }
    } catch (err) {
      whlLog.error('Erro ao exportar CSV:', err);
      if (hintEl) {
        hintEl.textContent = '❌ Erro ao exportar CSV';
        hintEl.style.color = '#ef4444';
      }
    }
  }

  // Item 17: Display loading and feedback when exporting CSV
  async function whlExportExtractedCSV() {
    const extractedBox = document.getElementById('whlExtractedNumbers');
    const statusEl = document.getElementById('whlExtractStatus');
    
    if (!extractedBox) return;
    
    try {
      if (statusEl) {
        statusEl.textContent = '⏳ Exportando...';
        statusEl.style.color = '#fbbf24';
      }
      
      const numbersText = extractedBox.value || '';
      const numbers = numbersText.split(/\r?\n/).filter(n => n.trim().length > 0);
      
      if (numbers.length === 0) {
        alert('Nenhum número extraído para exportar. Por favor, extraia contatos primeiro.');
        if (statusEl) statusEl.textContent = '';
        return;
      }
      
      const rows = [['phone']];
      numbers.forEach(phone => rows.push([phone.trim()]));
      
      const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whl_extracted_contacts_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      
      if (statusEl) {
        statusEl.textContent = `✅ CSV exportado com sucesso! ${numbers.length} números`;
        statusEl.style.color = '#4ade80';
      }
    } catch (err) {
