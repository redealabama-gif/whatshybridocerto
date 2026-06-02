/**
 * wa-selector-canary.js — Canário de seletores do WhatsApp Web
 * ----------------------------------------------------------------------------
 * Detecta quando o WhatsApp Web muda o DOM e quebra os seletores que a extensão
 * usa (fonte de verdade: modules/anti-break-system.js → objeto SELECTORS).
 *
 * Zero dependências. Dois modos:
 *
 *  1) NAVEGADOR — cole o arquivo inteiro no console do https://web.whatsapp.com
 *     (de preferência com UMA conversa aberta) e rode:
 *
 *         WACanary.run()
 *
 *     Checa cada seletor contra o DOM real e imprime uma tabela:
 *       ✅ PASS      o `primary` casou
 *       ⚠️ DEGRADED  o `primary` falhou, mas um `fallback` casou (atenção!)
 *       ❌ BROKEN    nada casou (o WhatsApp provavelmente mudou o DOM)
 *
 *  2) NODE / CI — `node scripts/wa-selector-canary.js`
 *     Valida a forma da cópia embutida + GUARD DE DRIFT: re-parseia o
 *     anti-break-system.js real e falha (exit 1) se os seletores de runtime
 *     divergirem da cópia embutida aqui. Assim o canário nunca fica
 *     desatualizado em silêncio: mexeu nos seletores → tem que mexer aqui.
 * ----------------------------------------------------------------------------
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    // Quando invocado direto (`node wa-selector-canary.js`), roda o modo CI.
    if (require.main === module) api._cli();
  } else {
    root.WACanary = api;
    try {
      console.info('%c[WACanary] pronto — rode  WACanary.run()  (abra uma conversa antes)',
        'color:#22c55e;font-weight:700');
    } catch (_) {}
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ──────────────────────────────────────────────────────────────────────────
  // Cópia embutida dos seletores. Mantida em sincronia com
  // modules/anti-break-system.js pelo guard de drift (modo CI). Embutir é
  // necessário para o modo navegador ser standalone (copiar-e-colar sem
  // importar nada). Use ASPAS SIMPLES (os seletores têm " por dentro).
  // ──────────────────────────────────────────────────────────────────────────
  const SELECTORS = {
    MAIN_CHAT: {
      primary: 'div[data-tab="1"]',
      fallbacks: ['#main', 'div[role="main"]', 'div._1hI5g', 'div.two._1jJ70'],
      description: 'Container principal do chat',
    },
    MESSAGE_INPUT: {
      primary: 'div[contenteditable="true"][data-tab="10"]',
      fallbacks: [
        'div[contenteditable="true"][data-tab="6"]',
        'footer div[contenteditable="true"]',
        'div[role="textbox"]',
        '.copyable-text.selectable-text',
        'div._1awRl',
      ],
      description: 'Campo de digitação de mensagem',
    },
    SEND_BUTTON: {
      primary: 'button[data-tab="11"]',
      fallbacks: [
        'span[data-icon="send"]',
        'button[aria-label*="Enviar"]',
        'button[aria-label*="Send"]',
        'button._1U1xa',
      ],
      description: 'Botão de enviar mensagem',
    },
    CHAT_LIST: {
      primary: 'div[aria-label="Lista de conversas"]',
      fallbacks: ['#pane-side', 'div[role="listitem"]', 'div._1IlAS', 'div.infinite-list-viewport'],
      description: 'Lista de conversas',
    },
    CHAT_ITEM: {
      primary: 'div[data-id]',
      fallbacks: ['div[data-testid="cell-frame-container"]', 'div._199zF', 'div[role="row"]'],
      description: 'Item de conversa na lista',
    },
    MESSAGE_LIST: {
      primary: 'div[data-tab="8"]',
      fallbacks: ['div.message-list', 'div._1_keJ', 'div[role="application"] > div > div'],
      description: 'Lista de mensagens do chat',
    },
    MESSAGE_ITEM: {
      primary: 'div[data-id^="true_"] , div[data-id^="false_"]',
      fallbacks: ['div.message-in, div.message-out', 'div[class*="message"]', 'div._1gux_'],
      description: 'Mensagem individual',
    },
    CHAT_HEADER: {
      primary: 'header',
      fallbacks: ['div[data-testid="conversation-header"]', 'div._2au8k', '#main header'],
      description: 'Header da conversa atual',
    },
    CONTACT_NAME: {
      primary: 'header span[dir="auto"]',
      fallbacks: [
        'span[data-testid="conversation-info-header-chat-title"]',
        'header ._1hI5g span',
        'header span.ggj6brxn',
      ],
      description: 'Nome do contato no header',
    },
    CONNECTION_STATUS: {
      primary: 'span[data-testid="status"]',
      fallbacks: ['span[title*="clique aqui"]', 'span[title*="click here"]', 'div._2dDmN'],
      description: 'Status de conexão WhatsApp',
    },
  };

  const STATUS = { PASS: 'PASS', DEGRADED: 'DEGRADED', BROKEN: 'BROKEN' };

  // ──────────────────────────────────────────────────────────────────────────
  // MODO NAVEGADOR
  // ──────────────────────────────────────────────────────────────────────────
  function safeQuery(sel) {
    try { return document.querySelector(sel); } catch (_) { return null; } // seletor inválido → null
  }

  function checkOne(key) {
    const def = SELECTORS[key];
    if (safeQuery(def.primary)) {
      return { key, status: STATUS.PASS, via: 'primary', matched: def.primary, description: def.description };
    }
    for (const fb of def.fallbacks) {
      if (safeQuery(fb)) {
        return { key, status: STATUS.DEGRADED, via: 'fallback', matched: fb, description: def.description };
      }
    }
    return { key, status: STATUS.BROKEN, via: null, matched: null, description: def.description };
  }

  function run() {
    if (typeof document === 'undefined') {
      console.error('[WACanary] run() é do NAVEGADOR (console do web.whatsapp.com). No Node use o modo CI.');
      return null;
    }
    const results = Object.keys(SELECTORS).map(checkOne);
    const summary = {
      total: results.length,
      pass: results.filter((r) => r.status === STATUS.PASS).length,
      degraded: results.filter((r) => r.status === STATUS.DEGRADED).length,
      broken: results.filter((r) => r.status === STATUS.BROKEN).length,
    };
    try {
      const icon = { PASS: '✅', DEGRADED: '⚠️', BROKEN: '❌' };
      const table = {};
      results.forEach((r) => {
        table[r.key] = {
          status: icon[r.status] + ' ' + r.status,
          via: r.via || '-',
          matched: r.matched || '(nenhum)',
          o_que_e: r.description,
        };
      });
      console.table(table);
      const color = summary.broken ? '#ef4444' : summary.degraded ? '#f59e0b' : '#22c55e';
      console.log(
        '%c[WACanary] ' + summary.pass + ' PASS · ' + summary.degraded + ' DEGRADED · ' + summary.broken + ' BROKEN',
        'color:' + color + ';font-weight:700;font-size:13px'
      );
      if (summary.broken) {
        console.warn('[WACanary] ❌ Há seletores BROKEN. Se você está SEM conversa aberta, alguns são esperados ' +
          '(input/header/mensagens só existem com um chat aberto). Com conversa aberta, BROKEN = o WhatsApp mudou o ' +
          'DOM → atualize modules/anti-break-system.js (e depois o canário).');
      } else if (summary.degraded) {
        console.warn('[WACanary] ⚠️ DEGRADED: o primary falhou e um fallback assumiu. Ainda funciona, mas o primary ' +
          'deveria ser corrigido antes de quebrar de vez.');
      }
    } catch (_) {}
    return { results, summary };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODO NODE / CI — guard de drift contra anti-break-system.js
  // ──────────────────────────────────────────────────────────────────────────

  // Extrai { KEY: { primary, fallbacks[] } } do código-fonte do anti-break.
  // Robusto a seletores CSS que contêm [ ] e " por dentro: primeiro isola o
  // bloco `const SELECTORS = { ... };`, depois cada chave até `description:`, e
  // por fim pega TODAS as strings na ordem (1ª = primary, resto = fallbacks).
  function extractSelectorsFromSource(src) {
    const out = {};
    const blockMatch = src.match(/const\s+SELECTORS\s*=\s*\{([\s\S]*?)\n\s*\};/);
    if (!blockMatch) return out;
    const block = blockMatch[1];
    const keyRe = /([A-Z][A-Z0-9_]+)\s*:\s*\{([\s\S]*?)description\s*:/g;
    const strRe = /'([^']*)'|"([^"]*)"/g;
    let m;
    while ((m = keyRe.exec(block))) {
      const strings = [];
      let s;
      strRe.lastIndex = 0;
      while ((s = strRe.exec(m[2]))) strings.push(s[1] !== undefined ? s[1] : s[2]);
      if (strings.length) out[m[1]] = { primary: strings[0], fallbacks: strings.slice(1) };
    }
    return out;
  }

  function diffSelectors(embedded, source) {
    const issues = [];
    const eKeys = Object.keys(embedded);
    const sKeys = Object.keys(source);
    sKeys.filter((k) => !embedded[k]).forEach((k) =>
      issues.push('chave "' + k + '" está no anti-break-system.js mas NÃO no canário'));
    eKeys.filter((k) => !source[k]).forEach((k) =>
      issues.push('chave "' + k + '" está no canário mas NÃO no anti-break-system.js'));
    eKeys.filter((k) => source[k]).forEach((k) => {
      if (embedded[k].primary !== source[k].primary) {
        issues.push(k + '.primary divergente:\n      canário: ' + embedded[k].primary +
          '\n      runtime: ' + source[k].primary);
      }
      const a = embedded[k].fallbacks.join(' | ');
      const b = source[k].fallbacks.join(' | ');
      if (a !== b) {
        issues.push(k + '.fallbacks divergentes:\n      canário: [' + a + ']\n      runtime: [' + b + ']');
      }
    });
    return issues;
  }

  function _cli() {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.join(__dirname, '..', 'modules', 'anti-break-system.js'), // scripts/ → ../modules
      path.join(__dirname, 'modules', 'anti-break-system.js'),
      path.join(process.cwd(), 'whatshybrid-extension', 'modules', 'anti-break-system.js'),
      path.join(process.cwd(), 'modules', 'anti-break-system.js'),
    ];
    const sourcePath = candidates.find((p) => fs.existsSync(p));
    if (!sourcePath) {
      console.error('[WACanary] ❌ anti-break-system.js não encontrado. Procurei em:\n  ' + candidates.join('\n  '));
      process.exit(2);
    }

    const source = extractSelectorsFromSource(fs.readFileSync(sourcePath, 'utf8'));
    const srcCount = Object.keys(source).length;

    console.log('[WACanary] fonte:   ' + path.relative(process.cwd(), sourcePath));
    console.log('[WACanary] chaves:  canário=' + Object.keys(SELECTORS).length + '  runtime=' + srcCount);

    if (srcCount === 0) {
      console.error('[WACanary] ❌ não extraí nenhum seletor (o formato do anti-break-system.js mudou?). Ajuste o parser.');
      process.exit(2);
    }

    // 1) forma da cópia embutida
    const shape = [];
    Object.keys(SELECTORS).forEach((k) => {
      const d = SELECTORS[k];
      if (typeof d.primary !== 'string' || !d.primary) shape.push(k + ': primary inválido');
      if (!Array.isArray(d.fallbacks) || !d.fallbacks.length) shape.push(k + ': fallbacks vazio/ inválido');
      if (typeof d.description !== 'string' || !d.description) shape.push(k + ': description ausente');
    });
    if (shape.length) {
      console.error('[WACanary] ❌ forma inválida na cópia embutida:\n  - ' + shape.join('\n  - '));
      process.exit(1);
    }

    // 2) drift
    const drift = diffSelectors(SELECTORS, source);
    if (drift.length) {
      console.error('[WACanary] ❌ DRIFT — canário fora de sincronia com anti-break-system.js:\n  - ' +
        drift.join('\n  - '));
      console.error('\n  → Atualize o objeto SELECTORS no topo de wa-selector-canary.js para bater com o runtime.');
      process.exit(1);
    }

    console.log('[WACanary] ✅ OK — ' + Object.keys(SELECTORS).length +
      ' seletores em sincronia com o runtime, forma válida.');
    process.exit(0);
  }

  return {
    run,
    checkOne,
    SELECTORS,
    STATUS,
    _cli,
    _extractSelectorsFromSource: extractSelectorsFromSource,
    _diffSelectors: diffSelectors,
  };
});
