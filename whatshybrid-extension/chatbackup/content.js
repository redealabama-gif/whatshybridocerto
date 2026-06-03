// ChatBackup - Content Script (ISOLATED)
// - Injects extractor.js into MAIN world
// - Uses bridge to load full history via WAWeb*
// - Differentiates sender/receiver and downloads images
(function () {
  "use strict";

  if (window.__chatbackup_content_loaded__) return;
  window.__chatbackup_content_loaded__ = true;

  const BRIDGE_NS = "chatbackup_bridge_v1";

  const SEL = {
    SIDE: "#pane-side",
    QR: 'canvas[aria-label*="QR"], [data-ref="qr-code"], [data-testid="qrcode"], [data-testid="qrcode-canvas"]'
  };

  // Inject extractor.js once
  function inject() {
    const extractorId = "__chatbackup_extractor__";
    if (!document.getElementById(extractorId)) {
      const s = document.createElement("script");
      s.id = extractorId;
      // NOTE: In this fused extension, the ChatBackup extractor lives under /chatbackup
      // to avoid filename collisions with the main extension's content scripts.
      s.src = chrome.runtime.getURL("chatbackup/extractor.js");
      s.onload = () => {
        console.log('[ChatBackup] Extractor loaded in MAIN world');
        s.remove();
      };
      s.onerror = () => {
        console.error('[ChatBackup] Failed to load extractor');
      };
      (document.head || document.documentElement).appendChild(s);
    }
  }

  inject();

  function isVisible(el) {
    if (!el) return false;
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 10 && r.height > 10;
  }

  function checkConnected() {
    const side = document.querySelector(SEL.SIDE);
    if (!side) return false;
    const qr = document.querySelector(SEL.QR);
    // Only treat as disconnected if QR is visible
    if (qr && isVisible(qr)) return false;
    return true;
  }

  function detectCurrentChat() {
    // Try multiple selectors for header
    const header = document.querySelector('#main header') || 
                   document.querySelector('[data-testid="conversation-header"]');
    if (!header) return null;
    
    // Buscar nome em vários lugares possíveis
    const titleEl = header.querySelector('span[dir="auto"]') ||
                    header.querySelector('span[title]') ||
                    header.querySelector('[data-testid="conversation-title"]');
    
    const name = titleEl?.getAttribute("title") || 
                 titleEl?.textContent?.trim() || 
                 "";
    
    if (!name) return null;

    // Detectar se é grupo
    const subtitle = header.querySelector('span[title] + span') ||
                     header.querySelector('[data-testid="conversation-info-header-chat-subtitle"]');
    const isGroup = subtitle?.textContent?.includes(",") || 
                    subtitle?.textContent?.includes("participantes") ||
                    subtitle?.textContent?.includes("participants");
    
    // Buscar avatar com múltiplos seletores
    const avatarEl = header.querySelector('img[draggable="false"]') ||
                     header.querySelector('img');
    const avatar = avatarEl?.src || null;

    return { name, isGroup, avatar };
  }

  async function getEnhancedChatInfo() {
    const basicInfo = detectCurrentChat();
    if (!basicInfo) return null;

    // Try to get additional info from bridge (including profile pic)
    try {
      const chatInfo = await bridge.getChatInfo();
      if (chatInfo?.profilePic) {
        return { ...basicInfo, avatar: chatInfo.profilePic };
      }
    } catch (e) {
      // Ignore errors, use basic info
    }

    return basicInfo;
  }

  class Bridge {
    constructor(onEvent) {
      this.pending = new Map();
      this.onEvent = onEvent;

      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.ns !== BRIDGE_NS) return;

        if (data.dir === "evt" && data.type) {
          try { this.onEvent?.(data.type, data.payload); } catch {}
          return;
        }

        if (data.dir === "res" && data.id) {
          const p = this.pending.get(data.id);
          if (!p) return;
          this.pending.delete(data.id);
          if (data.ok) p.resolve(data.result);
          else p.reject(new Error(data.error || "bridge_error"));
        }
      });
    }

    request(action, payload, timeoutMs = 120000) {
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const msg = { ns: BRIDGE_NS, dir: "req", id, action, payload };
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error("bridge_timeout"));
        }, timeoutMs);
        this.pending.set(id, {
          resolve: (v) => { clearTimeout(t); resolve(v); },
          reject: (e) => { clearTimeout(t); reject(e); }
        });
        window.postMessage(msg, "*");
      });
    }

    ping() { return this.request("ping", {}, 8000); }
    setCancel(cancel) { return this.request("setCancel", { cancel: !!cancel }, 4000); }
    getActiveChatMessages(opts, timeoutMs) { return this.request("getActiveChatMessages", opts || {}, timeoutMs || 300000); }
    getChatInfo() { return this.request("getChatInfo", {}, 8000); }
    getContacts() { return this.request("getContacts", {}, 30000); }
    getChatInfoById(chatId) { return this.request("getChatInfoById", { chatId }, 10000); }
    downloadMediaForExport(messages, options) { return this.request("downloadMediaForExport", { messages, options }, 600000); }
    createMediaZip(mediaFiles, zipName) { return this.request("createMediaZip", { mediaFiles, zipName }, 120000); }
  }

  let cancelRequested = false;
  let exporting = false;
  let currentChatCache = null;
  let currentExportSettings = null;
  
  // Track detailed media progress state
  const mediaProgressState = {
    images: { current: 0, total: 0, failed: 0 },
    videos: { current: 0, total: 0, failed: 0 },
    audios: { current: 0, total: 0, failed: 0 },
    docs: { current: 0, total: 0, failed: 0 }
  };

  const bridge = new Bridge((type, payload) => {
    if (!exporting) return;
    if (type === "waLoadProgress") {
      const loaded = payload?.loaded ?? 0;
      const target = payload?.target ?? 0;
      const attempt = payload?.attempt ?? 0;
      const maxLoads = payload?.maxLoads ?? 1;

      let percent = 5;
      if (payload?.phase === "tick") {
        // Adjust based on whether media export is enabled
        const hasMediaExport = exporting && (currentExportSettings?.exportImages || currentExportSettings?.exportVideos || currentExportSettings?.exportAudios || currentExportSettings?.exportDocs);
        const maxPercent = hasMediaExport ? 30 : 60;
        percent = Math.min(maxPercent, 5 + Math.round((attempt / Math.max(maxLoads, 1)) * (maxPercent - 5)));
      } else if (payload?.phase === "final") {
        const hasMediaExport = exporting && (currentExportSettings?.exportImages || currentExportSettings?.exportVideos || currentExportSettings?.exportAudios || currentExportSettings?.exportDocs);
        percent = hasMediaExport ? 30 : 60;
      }
      chrome.runtime.sendMessage({ type: "progress", current: loaded, total: target, percent, status: `Carregando histórico... (${loaded} msgs)` });
    }
    if (type === "mediaProgress") {
      const groupName = payload?.groupName || 'media';
      const current = payload?.current ?? 0;
      const total = payload?.total ?? 0;
      const failed = payload?.failed ?? 0;
      const groupLabel = groupName === 'images' ? 'imagens' : groupName === 'videos' ? 'vídeos' : groupName === 'audios' ? 'áudios' : 'documentos';
      
      // Update state
      if (mediaProgressState[groupName]) {
        mediaProgressState[groupName].current = current;
        mediaProgressState[groupName].total = total;
        mediaProgressState[groupName].failed = failed;
        
        // Send detailed progress to popup
        chrome.runtime.sendMessage({ 
          type: "mediaProgressDetailed", 
          data: {
            [groupName]: {
              current: mediaProgressState[groupName].current,
              total: mediaProgressState[groupName].total,
              failed: mediaProgressState[groupName].failed
            }
          }
        });
      }
      
      // Calculate percentage based on media type
      let percent = 50;
      if (groupName === 'images') {
        percent = 50 + Math.round((current / Math.max(total, 1)) * 10); // 50-60%
      } else if (groupName === 'videos') {
        percent = 60 + Math.round((current / Math.max(total, 1)) * 10); // 60-70%
      } else if (groupName === 'audios') {
        percent = 70 + Math.round((current / Math.max(total, 1)) * 10); // 70-80%
      } else if (groupName === 'docs') {
        percent = 80 + Math.round((current / Math.max(total, 1)) * 10); // 80-90%
      }
      
      const failedText = failed > 0 ? ` - ${failed} falharam` : '';
      chrome.runtime.sendMessage({ type: "progress", current, total, percent, status: `Baixando ${groupLabel}... (${current}/${total})${failedText}` });
    }
    if (type === "zipProgress") {
      const zipName = payload?.zipName || 'media';
      chrome.runtime.sendMessage({ type: "progress", percent: 90, status: `Gerando ZIP: ${zipName}` });
    }
  });

  // Listener immediate for background/popup ping
  // Listener immediate for background/popup messages (ChatBackup)
// IMPORTANT: This content script coexists with WhatsHybrid/Extractor content scripts.
// So we MUST only answer ChatBackup-specific actions to avoid breaking other modules.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (!msg || typeof msg !== "object") return false;

    // Never intercept the main Side Panel router messages
    if (msg.type === "WHL_SIDE_PANEL") return false;

    const action = msg.action;

    // Only handle ChatBackup actions
    const allowed = new Set([
      "ping",
      "getStatus",
      "cancelExport",
      "startExport",
      "getContacts",
    ]);

    if (!allowed.has(action)) {
      // Not for us -> let other content scripts respond
      return false;
    }

    if (action === "ping") {
      sendResponse({ pong: true });
      return true;
    }

    if (action === "getStatus") {
      (async () => {
        const connected = checkConnected();
        let chat = detectCurrentChat();

        // Try to get enhanced info with profile pic
        if (chat) {
          try {
            const enhanced = await getEnhancedChatInfo();
            if (enhanced) chat = enhanced;
          } catch (e) {
            // Use basic chat info
          }
        }

        currentChatCache = chat || currentChatCache;
        sendResponse({
          connected,
          currentChat: chat || currentChatCache,
          stats: { total: 0, media: 0, links: 0, docs: 0 },
          message: connected ? "Conectado" : "WhatsApp não conectado (faça login no QR Code)",
        });
      })().catch((e) => {
        sendResponse({ connected: false, success: false, error: String(e?.message || e) });
      });
      return true;
    }

    if (action === "cancelExport") {
      cancelRequested = true;
      bridge.setCancel(true).catch(() => {});
      sendResponse({ cancelled: true });
      return true;
    }

    if (action === "startExport") {
      startExport(msg.settings).then(() => {}).catch(() => {});
      sendResponse({ started: true });
      return true;
    }

    if (action === "getContacts") {
      (async () => {
        try {
          const contacts = await bridge.request("getContacts", {}, 30000);
          sendResponse(contacts);
        } catch (e) {
          sendResponse({ success: false, error: String(e?.message || e) });
        }
      })();
      return true;
    }

    return false;
  } catch (e) {
    // Only respond on error if this action was intended for ChatBackup
    try {
      if (msg && typeof msg === "object" && ["ping", "getStatus", "cancelExport", "startExport", "getContacts"].includes(msg.action)) {
        sendResponse({ success: false, error: String(e?.message || e) });
        return true;
      }
    } catch {}
    return false;
  }
});


  async function startExport(settings) {
    if (exporting) return;
    exporting = true;
    cancelRequested = false;
    currentExportSettings = settings;
    await bridge.setCancel(false).catch(() => {});
    document.documentElement.classList.add("chatbackup-exporting");
    
    // Reset media progress state
    mediaProgressState.images = { current: 0, total: 0, failed: 0 };
    mediaProgressState.videos = { current: 0, total: 0, failed: 0 };
    mediaProgressState.audios = { current: 0, total: 0, failed: 0 };
    mediaProgressState.docs = { current: 0, total: 0, failed: 0 };

    try {
      let chat = null;
      
      // Se temos um chatId do seletor, buscar info do chat via bridge
      if (settings.chatId) {
        try {
          const chatInfo = await bridge.getChatInfoById(settings.chatId);
          if (chatInfo?.ok && chatInfo.chat) {
            chat = {
              name: chatInfo.chat.name,
              isGroup: chatInfo.chat.isGroup,
              avatar: chatInfo.chat.profilePic || null
            };
          }
        } catch (e) {
          console.error("[ChatBackup] Erro ao buscar info do chat:", e);
        }
      }
      
      // Se não temos chatId ou falhou, tentar detectar chat aberto
      if (!chat) {
        chat = detectCurrentChat();
      }
      
      // Se ainda não temos chat, erro
      if (!chat) {
        throw new Error("Selecione um contato da lista ou abra uma conversa antes de exportar.");
      }
      
      currentChatCache = chat;
      chrome.runtime.sendMessage({ type: "chatUpdate", chat });

      // Ensure bridge ready
      await bridge.ping();

      const wantAll = settings.messageLimit === -1;
      const hardCap = 100000;
      const limit = wantAll ? -1 : Math.min(Number(settings.messageLimit) || 1000, hardCap);

      // heavier loads for all
      const maxLoads = wantAll ? 8000 : 1200;
      const delayMs = wantAll ? 900 : 650;
      
      const hasMediaExport = settings.exportImages || settings.exportVideos || settings.exportAudios || settings.exportDocs;

      chrome.runtime.sendMessage({ type: "progress", current: 0, total: wantAll ? hardCap : (limit || 0), percent: 2, status: "Buscando mensagens (API interna)..." });

      const wa = await bridge.getActiveChatMessages({ limit, maxLoads, delayMs, chatId: settings.chatId || null }, wantAll ? 360000 : 120000);
      if (!wa?.ok || !Array.isArray(wa.messages) || wa.messages.length === 0) {
        throw new Error("Falha ao obter mensagens via API interna. Abra a conversa e tente novamente.");
      }

      const normalized = normalizeWAMessages(wa.messages, settings, chat);
      
      // Adjust percentage based on whether media export is enabled
      const processPercent = hasMediaExport ? 35 : 70;
      chrome.runtime.sendMessage({ type: "progress", current: normalized.length, total: wa.target || 0, percent: processPercent, status: "Processando mensagens..." });

      const stamp = new Date().toISOString().slice(0, 10);
      const base = sanitizeFilename(`${chat.name}_${stamp}`);
      
      const generatePercent = hasMediaExport ? 45 : 85;
      chrome.runtime.sendMessage({ type: "progress", percent: generatePercent, status: "Gerando arquivo de texto..." });
      
      await generateExport(normalized, settings, chat);

      // Check if we need to download media
      if (settings.exportImages || settings.exportVideos || settings.exportAudios || settings.exportDocs) {
        chrome.runtime.sendMessage({ type: "progress", percent: 50, status: "Preparando download de mídias..." });
        
        try {
          const mediaResults = await bridge.downloadMediaForExport(wa.messages, {
            exportImages: settings.exportImages,
            exportVideos: settings.exportVideos,
            exportAudios: settings.exportAudios,
            exportDocs: settings.exportDocs
          });
          
          // Helper function to download from blob URL
          const downloadFromBlobUrl = async (zipResult, type, label, percent) => {
            if (zipResult?.blobUrl) {
              chrome.runtime.sendMessage({ type: "progress", percent, status: `Baixando ZIP de ${label}... (${zipResult.count} arquivos)` });
              
              // Generate final filename with chat name
              const finalFilename = `${base}_${type}.zip`;
              
              // Download using the blob URL directly
              await new Promise((resolve) => {
                chrome.runtime.sendMessage({ action: "download", url: zipResult.blobUrl, fileName: finalFilename }, () => {
                  // Clean up the blob URL after download
                  try {
                    URL.revokeObjectURL(zipResult.blobUrl);
                  } catch (e) {
                    // Ignore cleanup errors
                  }
                  resolve();
                });
              });
            }
          };
          
          // Download ZIPs for each media type with proper percentages
          if (settings.exportImages) {
            await downloadFromBlobUrl(mediaResults.images, 'imagens', 'imagens', 87);
          }
          
          if (settings.exportVideos) {
            await downloadFromBlobUrl(mediaResults.videos, 'videos', 'vídeos', 89);
          }
          
          if (settings.exportAudios) {
            await downloadFromBlobUrl(mediaResults.audios, 'audios', 'áudios', 90);
          }
          
          if (settings.exportDocs) {
            await downloadFromBlobUrl(mediaResults.docs, 'docs', 'documentos', 93);
          }
        } catch (e) {
          console.error("[ChatBackup] Erro ao processar mídias:", e);
          // Continue even if media export fails
        }
      }

      chrome.runtime.sendMessage({ type: "complete", count: normalized.length });
    } catch (e) {
      chrome.runtime.sendMessage({ type: "error", error: String(e?.message || e) });
    } finally {
      document.documentElement.classList.remove("chatbackup-exporting");
      exporting = false;
      currentExportSettings = null;
    }
  }

  function normalizeWAMessages(messages, settings, chat) {
    const out = [];
    const otherName = chat?.name || "Contato";
    
    // Parse date filters
    let fromDate = null;
    let toDate = null;
    if (settings.dateFrom) {
      fromDate = new Date(settings.dateFrom);
      fromDate.setHours(0, 0, 0, 0);
    }
    if (settings.dateTo) {
      toDate = new Date(settings.dateTo);
      toDate.setHours(23, 59, 59, 999);
    }

    for (const m of messages) {
      if (cancelRequested) break;

      const ts = (typeof m.t === "number") ? new Date(m.t * 1000) : null;
      
      // Apply date filter
      if (ts && fromDate && ts < fromDate) continue;
      if (ts && toDate && ts > toDate) continue;
      
      const timestamp = settings.includeTimestamps && ts ? ts.toLocaleString("pt-BR") : "";

      const isOutgoing = !!m.fromMe;
      const sender = settings.includeSender ? (isOutgoing ? "Você" : (m.sender || otherName)) : "";

      const text = m.text || "";

      // Skip empty
      if (!text) continue;

      out.push({ id: m.id || null, timestamp, sender, text, isOutgoing });
    }
    return out;
  }

  function sanitizeFilename(name) {
    return String(name || "file").replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_").slice(0, 180);
  }

  async function downloadBlob(blob, fileName) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      chrome.runtime.sendMessage({ action: "download", url, fileName }, () => {
        URL.revokeObjectURL(url);
        resolve();
      });
    });
  }

  async function generateExport(messages, settings, chat) {
    const stamp = new Date().toISOString().slice(0, 10);
    const base = sanitizeFilename(`${chat.name}_${stamp}`);
    
    let content = "";
    let mime = "text/plain;charset=utf-8";
    let ext = "txt";

    if (settings.format === "csv") {
      ({ content, mime, ext } = { content: generateCSV(messages, settings), mime: "text/csv;charset=utf-8", ext: "csv" });
    } else if (settings.format === "json") {
      ({ content, mime, ext } = { content: JSON.stringify({ chatName: chat.name, exportDate: new Date().toISOString(), messageCount: messages.length, messages }, null, 2), mime: "application/json;charset=utf-8", ext: "json" });
    } else if (settings.format === "html") {
      ({ content, mime, ext } = { content: generateHTML(messages, settings, chat), mime: "text/html;charset=utf-8", ext: "html" });
    } else {
      ({ content, mime, ext } = { content: generateTXT(messages, settings, chat), mime: "text/plain;charset=utf-8", ext: "txt" });
    }

    await downloadBlob(new Blob([content], { type: mime }), `${base}.${ext}`);
  }

  function escCSV(s) { return String(s || "").replace(/"/g, '""').replace(/\n/g, " "); }
  function escHTML(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function generateCSV(messages, settings) {
    const headers = [];
    if (settings.includeTimestamps) headers.push("Data/Hora");
    if (settings.includeSender) headers.push("Remetente");
    headers.push("Mensagem");
    headers.push("Tipo");

    const rows = [headers.join(",")];
    for (const m of messages) {
      const cols = [];
      if (settings.includeTimestamps) cols.push(`"${escCSV(m.timestamp)}"`);
      if (settings.includeSender) cols.push(`"${escCSV(m.sender)}"`);
      cols.push(`"${escCSV(m.text)}"`);
      cols.push(m.isOutgoing ? "Enviada" : "Recebida");
      rows.push(cols.join(","));
    }
    return "\uFEFF" + rows.join("\n");
  }

  function generateTXT(messages, settings, chat) {
    const lines = [
      `Exportação do WhatsApp - ${chat.name}`,
      `Data: ${new Date().toLocaleString("pt-BR")}`,
      `Total: ${messages.length} mensagens`,
      "=".repeat(50),
      ""
    ];
    for (const m of messages) {
      let line = "";
      if (settings.includeTimestamps && m.timestamp) line += `[${m.timestamp}] `;
      if (settings.includeSender && m.sender) line += `${m.sender}: `;
      line += m.text || "";
      lines.push(line);
    }
    return lines.join("\n");
  }

  function generateHTML(messages, settings, chat) {
    let htmlMsgs = "";
    for (const m of messages) {
      const cls = m.isOutgoing ? "out" : "in";
      htmlMsgs += `
        <div class="msg ${cls}">
          ${settings.includeSender ? `<div class="sender">${escHTML(m.sender)}</div>` : ""}
          <div class="text">${escHTML(m.text)}</div>
          ${settings.includeTimestamps ? `<div class="time">${escHTML(m.timestamp)}</div>` : ""}
        </div>
      `;
    }

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WhatsApp - ${escHTML(chat.name)}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#efeae2;margin:0;padding:18px}
    .wrap{max-width:860px;margin:0 auto}
    .head{background:#075E54;color:#fff;padding:16px;border-radius:12px}
    .head h1{margin:0;font-size:18px}
    .head p{margin:6px 0 0;font-size:12px;opacity:.85}
    .chat{margin-top:12px;padding:14px;background:rgba(255,255,255,.65);border-radius:12px}
    .msg{max-width:70%;padding:10px 12px;border-radius:10px;margin:8px 0;box-shadow:0 1px 0.5px rgba(0,0,0,.13)}
    .msg.in{background:#fff;margin-right:auto;border-top-left-radius:0}
    .msg.out{background:#DCF8C6;margin-left:auto;border-top-right-radius:0}
    .sender{font-weight:700;color:#075E54;font-size:12px;margin-bottom:2px}
    .text{font-size:14px;white-space:pre-wrap}
    .time{font-size:11px;color:#667781;text-align:right;margin-top:6px}
    .foot{margin-top:12px;text-align:center;color:#667781;font-size:12px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <h1>${escHTML(chat.name)}</h1>
      <p>Exportado em ${new Date().toLocaleString("pt-BR")} • ${messages.length} mensagens</p>
    </div>
    <div class="chat">${htmlMsgs}</div>
    <div class="foot">Exportado com ChatBackup • 100% local</div>
  </div>
</body>
</html>`;
  }
})();
