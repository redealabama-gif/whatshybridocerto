/**
 * WhatsHybrid – EXTRATOR TURBO v7 com FILTRO ULTRA-RIGOROSO
 * 
 * ESTRATÉGIA:
 * 1. Coleta APENAS de fontes confiáveis (@c.us, data-id, data-jid)
 * 2. Validação OBRIGATÓRIA para TODOS os números
 * 3. Sistema de pontuação com score mínimo alto
 * 4. Detecção de falsos positivos (datas, valores, códigos)
 * 
 * VALIDAÇÕES OBRIGATÓRIAS:
 * - Tamanho: 12-13 dígitos (com 55)
 * - DDD brasileiro válido (67 DDDs)
 * - Formato celular: 9[6-9]XXXXXXX
 * - Formato fixo: [2-5]XXXXXXX
 * - Rejeita números repetitivos e sequências
 * 
 * SCORE MÍNIMO: 10 pontos
 */

(function () {
  const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');
  const _console = window.console;
  // Shadow local console to make logs conditional without affecting the page globally
  const console = {
    log: (...args) => { if (WHL_DEBUG) _console.log(...args); },
    info: (...args) => { if (WHL_DEBUG) (_console.info || _console.log).call(_console, ...args); },
    debug: (...args) => { if (WHL_DEBUG) (_console.debug || _console.log).call(_console, ...args); },
    warn: (...args) => _console.warn(...args),
    error: (...args) => _console.error(...args)
  };
  if (window.__WHL_EXTRACTOR_TURBO_V7__) return;
  window.__WHL_EXTRACTOR_TURBO_V7__ = true;

  console.log('[WHL] 🚀 EXTRATOR TURBO v7 - FILTRO ULTRA-RIGOROSO iniciando...');

  // ===== CONFIGURAÇÃO =====
  const CONFIG = {
    maxScrolls: 150,
    scrollDelay: 400,
    scrollIncrement: 0.85,
    stabilityCount: 10,
    
    // FILTRO RIGOROSO
    minValidScore: 10,  // Score mínimo ALTO
    
    // Pontuação por fonte
    scores: {
      cus: 15,        // @c.us - máxima confiança
      gus: 15,        // @g.us - grupo
      dataid: 12,     // data-id
      datajid: 12,    // data-jid
      wame: 8,        // wa.me link
      phone: 6,       // phone= parameter
      
      // Bônus
      valid_ddd: 5,
      mobile_format: 4,
      occurrence: 2,
      
      // Penalidades
      negative_context: -10,
      repeated_digits: -15,
      sequence: -12,
      invalid_mobile: -20,
    },
    
    // Contextos que indicam falso positivo
    negativeContexts: [
      'data', 'hora', 'time', 'date', 'timestamp',
      'código', 'codigo', 'code', 'pin', 'otp',
      'valor', 'preço', 'preco', 'price', 'total',
      'r$', '$', '€', 'usd', 'brl', 'eur',
      'duração', 'duracao', 'duration', 'tempo',
      'minutos', 'segundos', 'minutes', 'seconds',
      'cep', 'cnpj', 'cpf', 'rg', 'id:',
      'pedido', 'order', 'protocolo', 'ticket',
      'versão', 'versao', 'version', 'v.',
      'ref:', 'nº', 'n°', '#', 'qty', 'quantidade'
    ],
    
    debug: true
  };

  // ===== DDDs BRASILEIROS VÁLIDOS (67 DDDs) =====
  const VALID_DDDS = new Set([
    11, 12, 13, 14, 15, 16, 17, 18, 19,
    21, 22, 24, 27, 28,
    31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46,
    47, 48, 49,
    51, 53, 54, 55,
    61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79,
    81, 82, 83, 84, 85, 86, 87, 88, 89,
    91, 92, 93, 94, 95, 96, 97, 98, 99
  ]);

  // ===== HELPER FUNCTIONS FOR WHATSAPP STORE =====
  function waitForWA() {
    return new Promise(resolve => {
      if (window.WHL_Store?._readyAt) return resolve();

      const handleBridgeReady = () => {
        window.removeEventListener('WHL_STORE_READY', handleBridgeReady);
        resolve();
      };
      window.addEventListener('WHL_STORE_READY', handleBridgeReady);

      // Poll fallback in case the event fired before this listener attached
      const pollStart = Date.now();
      const poll = setInterval(() => {
        if (window.WHL_Store?._readyAt) {
          clearInterval(poll);
          window.removeEventListener('WHL_STORE_READY', handleBridgeReady);
          resolve();
        } else if (Date.now() - pollStart > 20000) {
          clearInterval(poll);
          resolve();
        }
      }, 250);
    });
  }

  function initStore() {
    return !!window.WHL_Store;
  }

  // Pull the model array out of a Collection regardless of internal shape.
  function modelsOf(collection) {
    if (!collection) return [];
    if (typeof collection.getModelsArray === 'function') {
      try { return collection.getModelsArray() || []; } catch (_) {}
    }
    if (Array.isArray(collection._models)) return collection._models;
    if (Array.isArray(collection.models)) return collection.models;
    return [];
  }

  // The post-2.3000.x WhatsApp Web mangles property names with __x_ prefix.
  // Read either form so we work across versions.
  function readProp(obj, name) {
    if (!obj) return undefined;
    const prefixed = obj['__x_' + name];
    return (prefixed !== undefined) ? prefixed : obj[name];
  }

  // ===== VALIDAÇÃO ULTRA-RIGOROSA =====
  function validatePhone(num) {
    if (!num) return { valid: false, score: 0, reason: 'vazio' };
    
    let n = String(num).replace(/\D/g, '');
    
    // Normalizar
    if (n.length === 10 || n.length === 11) {
      n = '55' + n;
    }
    
    // Tamanho: deve ter 12 ou 13 dígitos
    if (n.length !== 12 && n.length !== 13) {
      return { valid: false, score: 0, reason: 'tamanho inválido: ' + n.length };
    }
    
    // Deve começar com 55
    if (!n.startsWith('55')) {
      return { valid: false, score: 0, reason: 'não é brasileiro' };
    }
    
    // Verificar DDD
    const ddd = parseInt(n.substring(2, 4), 10);
    if (!VALID_DDDS.has(ddd)) {
      return { valid: false, score: 0, reason: 'DDD inválido: ' + ddd };
    }
    
    let score = CONFIG.scores.valid_ddd;
    
    // Número local
    const localNumber = n.substring(4);
    
    // Celular (9 dígitos)
    if (localNumber.length === 9) {
      // DEVE começar com 9
      if (!localNumber.startsWith('9')) {
        return { valid: false, score: 0, reason: 'celular deve começar com 9' };
      }
      // Segundo dígito deve ser 6, 7, 8 ou 9
      const secondDigit = parseInt(localNumber[1], 10);
      if (secondDigit < 6) {
        return { valid: false, score: 0, reason: 'segundo dígito celular inválido: ' + secondDigit };
      }
      score += CONFIG.scores.mobile_format;
    }
    
    // Fixo (8 dígitos)
    if (localNumber.length === 8) {
      const firstDigit = parseInt(localNumber[0], 10);
      if (firstDigit < 2 || firstDigit > 5) {
        return { valid: false, score: 0, reason: 'fixo deve começar com 2-5' };
      }
    }
    
    // Rejeitar números muito repetitivos
    const uniqueDigits = new Set(n.split(''));
    if (uniqueDigits.size <= 3) {
      return { valid: false, score: CONFIG.scores.repeated_digits, reason: 'número muito repetitivo' };
    }
    
    // Rejeitar sequências óbvias
    const sequences = ['12345678', '87654321', '11111111', '22222222', '33333333', 
                       '44444444', '55555555', '66666666', '77777777', '88888888', 
                       '99999999', '00000000', '12341234', '56785678'];
    for (const seq of sequences) {
      if (localNumber.includes(seq)) {
        return { valid: false, score: CONFIG.scores.sequence, reason: 'sequência óbvia: ' + seq };
      }
    }
    
    return { valid: true, score, normalized: n };
  }

  // ===== DETECTAR CONTEXTO NEGATIVO =====
  function hasNegativeContext(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    for (const neg of CONFIG.negativeContexts) {
      if (lower.includes(neg)) {
        return true;
      }
    }
    return false;
  }

  // ===== ARMAZENAMENTO =====
  const PhoneStore = {
    _phones: new Map(),
    _archived: new Set(),  // números arquivados
    _blocked: new Set(),   // números bloqueados
    
    add(num, sourceType, context = null, contactType = 'normal') {
      // Validar primeiro
      const validation = validatePhone(num);
      if (!validation.valid) {
        if (CONFIG.debug && validation.reason !== 'vazio') {
          // console.log('[WHL] ❌ Rejeitado:', num, '-', validation.reason);
        }
        return null;
      }
      
      const normalized = validation.normalized;
      
      // Verificar contexto negativo
      if (hasNegativeContext(context)) {
        if (CONFIG.debug) {
          console.log('[WHL] ⚠️ Contexto negativo:', normalized);
        }
        return null; // Rejeitar completamente se contexto negativo
      }
      
      // Marcar como arquivado ou bloqueado se aplicável
      if (contactType === 'archived') {
        this._archived.add(normalized);
      } else if (contactType === 'blocked') {
        this._blocked.add(normalized);
      }
      
      // Calcular score
      let sourceScore = CONFIG.scores[sourceType] || 0;
      
      // Criar ou atualizar
      if (!this._phones.has(normalized)) {
        this._phones.set(normalized, {
          sources: new Set(),
          score: validation.score,
          occurrences: 0,
          type: contactType
        });
      }
      
      const record = this._phones.get(normalized);
      
      // Adicionar score da fonte (só primeira vez por tipo)
      if (!record.sources.has(sourceType)) {
        record.score += sourceScore;
        record.sources.add(sourceType);
      }
      
      record.occurrences++;
      
      // Bônus por múltiplas ocorrências
      if (record.occurrences > 1) {
        record.score += CONFIG.scores.occurrence;
      }
      
      return normalized;
    },

    // Add a phone that came from a TRUSTED source (the WhatsApp Store
    // collections themselves, not free-text DOM/storage scans). The score
    // heuristic and DDD validator are deliberately bypassed — Store IDs are
    // authoritative. Still enforces minimal sanity (8–15 digits, not all-same).
    addTrusted(rawNum, contactType = 'normal', sourceType = 'cus') {
      if (rawNum === undefined || rawNum === null) return null;
      const n = String(rawNum).replace(/\D/g, '');
      if (n.length < 8 || n.length > 15) return null;
      const uniq = new Set(n.split(''));
      if (uniq.size <= 1) return null; // all same digit
      const normalized = n;
      if (contactType === 'archived') this._archived.add(normalized);
      else if (contactType === 'blocked') this._blocked.add(normalized);
      if (!this._phones.has(normalized)) {
        // Give Store-sourced entries a baseline score well above minValidScore
        // so getFiltered()/getArchived()/getBlocked() always include them.
        this._phones.set(normalized, {
          sources: new Set([sourceType, 'store']),
          score: Math.max(CONFIG.minValidScore + 5, 20),
          occurrences: 1,
          type: contactType,
          trusted: true,
        });
      } else {
        const rec = this._phones.get(normalized);
        rec.sources.add(sourceType);
        rec.sources.add('store');
        rec.trusted = true;
        rec.occurrences++;
        // Keep the type stable if it was already classified as archived/blocked.
        if (contactType !== 'normal' && rec.type === 'normal') rec.type = contactType;
      }
      return normalized;
    },
    
    getFiltered() {
      const result = [];
      
      this._phones.forEach((record, num) => {
        if (record.score >= CONFIG.minValidScore && !this._archived.has(num) && !this._blocked.has(num)) {
          result.push(num);
        }
      });
      
      return [...new Set(result)].sort();
    },
    
    getArchived() {
      const result = [];
      this._archived.forEach(num => {
        const record = this._phones.get(num);
        if (record && record.score >= CONFIG.minValidScore) {
          result.push(num);
        }
      });
      return [...new Set(result)].sort();
    },
    
    getBlocked() {
      const result = [];
      this._blocked.forEach(num => {
        const record = this._phones.get(num);
        if (record && record.score >= CONFIG.minValidScore) {
          result.push(num);
        }
      });
      return [...new Set(result)].sort();
    },
    
    getAllByType() {
      return {
        normal: this.getFiltered(),
        archived: this.getArchived(),
        blocked: this.getBlocked()
      };
    },
    
    getAllWithDetails() {
      const result = [];
      this._phones.forEach((record, num) => {
        result.push({
          number: num,
          score: record.score,
          sources: Array.from(record.sources),
          occurrences: record.occurrences,
          valid: record.score >= CONFIG.minValidScore,
          type: this._archived.has(num) ? 'archived' : this._blocked.has(num) ? 'blocked' : 'normal'
        });
      });
      return result.sort((a, b) => b.score - a.score);
    },
    
    getStats() {
      let valid = 0, invalid = 0;
      this._phones.forEach((record) => {
        if (record.score >= CONFIG.minValidScore) valid++;
        else invalid++;
      });
      return {
        total: this._phones.size,
        valid,
        invalid,
        archived: this._archived.size,
        blocked: this._blocked.size,
        minScore: CONFIG.minValidScore
      };
    },
    
    clear() {
      this._phones.clear();
      this._archived.clear();
      this._blocked.clear();
    }
  };

  window.PhoneStore = PhoneStore;

  // ===== EXTRAÇÃO APENAS DE FONTES CONFIÁVEIS =====
  
  function extractFromText(text, sourceType) {
    if (!text || typeof text !== 'string') return 0;
    let count = 0;
    
    // APENAS padrões de alta confiança
    
    // @c.us / @s.whatsapp.net / @lid (1-on-1 IDs)
    const waIdRe = /(\d{10,15})@(?:c\.us|s\.whatsapp\.net|lid)/g;
    let match;
    while ((match = waIdRe.exec(text)) !== null) {
      if (PhoneStore.add(match[1], 'cus', text)) count++;
    }

    // @g.us (grupos)
    const groupRe = /(\d{10,15})@g\.us/g;
    while ((match = groupRe.exec(text)) !== null) {
      if (PhoneStore.add(match[1], 'gus', text)) count++;
    }
    
    // wa.me links
    const waMeRe = /wa\.me\/(\d{10,15})/g;
    while ((match = waMeRe.exec(text)) !== null) {
      if (PhoneStore.add(match[1], 'wame', text)) count++;
    }
    
    // phone= parameter
    const phoneRe = /phone=(\d{10,15})/g;
    while ((match = phoneRe.exec(text)) !== null) {
      if (PhoneStore.add(match[1], 'phone', text)) count++;
    }
    
    // NÃO extrair números raw/formatados - muito falso positivo
    
    return count;
  }

  function extractFromElement(el) {
    if (!el) return 0;
    let count = 0;
    
    // APENAS data-id e data-jid com @c.us ou @g.us
    ['data-id', 'data-jid'].forEach(attr => {
      try {
        const val = el.getAttribute?.(attr);
        if (val && (val.includes('@c.us') || val.includes('@g.us'))) {
          const match = val.match(/(\d{10,15})@[cg]\.us/);
          if (match) {
            if (PhoneStore.add(match[1], attr === 'data-id' ? 'dataid' : 'datajid', val)) {
              count++;
            }
          }
        }
      } catch {}
    });
    
    // href com wa.me
    try {
      const href = el.getAttribute?.('href');
      if (href && href.includes('wa.me')) {
        count += extractFromText(href, 'wame');
      }
    } catch {}
    
    return count;
  }

  function extractFromDOM() {
    let count = 0;
    
    // APENAS elementos com data-id/@c.us
    document.querySelectorAll('[data-id*="@c.us"], [data-id*="@g.us"]').forEach(el => {
      count += extractFromElement(el);
    });
    
    // APENAS elementos com data-jid/@c.us
    document.querySelectorAll('[data-jid*="@c.us"], [data-jid*="@g.us"]').forEach(el => {
      count += extractFromElement(el);
    });
    
    // Links wa.me
    document.querySelectorAll('a[href*="wa.me"]').forEach(el => {
      count += extractFromElement(el);
    });
    
    return count;
  }
  
  // Resolve a chat/contact entity to a real phone-number string.
  // A @lid id is NOT a phone — its digits are a routing identifier (e.g.
  // "155757190365423"). We accept digits only when they came from a
  // phone-shaped server (c.us / s.whatsapp.net) or from an explicit
  // __x_phoneNumber / pnh / pn field. opts.acceptLid is honored only by the
  // Blocklist path, where the user may genuinely want the lid id surfaced
  // so they can identify which lid contact was blocked.
  function resolvePhoneFromEntity(entity, opts = {}) {
    if (!entity) return null;

    const fromSerialized = (s) => {
      if (!s) return null;
      const m = String(s).match(/^(\d{8,15})@(?:c\.us|s\.whatsapp\.net)$/);
      return m ? m[1] : null;
    };
    const userIfPhoneServer = (idObj) => {
      if (!idObj) return null;
      const server = idObj.server;
      if (server !== 'c.us' && server !== 's.whatsapp.net') return null;
      const u = idObj.user;
      return (typeof u === 'string' && /^\d{8,15}$/.test(u)) ? u : null;
    };
    const fromBareField = (v) => {
      if (v === undefined || v === null) return null;
      const d = String(v).replace(/\D/g, '');
      return /^\d{8,15}$/.test(d) ? d : null;
    };

    // 1) Direct id
    let phone = fromSerialized(entity.id?._serialized) || userIfPhoneServer(entity.id);
    if (phone) return phone;

    // 2) Explicit phone-number fields
    for (const f of [entity.__x_phoneNumber, entity.phoneNumber,
                     entity.__x_pnh, entity.pnh,
                     entity.__x_pn, entity.pn]) {
      const p = fromBareField(f);
      if (p) return p;
    }

    // 3) Chat → Contact link
    const contact = entity.__x_contact || entity.contact;
    if (contact && contact !== entity) {
      const p = resolvePhoneFromEntity(contact, { acceptLid: opts.acceptLid });
      if (p) return p;
    }

    // 4) Optional fallback for blocked list: surface the @lid digits so the
    //    user at least knows *something* was blocked even if WhatsApp never
    //    leaked the phone to the page world.
    if (opts.acceptLid) {
      const m = String(entity.id?._serialized || '').match(/^(\d{8,20})@lid$/);
      if (m) return m[1];
    }
    return null;
  }

  // ===== EXTRAIR CONTATOS NORMAIS DA STORE (via bridge) =====
  // Iterates window.WHL_Store.Chat (WAWebChatCollection) and pulls every
  // non-archived 1-on-1 chat. Supports @c.us, @s.whatsapp.net AND the newer
  // @lid IDs (resolving the latter through chat.__x_contact when possible).
  function extractNormalContactsFromStore() {
    if (!window.WHL_Store) {
      console.warn('[WHL] ⚠️ window.WHL_Store ausente — page-bridge não respondeu');
      return 0;
    }
    let count = 0;
    let scanned = 0;
    let skippedArchived = 0;
    let skippedGroup = 0;
    let unresolvable = 0;
    try {
      const chats = modelsOf(window.WHL_Store?.Chat);
      chats.forEach(chat => {
        scanned++;
        try {
          const isArchived = readProp(chat, 'archive') === true;
          if (isArchived) { skippedArchived++; return; }
          const id = chat.id?._serialized || '';
          if (id.endsWith('@g.us')) { skippedGroup++; return; }
          // Try to resolve to a phone (accepts @c.us, @s.whatsapp.net,
          // and falls back to chat.__x_contact for @lid chats).
          const phone = resolvePhoneFromEntity(chat);
          if (phone) {
            if (PhoneStore.addTrusted(phone, 'normal', 'store_chat')) count++;
          } else {
            unresolvable++;
          }
        } catch (_) {}
      });

      // Augment with the address book too — covers contacts you've never chatted with.
      const book = modelsOf(window.WHL_Store?.Contact);
      let bookHits = 0;
      book.forEach(c => {
        try {
          const id = c.id?._serialized || '';
          if (id.endsWith('@g.us') || id.endsWith('@broadcast')) return;
          const phone = resolvePhoneFromEntity(c);
          if (phone) {
            if (PhoneStore.addTrusted(phone, 'normal', 'store_contact')) {
              count++;
              bookHits++;
            }
          }
        } catch (_) {}
      });
      console.log(`[WHL] 👥 Contatos normais (Store) — scan: ${scanned} chats, ` +
        `arquivados: ${skippedArchived}, grupos: ${skippedGroup}, ` +
        `sem-telefone(@lid puro): ${unresolvable}, address-book hits: ${bookHits}, total únicos: ${count}`);
    } catch (e) {
      console.error('[WHL] Erro ao extrair normais via Store:', e);
    }
    return count;
  }

  // ===== EXTRAIR CONTATOS ARQUIVADOS =====
  function extractArchivedContacts() {
    let count = 0;
    let scanned = 0;
    let archivedSeen = 0;
    let unresolvable = 0;

    try {
      // Método 1: Usar window.WHL_Store.Chat (WAWebChatCollection) — propriedade
      // __x_archive na 2.3000.x+, fallback para `archive` em versões antigas.
      const chats = modelsOf(window.WHL_Store?.Chat);
      chats.forEach(chat => {
        scanned++;
        try {
          const isArchived = readProp(chat, 'archive') === true ||
                             chat.archived === true || chat.isArchive === true;
          if (!isArchived) return;
          archivedSeen++;
          const id = chat.id?._serialized || '';
          if (id.endsWith('@g.us')) return;
          const phone = resolvePhoneFromEntity(chat);
          if (phone) {
            if (PhoneStore.addTrusted(phone, 'archived', 'store_chat')) count++;
          } else {
            unresolvable++;
          }
        } catch (_) {}
      });
      
      // Método 2: Procurar pela seção de arquivados no DOM
      const archivedSection = document.querySelector('[data-testid="archived"]') ||
                              document.querySelector('[aria-label*="rquivad"]') ||
                              document.querySelector('[aria-label*="Archived"]');
      
      if (archivedSection) {
        console.log('[WHL] 📁 Seção de arquivados encontrada');
        // Extrair números desta seção marcando como arquivados
        archivedSection.querySelectorAll('[data-id*="@c.us"]').forEach(el => {
          const dataId = el.getAttribute('data-id');
          if (dataId) {
            const match = dataId.match(/(\d{10,15})@c\.us/);
            if (match) {
              if (PhoneStore.add(match[1], 'dataid', dataId, 'archived')) {
                count++;
              }
            }
          }
        });
      }
      
      // Método 3: Procurar no localStorage por chaves relacionadas a "archived"
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('archived') || key.includes('archive'))) {
          const value = localStorage.getItem(key);
          if (value && value.includes('@c.us')) {
            // Trabalhar diretamente com a string para melhor performance
            const matches = value.matchAll(/(\d{10,15})@c\.us/g);
            for (const match of matches) {
              if (PhoneStore.add(match[1], 'cus', value, 'archived')) {
                count++;
              }
            }
          }
        }
      }
      
      console.log(`[WHL] 📁 Arquivados (Store) — scan: ${scanned} chats, ` +
        `arquivados encontrados: ${archivedSeen}, sem-telefone(@lid): ${unresolvable}, ` +
        `total: ${count}`);
    } catch (e) {
      console.error('[WHL] Erro ao extrair arquivados:', e);
    }

    return count;
  }

  // ===== EXTRAIR CONTATOS BLOQUEADOS =====
  function extractBlockedContacts() {
    let count = 0;

    try {
      // Método 1: Usar window.WHL_Store.Blocklist (WAWebBlocklistCollection).
      // We never surface @lid digits as phones — the user reported them
      // showing up as "números grandes aleatórios". If a blocked entry is
      // @lid-only and has no resolvable phone via __x_contact, we drop it
      // silently and rely on the localStorage scan (Method 2) which still
      // finds the real @c.us blocks WhatsApp keeps in IndexedDB/localStorage.
      const blocked = modelsOf(window.WHL_Store?.Blocklist);
      blocked.forEach(entry => {
        try {
          const fullContact = window.WHL_Store?.Contact?.get?.(entry?.id?._serialized) || entry;
          const phone = resolvePhoneFromEntity(fullContact) || resolvePhoneFromEntity(entry);
          if (phone) {
            if (PhoneStore.addTrusted(phone, 'blocked', 'store_blocklist')) count++;
          }
        } catch (_) {}
      });
      
      // Método 2: Procurar no localStorage por chaves relacionadas a "block"
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes('block') || key.includes('Block'))) {
          const value = localStorage.getItem(key);
          if (value && value.includes('@c.us')) {
            // Trabalhar diretamente com a string para melhor performance
            const matches = value.matchAll(/(\d{10,15})@c\.us/g);
            for (const match of matches) {
              if (PhoneStore.add(match[1], 'cus', value, 'blocked')) {
                count++;
              }
            }
          }
        }
      }
      
      // Método 3: Procurar no sessionStorage
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.includes('block') || key.includes('Block'))) {
          const value = sessionStorage.getItem(key);
          if (value && value.includes('@c.us')) {
            // Trabalhar diretamente com a string para melhor performance
            const matches = value.matchAll(/(\d{10,15})@c\.us/g);
            for (const match of matches) {
              if (PhoneStore.add(match[1], 'cus', value, 'blocked')) {
                count++;
              }
            }
          }
        }
      }
      
      // Método 4: Procurar elementos de contatos bloqueados no DOM
      const blockedElements = document.querySelectorAll('[data-testid="blocked-contact"], [aria-label*="bloqueado"], [aria-label*="blocked"]');
      blockedElements.forEach(el => {
        const dataId = el.getAttribute('data-id');
        if (dataId) {
          const match = dataId.match(/(\d{10,15})@c\.us/);
          if (match) {
            if (PhoneStore.add(match[1], 'dataid', dataId, 'blocked')) {
              count++;
            }
          }
        }
      });
      
      console.log(`[WHL] 🚫 Bloqueados (Store + storage) — total: ${count}`);
    } catch (e) {
      console.error('[WHL] Erro ao extrair bloqueados:', e);
    }
    
    return count;
  }

  function extractFromStorage() {
    let count = 0;
    
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        // APENAS valores com @c.us ou @g.us
        if (value && (value.includes('@c.us') || value.includes('@g.us'))) {
          count += extractFromText(value, 'cus');
        }
      }
    } catch {}
    
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        const value = sessionStorage.getItem(key);
        if (value && (value.includes('@c.us') || value.includes('@g.us'))) {
          count += extractFromText(value, 'cus');
        }
      }
    } catch {}
    
    return count;
  }

  async function extractFromIndexedDB() {
    let count = 0;
    
    try {
      const databases = await indexedDB.databases?.() || [];
      
      for (const dbInfo of databases) {
        if (!dbInfo.name) continue;
        
        try {
          const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open(dbInfo.name);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            setTimeout(() => reject(new Error('timeout')), 3000);
          });
          
          const storeNames = Array.from(db.objectStoreNames);
          
          for (const storeName of storeNames) {
            if (storeName.includes('chat') || storeName.includes('contact')) {
              try {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                
                const allData = await new Promise((resolve, reject) => {
                  const req = store.getAll();
                  req.onsuccess = () => resolve(req.result);
                  req.onerror = () => reject(req.error);
                  setTimeout(() => reject(new Error('timeout')), 5000);
                });
                
                if (Array.isArray(allData)) {
                  allData.forEach(item => {
                    const str = JSON.stringify(item);
                    if (str.includes('@c.us') || str.includes('@g.us')) {
                      count += extractFromText(str, 'cus');
                    }
                  });
                }
              } catch {}
            }
          }
          
          db.close();
        } catch {}
      }
    } catch {}
    
    return count;
  }

  // ===== SCROLL =====
  // Flags de controle
  let extractionPaused = false;
  let extractionCancelled = false;
  
  async function turboScroll() {
    const pane = document.querySelector('#pane-side');
    if (!pane) return;
    
    console.log('[WHL] 📜 Iniciando scroll...');
    
    // Resetar flags de controle
    extractionPaused = false;
    extractionCancelled = false;
    
    pane.scrollTop = 0;
    await new Promise(r => setTimeout(r, 500));
    
    let lastTop = -1;
    let stable = 0;
    let scrollCount = 0;
    
    while (stable < CONFIG.stabilityCount && scrollCount < CONFIG.maxScrolls) {
      // Verificar se foi cancelado
      if (extractionCancelled) {
        console.log('[WHL] ⛔ Extração cancelada pelo usuário');
        break;
      }
      
      // Verificar se foi pausado
      while (extractionPaused && !extractionCancelled) {
        await new Promise(r => setTimeout(r, 500));
      }
      
      // Se cancelou durante a pausa, sair
      if (extractionCancelled) {
        console.log('[WHL] ⛔ Extração cancelada durante pausa');
        break;
      }
      
      extractFromDOM();
      
      const increment = Math.floor(pane.clientHeight * CONFIG.scrollIncrement);
      pane.scrollTop = Math.min(pane.scrollTop + increment, pane.scrollHeight);
      pane.dispatchEvent(new Event('scroll', { bubbles: true }));
      
      scrollCount++;
      
      const progress = Math.min(80, 10 + Math.round((scrollCount / CONFIG.maxScrolls) * 70));
      window.postMessage({
        type: 'WHL_EXTRACT_PROGRESS',
        progress,
        count: PhoneStore.getFiltered().length,
        paused: extractionPaused
      }, window.location.origin);
      
      await new Promise(r => setTimeout(r, CONFIG.scrollDelay));
      
      if (Math.abs(pane.scrollTop - lastTop) < 5) {
        stable++;
      } else {
        stable = 0;
      }
      lastTop = pane.scrollTop;
      
      if (scrollCount % 30 === 0) {
        const stats = PhoneStore.getStats();
        console.log(`[WHL] Scroll ${scrollCount}/${CONFIG.maxScrolls}, válidos: ${stats.valid}`);
      }
    }
    
    pane.scrollTop = 0;
    await new Promise(r => setTimeout(r, 500));
    extractFromDOM();
    
    if (extractionCancelled) {
      console.log(`[WHL] ⛔ Extração cancelada: ${scrollCount} scrolls executados`);
    } else {
      console.log(`[WHL] ✅ Scroll concluído: ${scrollCount} scrolls`);
    }
  }

  // ===== HOOKS DE REDE =====
  function installNetworkHooks() {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      try {
        const clone = response.clone();
        const text = await clone.text().catch(() => '');
        if (text.includes('@c.us') || text.includes('@g.us')) {
          extractFromText(text, 'cus');
        }
      } catch {}
      return response;
    };
    
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(...args) {
      const ws = new OriginalWebSocket(...args);
      ws.addEventListener('message', function(e) {
        try {
          if (e.data && typeof e.data === 'string') {
            if (e.data.includes('@c.us') || e.data.includes('@g.us')) {
              extractFromText(e.data, 'cus');
            }
          }
        } catch {}
      });
      return ws;
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    
    console.log('[WHL] 🔌 Network hooks instalados');
  }

  // ===== FUNÇÃO PRINCIPAL =====
  async function extractAll() {
    console.log('[WHL] 🚀🚀🚀 EXTRAÇÃO TURBO v7 - FILTRO ULTRA-RIGOROSO 🚀🚀🚀');
    console.log('[WHL] Score mínimo:', CONFIG.minValidScore);
    
    PhoneStore.clear();
    
    window.postMessage({ type: 'WHL_EXTRACT_PROGRESS', progress: 5, count: 0 }, window.location.origin);
    
    // Inicializar Store antes de extrair
    await waitForWA();
    initStore();
    
    installNetworkHooks();
    
    // Fase 1: DOM
    console.log('[WHL] 📱 Fase 1: DOM...');
    extractFromDOM();
    window.postMessage({ type: 'WHL_EXTRACT_PROGRESS', progress: 10, count: PhoneStore.getFiltered().length }, window.location.origin);
    
    // Fase 2: Storage
    console.log('[WHL] 💾 Fase 2: Storage...');
    extractFromStorage();
    window.postMessage({ type: 'WHL_EXTRACT_PROGRESS', progress: 15, count: PhoneStore.getFiltered().length }, window.location.origin);
    
    // Fase 3: IndexedDB
    console.log('[WHL] 🗄️ Fase 3: IndexedDB...');
    await extractFromIndexedDB();
    window.postMessage({ type: 'WHL_EXTRACT_PROGRESS', progress: 18, count: PhoneStore.getFiltered().length }, window.location.origin);
    
    // Fase 3.4: Normais via Store (caminho rápido — não precisa de scroll)
    console.log('[WHL] 👥 Fase 3.4: Contatos normais via Store (Chat+Contact collections)...');
    extractNormalContactsFromStore();

    // Fase 3.5: Arquivados e Bloqueados
    console.log('[WHL] 📁 Fase 3.5: Contatos arquivados e bloqueados...');
    extractArchivedContacts();
    extractBlockedContacts();
    window.postMessage({ type: 'WHL_EXTRACT_PROGRESS', progress: 20, count: PhoneStore.getFiltered().length }, window.location.origin);
    
    // Fase 4: Scroll
    console.log('[WHL] 📜 Fase 4: Scroll...');
    await turboScroll();
    
    // Fase 5: Final
    console.log('[WHL] 🔍 Fase 5: Extração final...');
    extractFromDOM();
    extractFromStorage();
    extractArchivedContacts();
    extractBlockedContacts();
    
    await new Promise(r => setTimeout(r, 2000));
    extractFromDOM();
    
    window.postMessage({ type: 'WHL_EXTRACT_PROGRESS', progress: 100, count: PhoneStore.getFiltered().length }, window.location.origin);
    
    // Obter resultados por categoria
    const byType = PhoneStore.getAllByType();
    const stats = PhoneStore.getStats();
    
    console.log('[WHL] ✅✅✅ EXTRAÇÃO v7 CONCLUÍDA ✅✅✅');
    console.log('[WHL] Estatísticas:', stats);
    console.log('[WHL] Números normais:', byType.normal.length);
    console.log('[WHL] Números arquivados:', byType.archived.length);
    console.log('[WHL] Números bloqueados:', byType.blocked.length);
    
    try {
      localStorage.setItem('whl_extracted_numbers', JSON.stringify(byType.normal));
      localStorage.setItem('whl_extracted_archived', JSON.stringify(byType.archived));
      localStorage.setItem('whl_extracted_blocked', JSON.stringify(byType.blocked));
    } catch {}
    
    return byType;
  }

  // ===== LISTENER =====
  window.addEventListener('message', async (ev) => {
    if (!ev?.data?.type) return;
    
    if (ev.data.type === 'WHL_EXTRACT_CONTACTS') {
      try {
        const byType = await extractAll();
        // Enviar resultados categorizados
        window.postMessage({ 
          type: 'WHL_EXTRACT_RESULT', 
          normal: byType.normal,
          archived: byType.archived,
          blocked: byType.blocked,
          numbers: byType.normal  // backward compatibility
        }, window.location.origin);
      } catch (e) {
        console.error('[WHL] Erro:', e);
        window.postMessage({ type: 'WHL_EXTRACT_ERROR', error: String(e) }, window.location.origin);
      }
    }
    
    if (ev.data.type === 'WHL_PAUSE_EXTRACTION') {
      extractionPaused = true;
      console.log('[WHL] ⏸️ Extração pausada');
      window.postMessage({ type: 'WHL_EXTRACTION_PAUSED' }, window.location.origin);
    }
    
    if (ev.data.type === 'WHL_RESUME_EXTRACTION') {
      extractionPaused = false;
      console.log('[WHL] ▶️ Extração retomada');
      window.postMessage({ type: 'WHL_EXTRACTION_RESUMED' }, window.location.origin);
    }
    
    if (ev.data.type === 'WHL_CANCEL_EXTRACTION') {
      extractionCancelled = true;
      console.log('[WHL] ⛔ Extração cancelada');
      const byType = PhoneStore.getAllByType();
      window.postMessage({ 
        type: 'WHL_EXTRACT_RESULT', 
        normal: byType.normal,
        archived: byType.archived,
        blocked: byType.blocked,
        numbers: byType.normal,  // backward compatibility
        cancelled: true
      }, window.location.origin);
    }
  });

  // ===== DEBUG =====
  window.__WHL_TURBO_V7__ = {
    extract: extractAll,
    store: PhoneStore,
    config: CONFIG,
    validate: validatePhone,
    getFiltered: () => PhoneStore.getFiltered(),
    getAll: () => PhoneStore.getAllWithDetails(),
    getStats: () => PhoneStore.getStats(),
    setMinScore: (s) => { CONFIG.minValidScore = s; console.log('[WHL] Score mínimo:', s); }
  };

  console.log('[WHL] ✅ EXTRATOR TURBO v7 - FILTRO ULTRA-RIGOROSO carregado!');
  console.log('[WHL] 📊 Debug: window.__WHL_TURBO_V7__.getStats()');
})();
