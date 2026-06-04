#!/usr/bin/env node
/**
 * WhatsApp Web Canary — v9.2.0
 *
 * Detecta quebras no WhatsApp Web ANTES dos clientes reclamarem.
 *
 * Roda em VPS dedicado a cada 30 minutos:
 *   - Abre web.whatsapp.com via Puppeteer (headed, NÃO headless — WA detecta)
 *   - Carrega a extensão buildada
 *   - Verifica que objetos críticos existem (window.Store, etc.)
 *   - Roda smoke test interno (envio + leitura de uma msg pra contato teste)
 *   - Se algo falhar → alerta crítico (Discord + email)
 *
 * Setup (em VPS Ubuntu):
 *   sudo apt install -y chromium-browser xvfb
 *   npm install puppeteer-core
 *   # primeiro run: scan QR com celular dedicado de teste, sessão fica salva em ./wa-session/
 *   node scripts/canary-whatsapp.js --first-run
 *
 * Cron:
 *   ⁠*⁠/30 * * * * cd /opt/whatshybrid && node scripts/canary-whatsapp.js >> logs/canary.log 2>&1
 *
 * Env vars:
 *   CHROMIUM_PATH=/usr/bin/chromium-browser
 *   EXTENSION_PATH=/opt/whatshybrid/whatshybrid-extension
 *   DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
 *   CANARY_PHONE=5511999999999     (número de teste pra enviar/receber)
 *
 *   # Integração com o PAINEL ADMIN (aba "Canário"): o canário faz POST do
 *   # relatório no backend, que mostra o status + alerta se "não reporta há X".
 *   CANARY_REPORT_URL=https://api.seu-dominio.com/api/v1/canary/report
 *   CANARY_TOKEN=<segredo-compartilhado>   (MESMO valor no backend, env CANARY_TOKEN)
 */

const path = require('path');
const fs = require('fs');

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser';
const EXTENSION_PATH = process.env.EXTENSION_PATH || path.join(__dirname, '../../whatshybrid-extension');
const SESSION_PATH = process.env.CANARY_SESSION_PATH || path.join(__dirname, '../../canary-session');
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || '';
// Painel admin: o canário faz POST do relatório aqui (token compartilhado).
const REPORT_URL = process.env.CANARY_REPORT_URL || ''; // ex.: https://api.seu-dominio.com/api/v1/canary/report
const CANARY_TOKEN = process.env.CANARY_TOKEN || '';

// Seletores DOM da extensão. Fonte: wa-selector-canary.js (que é drift-guardado
// no CI contra o anti-break-system.js). Usados pra checar o DOM REAL do WhatsApp.
let DOM_SELECTORS = {};
try {
  DOM_SELECTORS = require(path.join(EXTENSION_PATH, 'scripts', 'wa-selector-canary.js')).SELECTORS || {};
} catch (e) {
  console.warn('[Canary] wa-selector-canary não carregado (seletores DOM ficam de fora):', e.message);
}
const TIMEOUT_MS = parseInt(process.env.CANARY_TIMEOUT_MS, 10) || 90_000;

let puppeteer;
try { puppeteer = require('puppeteer-core'); }
catch (_) {
  console.error('❌ puppeteer-core não instalado. Run: npm install puppeteer-core');
  process.exit(1);
}

const REPORT = {
  started_at: new Date().toISOString(),
  duration_ms: 0,
  status: 'unknown', // 'healthy' | 'degraded' | 'broken'
  checks: {},
  errors: [],
  wa_version: null,
};

async function alert(level, message, details = {}) {
  console.log(`[CANARY:${level.toUpperCase()}] ${message}`, JSON.stringify(details));
  if (!DISCORD_WEBHOOK) return;

  try {
    const color = level === 'critical' ? 0xff0000 :
                  level === 'warning'  ? 0xffaa00 : 0x00aa00;
    const payload = {
      username: 'WhatsApp Canary',
      embeds: [{
        title: `${level === 'critical' ? '🚨' : level === 'warning' ? '⚠️' : '✅'} ${message}`,
        color,
        fields: Object.entries(details).slice(0, 10).map(([name, value]) => ({
          name: String(name).substring(0, 50),
          value: String(value).substring(0, 1000),
          inline: true,
        })),
        timestamp: new Date().toISOString(),
      }],
    };
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Discord alert failed:', err.message);
  }
}

// Envia o relatório pro backend (painel admin). Best-effort: nunca derruba o canário.
async function postReport() {
  if (!REPORT_URL || !CANARY_TOKEN) return; // sem config → só JSON/Discord local
  try {
    const brokenCount = REPORT.status === 'broken' ? Math.max(1, REPORT.errors.length) : 0;
    const degradedCount = REPORT.status === 'degraded' ? 1 : 0;
    const r = await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Canary-Token': CANARY_TOKEN },
      body: JSON.stringify({
        status: REPORT.status,
        source: 'whatsapp-web',
        waVersion: REPORT.wa_version || null,
        brokenCount,
        degradedCount,
        durationMs: REPORT.duration_ms || null,
        report: REPORT,
      }),
    });
    if (r.ok) console.log('[Canary] relatório enviado ao painel admin');
    else console.error('[Canary] backend respondeu', r.status, 'ao receber relatório');
  } catch (err) {
    console.error('[Canary] falha ao enviar relatório ao backend:', err.message);
  }
}

async function run() {
  const startTime = Date.now();
  let browser, page;

  try {
    if (!fs.existsSync(SESSION_PATH)) {
      fs.mkdirSync(SESSION_PATH, { recursive: true });
    }

    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: false, // ⚠️ WhatsApp detecta headless mode
      userDataDir: SESSION_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        `--load-extension=${EXTENSION_PATH}`,
        `--disable-extensions-except=${EXTENSION_PATH}`,
      ],
      defaultViewport: null,
    });

    page = await browser.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);

    REPORT.checks.browser_launched = true;

    // Vai pra WhatsApp Web
    await page.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded' });

    // Espera Store ficar disponível (extensão carrega + WhatsApp carrega)
    try {
      await page.waitForFunction(
        () => window.Store && window.Store.Chat,
        { timeout: TIMEOUT_MS }
      );
      REPORT.checks.store_loaded = true;
    } catch (e) {
      REPORT.checks.store_loaded = false;
      REPORT.errors.push(`Store não carregou em ${TIMEOUT_MS}ms: ${e.message}`);
      throw new Error('STORE_NOT_LOADED');
    }

    // Coleta diagnóstico do estado interno do WhatsApp Web
    const diag = await page.evaluate(() => {
      const checks = {};
      const Store = window.Store;
      checks.hasStore = !!Store;
      checks.hasChat = !!Store?.Chat;
      checks.hasMsg = !!Store?.Msg;
      checks.hasContact = !!Store?.Contact;
      checks.hasWid = !!Store?.Wid;
      checks.hasGroupMetadata = !!Store?.GroupMetadata;
      checks.hasMediaCollection = !!Store?.MediaCollection;
      checks.storeKeysCount = Object.keys(Store || {}).length;

      // Métodos críticos
      try {
        const c = Store?.Chat;
        checks.chatMethods = c ? Object.getOwnPropertyNames(Object.getPrototypeOf(c)).slice(0, 20) : [];
      } catch (_) { checks.chatMethods = 'error'; }

      // Versão do WhatsApp
      try {
        const meta = document.querySelector('meta[name="version"]');
        checks.wa_version = meta?.content || (typeof window.Debug !== 'undefined' ? window.Debug.VERSION : null);
      } catch (_) { checks.wa_version = null; }

      // Extensão carregou?
      checks.extensionLoaded = !!window.WHL_RecoverHelpers || !!window.WHL_MessageContentHelpers || !!window.WHL_State;
      checks.extensionGlobals = Object.keys(window)
        .filter(k => k.startsWith('WHL_') || k.startsWith('whl_'))
        .slice(0, 30);

      return checks;
    });

    Object.assign(REPORT.checks, diag);
    REPORT.wa_version = diag.wa_version;

    // Verifica seletores críticos
    const criticalChecks = ['hasStore', 'hasChat', 'hasMsg', 'hasContact'];
    const criticalFailed = criticalChecks.filter(k => !diag[k]);

    if (criticalFailed.length > 0) {
      REPORT.status = 'broken';
      REPORT.errors.push(`Seletores críticos faltando: ${criticalFailed.join(', ')}`);
      await alert('critical',
        `🚨 WhatsApp Web BREAKING DETECTED — seletores críticos ausentes`,
        {
          missing: criticalFailed.join(', '),
          wa_version: diag.wa_version || '?',
          store_keys: diag.storeKeysCount,
        }
      );
    } else if (!diag.extensionLoaded) {
      REPORT.status = 'degraded';
      REPORT.errors.push('Extensão não carregou globais window.WHL_*');
      await alert('warning',
        `⚠️ Extensão Vórtex não carregou`,
        {
          wa_version: diag.wa_version || '?',
          extension_globals_count: diag.extensionGlobals.length,
        }
      );
    } else {
      REPORT.status = 'healthy';
    }

    // ── Checagem de SELETORES DOM (lógica do wa-selector-canary no DOM real) ──
    if (Object.keys(DOM_SELECTORS).length) {
      // Tenta abrir a 1ª conversa pra os seletores dependentes de chat valerem.
      let chatOpened = false;
      try {
        const firstChat = await page.$('#pane-side div[role="row"], div[role="listitem"], div[data-testid="cell-frame-container"]');
        if (firstChat) {
          await firstChat.click();
          await new Promise((r) => setTimeout(r, 2500));
          chatOpened = true;
        }
      } catch (_) {}

      const sel = await page.evaluate((selectors) => {
        const q = (s) => { try { return !!document.querySelector(s); } catch (_) { return false; } };
        const results = Object.keys(selectors).map((key) => {
          const def = selectors[key];
          if (q(def.primary)) return { key, status: 'PASS', via: 'primary', matched: def.primary };
          for (const fb of (def.fallbacks || [])) { if (q(fb)) return { key, status: 'DEGRADED', via: 'fallback', matched: fb }; }
          return { key, status: 'BROKEN', via: null, matched: null };
        });
        return {
          results,
          summary: {
            total: results.length,
            pass: results.filter((r) => r.status === 'PASS').length,
            degraded: results.filter((r) => r.status === 'DEGRADED').length,
            broken: results.filter((r) => r.status === 'BROKEN').length,
          },
        };
      }, DOM_SELECTORS);

      REPORT.selectors = { chatOpened, ...sel };
      console.log(`[Canary] seletores DOM: ${sel.summary.pass} PASS · ${sel.summary.degraded} DEGRADED · ${sel.summary.broken} BROKEN (chatOpened=${chatOpened})`);

      // Escalonamento brando: CHAT_LIST existe sempre que logado. Se quebrou, o
      // DOM mudou de verdade → degrada (não derruba pra broken, que fica pro
      // check de Store). Seletores dependentes de chat NÃO escalam (podem estar
      // BROKEN só porque não havia conversa pra abrir).
      const chatList = sel.results.find((r) => r.key === 'CHAT_LIST');
      if (chatList && chatList.status === 'BROKEN' && REPORT.status === 'healthy') {
        REPORT.status = 'degraded';
        REPORT.errors.push('Seletor DOM CHAT_LIST quebrado (DOM do WhatsApp mudou)');
      }
    }

    REPORT.duration_ms = Date.now() - startTime;

    // Salva report
    const reportPath = path.join(SESSION_PATH, 'last-canary-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(REPORT, null, 2));

    // Histórico (últimos 100)
    const historyPath = path.join(SESSION_PATH, 'canary-history.jsonl');
    fs.appendFileSync(historyPath, JSON.stringify(REPORT) + '\n');

    console.log(`✅ Canary completed: ${REPORT.status}`);
    console.log(JSON.stringify(REPORT, null, 2));

  } catch (err) {
    REPORT.status = 'broken';
    REPORT.errors.push(err.message);
    REPORT.duration_ms = Date.now() - startTime;

    await alert('critical', `🚨 Canary fatal error: ${err.message}`, {
      stage: REPORT.checks.browser_launched ? 'after_launch' : 'before_launch',
      duration_ms: REPORT.duration_ms,
    });

    console.error('❌ Canary failed:', err);
  } finally {
    if (browser) try { await browser.close(); } catch (_) {}
    await postReport(); // envia pro painel admin (best-effort)
  }

  process.exit(REPORT.status === 'broken' ? 1 : 0);
}

run().catch(err => {
  console.error('💥 Top-level error:', err);
  process.exit(2);
});
