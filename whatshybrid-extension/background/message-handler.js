// ===== STRICT MODE =====
'use strict';

// =============================================================================
// Message/Template utilities + NetSniffer (extracted from background.js)
// =============================================================================

// Configuration constants
const NETSNIFFER_CLEANUP_INTERVAL_MS = 300000; // 5 minutes - periodic cleanup to prevent memory leaks
const NETSNIFFER_MAX_PHONES = 5000; // Reduced from 10000 to prevent excessive memory usage

// Função para substituir variáveis dinâmicas na mensagem
function substituirVariaveis(mensagem, contato) {
  if (!mensagem) return '';
  
  let nome = '';
  let firstName = '';
  let lastName = '';
  let phone = '';
  
  if (typeof contato === 'object' && contato !== null) {
    nome = contato.name || contato.pushname || contato.nome || '';
    phone = contato.phone || contato.number || contato.telefone || '';
  } else {
    phone = String(contato || '');
  }
  
  if (nome) {
    const partes = nome.split(' ').filter(p => p.length > 0);
    firstName = partes[0] || '';
    lastName = partes.slice(1).join(' ') || '';
  }
  
  const hour = new Date().getHours();
  let saudacao = 'Olá';
  if (hour >= 5 && hour < 12) saudacao = 'Bom dia';
  else if (hour >= 12 && hour < 18) saudacao = 'Boa tarde';
  else saudacao = 'Boa noite';
  
  const now = new Date();
  const data = now.toLocaleDateString('pt-BR');
  const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  const replaceVar = (str, varName, value) => {
    const regex1 = new RegExp(`\\{\\{${varName}\\}\\}`, 'gi');
    const regex2 = new RegExp(`\\{${varName}\\}`, 'gi');
    return str.replace(regex1, value).replace(regex2, value);
  };
  
  let result = mensagem;
  result = replaceVar(result, 'nome', nome);
  result = replaceVar(result, 'name', nome);
  result = replaceVar(result, 'first_name', firstName);
  result = replaceVar(result, 'primeiro_nome', firstName);
  result = replaceVar(result, 'last_name', lastName);
  result = replaceVar(result, 'sobrenome', lastName);
  result = replaceVar(result, 'phone', phone);
  result = replaceVar(result, 'telefone', phone);
  result = replaceVar(result, 'numero', phone);
  result = replaceVar(result, 'saudacao', saudacao);
  result = replaceVar(result, 'greeting', saudacao);
  result = replaceVar(result, 'data', data);
  result = replaceVar(result, 'date', data);
  result = replaceVar(result, 'hora', hora);
  result = replaceVar(result, 'time', hora);
  
  return result;
}

const NetSniffer = {
  phones: new Set(),
  lastCleanup: Date.now(),
  cleanupIntervalId: null,
  
  init() {
    chrome.webRequest.onBeforeRequest.addListener(
      det => this.req(det),
      { urls: ["https://web.whatsapp.com/*", "https://*.whatsapp.net/*"] },
      ["requestBody"]
    );
    chrome.webRequest.onCompleted.addListener(
      det => this.resp(det),
      { urls: ["https://web.whatsapp.com/*", "https://*.whatsapp.net/*"] }
    );
    
    // Start periodic cleanup to prevent memory leaks
    this.startPeriodicCleanup();
  },
  
  /**
   * Periodic cleanup to prevent unbounded memory growth
   * 
   * NOTA: Em Service Workers (Manifest V3), não há beforeunload.
   * O Chrome gerencia automaticamente o ciclo de vida do SW,
   * encerrando-o quando ocioso. Este interval é seguro porque:
   * 1. O SW é reiniciado quando necessário
   * 2. O interval é recriado a cada inicialização
   * 3. Não há acúmulo de intervals entre sessões
   */
  startPeriodicCleanup() {
    // Limpar interval anterior se existir (para reinicializações)
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }
    
    this.cleanupIntervalId = setInterval(() => {
      const now = Date.now();
      const timeSinceLastCleanup = now - this.lastCleanup;
      
      // Only clean if interval has passed
      if (timeSinceLastCleanup >= NETSNIFFER_CLEANUP_INTERVAL_MS) {
        this.cleanup();
      }
    }, NETSNIFFER_CLEANUP_INTERVAL_MS);
  },
  
  /**
   * Clean up phones set to prevent memory leaks
   */
  cleanup() {
    console.log(`[NetSniffer] Cleanup: ${this.phones.size} phones in memory`);
    
    // If we have too many phones, clear the set
    if (this.phones.size > NETSNIFFER_MAX_PHONES) {
      console.log(`[NetSniffer] Clearing phones set (exceeded ${NETSNIFFER_MAX_PHONES})`);
      this.phones.clear();
    }
    
    this.lastCleanup = Date.now();
  },
  req(det) {
    try {
      if (det.requestBody) {
        if (det.requestBody.formData) Object.values(det.requestBody.formData).forEach(vals => vals.forEach(v => this.detect(v)));
        if (det.requestBody.raw) det.requestBody.raw.forEach(d => {
          if (d.bytes) {
            let t = new TextDecoder().decode(new Uint8Array(d.bytes));
            this.detect(t);
          }
        });
      }
      this.detect(det.url);
    } catch (err) {
      console.warn('[NetSniffer] Error processing request:', err.message);
    }
  },
  resp(_det) {
    if (this.phones.size) {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'netPhones', phones: Array.from(this.phones) })
            .catch(err => {
              console.log('[NetSniffer] Não foi possível enviar phones para content script:', err.message);
            });
        }
      });
    }
  },
  detect(t) {
    if (!t) return;
    // Security fix: Only use WhatsApp-specific pattern to avoid false positives
    for (let m of t.matchAll(/(\d{10,15})@c\.us/g)) this.phones.add(m[1]);
  }
};

NetSniffer.init();

// Expor em namespace para debug
self.WHLBackgroundMessage = self.WHLBackgroundMessage || {};
self.WHLBackgroundMessage.substituirVariaveis = substituirVariaveis;
self.WHLBackgroundMessage.NetSniffer = NetSniffer;

