// ===== STRICT MODE =====
'use strict';

// =============================================================================
// IA-05 — Trava do autopilot entre abas.
//
// Com duas abas do WhatsApp Web abertas, cada uma roda o seu autopilot e as
// duas recebiam a MESMA mensagem → o cliente levava duas respostas. Antes de
// gerar a resposta, o autopilot pede aqui a "reserva" da mensagem (chave =
// id da mensagem do WhatsApp, igual nas duas abas). O service worker é um só
// para todas as abas e o teste-e-grava abaixo é síncrono (depois do load
// inicial), então só a primeira aba ganha. A mesma aba pode pedir de novo (item
// reenfileirado). Reservas expiram em 30 min; ficam em chrome.storage.session
// para sobreviver ao reinício do service worker.
// =============================================================================

const AUTOPILOT_CLAIM_TTL_MS = 30 * 60 * 1000;
const AUTOPILOT_CLAIM_STORAGE_KEY = 'whl_autopilot_claims';
const _autopilotClaims = new Map(); // key -> { tabId, at }
let _autopilotClaimsReady = null;

function _autopilotClaimsArea() {
  return (chrome.storage && (chrome.storage.session || chrome.storage.local)) || null;
}

function _loadAutopilotClaims() {
  if (!_autopilotClaimsReady) {
    _autopilotClaimsReady = (async () => {
      try {
        const area = _autopilotClaimsArea();
        if (!area) return;
        const data = await area.get(AUTOPILOT_CLAIM_STORAGE_KEY);
        const saved = data && data[AUTOPILOT_CLAIM_STORAGE_KEY];
        if (saved && typeof saved === 'object') {
          for (const [k, v] of Object.entries(saved)) {
            if (!_autopilotClaims.has(k)) _autopilotClaims.set(k, v);
          }
        }
      } catch (_) { /* sem persistência: segue só em memória */ }
    })();
  }
  return _autopilotClaimsReady;
}

function _persistAutopilotClaims() {
  try {
    const area = _autopilotClaimsArea();
    if (!area) return;
    const obj = {};
    for (const [k, v] of _autopilotClaims) obj[k] = v;
    const p = area.set({ [AUTOPILOT_CLAIM_STORAGE_KEY]: obj });
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) { /* melhor esforço */ }
}

async function handleAutopilotClaim(message, sender, sendResponse) {
  try {
    await _loadAutopilotClaims();
    // Daqui até o sendResponse é síncrono: teste-e-grava atômico no SW.
    const key = String((message && message.key) || '');
    if (!key) {
      sendResponse({ granted: false, reason: 'no_key' });
      return;
    }
    const now = Date.now();
    for (const [k, v] of _autopilotClaims) {
      if (!v || now - v.at > AUTOPILOT_CLAIM_TTL_MS) _autopilotClaims.delete(k);
    }
    const tabId = sender && sender.tab ? sender.tab.id : null;
    const prev = _autopilotClaims.get(key);
    if (prev && prev.tabId !== tabId) {
      sendResponse({ granted: false, reason: 'claimed_by_other_tab' });
      return;
    }
    _autopilotClaims.set(key, { tabId, at: now });
    _persistAutopilotClaims();
    sendResponse({ granted: true });
  } catch (e) {
    sendResponse({ granted: false, reason: 'error', error: e && e.message });
  }
}
