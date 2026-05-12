// content/worker-content.js
// WhatsApp Group Contact Extractor
// FINAL — headless + cache + fallback + LID fix
// COMPATÍVEL COM TODOS OS BUILDS (loadParticipants opcional)

(() => {
  'use strict';

  // Evita dupla injeção
  if (window.__WA_GROUP_EXTRACTOR_LOADED__) return;
  window.__WA_GROUP_EXTRACTOR_LOADED__ = true;

  /* ===============================
     CONFIGURAÇÃO
  =============================== */

  const GROUP_LIST_CACHE_KEY = '__WA_GROUP_LIST_CACHE_V3__';
  const GROUP_PART_CACHE_PREFIX = '__WA_GROUP_PARTICIPANTS_V3__';

  const GROUP_LIST_TTL = 5 * 60 * 1000;   // 5 minutos
  const GROUP_PART_TTL = 10 * 60 * 1000;  // 10 minutos
  const REFRESH_SOFT_LIMIT = 50;

  /* ===============================
     UTILITÁRIOS
  =============================== */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => Date.now();

  function uniqueByNumber(list) {
    const seen = new Set();
    return list.filter(item => {
      if (seen.has(item.number)) return false;
      seen.add(item.number);
      return true;
    });
  }

  /* ===============================
     CACHE
  =============================== */

  // Maximum localStorage usage (5MB to be safe, browsers typically allow 5-10MB)
  const MAX_STORAGE_SIZE = 5 * 1024 * 1024;
  
  // Track approximate storage size to avoid expensive calculations
  let approximateStorageSize = 0;
  
  /**
   * Update approximate storage size
   */
  function updateStorageSize() {
    try {
      approximateStorageSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        if (key && value) {
          // Approximate: key length + value length + some overhead
          approximateStorageSize += (key.length + value.length) * 2; // UTF-16 chars = 2 bytes
        }
      }
    } catch (err) {
      console.warn('[WHL Worker] Error updating storage size:', err.message);
      approximateStorageSize = 0;
    }
  }
  
  /**
   * Check if adding data would exceed storage quota
   * @param {string} key - Storage key
   * @param {any} data - Data to store
   * @returns {boolean} - True if size is acceptable
   */
  function checkStorageSize(key, data) {
    try {
      const testData = JSON.stringify({ ts: now(), data });
      const newDataSize = (key.length + testData.length) * 2; // UTF-16 estimation
      
      // Update size if needed
      if (approximateStorageSize === 0) {
        updateStorageSize();
      }
      
      if (approximateStorageSize + newDataSize > MAX_STORAGE_SIZE) {
        console.warn('[WHL Worker] Storage quota would be exceeded, clearing old caches');
        clearOldCaches();
        updateStorageSize();
        return approximateStorageSize + newDataSize <= MAX_STORAGE_SIZE;
      }
      return true;
    } catch (err) {
      console.warn('[WHL Worker] Error checking storage size:', err.message);
      return true; // Proceed anyway if check fails
    }
  }
  
  /**
   * Clear old caches using LRU strategy
   */
  function clearOldCaches() {
    try {
      // Get all cache keys with timestamps
      const caches = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(GROUP_PART_CACHE_PREFIX) || key === GROUP_LIST_CACHE_KEY) {
          try {
            const item = JSON.parse(localStorage.getItem(key));
            if (item?.ts) {
              caches.push({ key, ts: item.ts });
            }
          } catch (e) {
            // Invalid JSON, remove it
            localStorage.removeItem(key);
          }
        }
      }
      
      // Sort by timestamp (oldest first) and remove oldest 50%
      caches.sort((a, b) => a.ts - b.ts);
      const toRemove = Math.ceil(caches.length / 2);
      
      for (let i = 0; i < toRemove; i++) {
        localStorage.removeItem(caches[i].key);
      }
      
      console.log(`[WHL Worker] Cleared ${toRemove} old caches`);
    } catch (err) {
      console.error('[WHL Worker] Error clearing old caches:', err.message);
    }
  }

  function getCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.ts) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function setCache(key, data) {
    try {
      // Check size before saving
      if (!checkStorageSize(key, data)) {
        console.warn('[WHL Worker] Cannot save cache, storage full even after cleanup');
        return;
      }
      
      const cacheData = JSON.stringify({
        ts: now(),
        data
      });
      
      localStorage.setItem(key, cacheData);
      
      // Update approximate size
      approximateStorageSize += (key.length + cacheData.length) * 2;
    } catch (err) {
      // Handle QuotaExceededError specifically
      if (err.name === 'QuotaExceededError') {
        console.warn('[WHL Worker] Storage quota exceeded, clearing old caches');
        clearOldCaches();
        updateStorageSize();
        // Try one more time
        try {
          const cacheData = JSON.stringify({
            ts: now(),
            data
          });
          localStorage.setItem(key, cacheData);
          approximateStorageSize += (key.length + cacheData.length) * 2;
        } catch (retryErr) {
          console.error('[WHL Worker] Failed to save cache even after cleanup:', retryErr.message);
        }
      } else {
        console.warn('[WHL Worker] Failed to save cache:', err.message);
      }
    }
  }

  function isExpired(cache, ttl) {
    return !cache || (now() - cache.ts > ttl);
  }

  function invalidate(key) {
    try { 
      localStorage.removeItem(key); 
    } catch (err) { 
      console.warn('[WHL Worker] Failed to invalidate cache:', err.message);
    }
  }

  function groupPartKey(groupId) {
    return `${GROUP_PART_CACHE_PREFIX}_${groupId}`;
  }

  /* ===============================
     REQUIRE SEGURO
  =============================== */

  function safeRequire(name) {
    try {
      if (typeof require === 'function') {
        return require(name);
      }
    } catch (err) {
      console.warn('[WHL Worker] safeRequire failed for', name, ':', err.message);
    }
    return null;
  }

  /* ===============================
     RESOLVER COLLECTIONS
  =============================== */

  function resolveChatCollection() {
    try {
      const ChatMod = safeRequire('WAWebChatCollection');
      if (!ChatMod) return null;
      return ChatMod.ChatCollection || ChatMod.default?.ChatCollection || null;
    } catch {
      return null;
    }
  }

  function resolveContactCollection() {
    try {
      const ContactMod = safeRequire('WAWebContactCollection');
      if (!ContactMod) return null;
      return ContactMod.ContactCollection || ContactMod.default?.ContactCollection || null;
    } catch {
      return null;
    }
  }

  async function waitForChatCollection(maxTries = 50, delay = 400) {
    for (let i = 0; i < maxTries; i++) {
      const CC = resolveChatCollection();
      if (CC) return CC;
      await sleep(delay);
    }
    return null;
  }

  /* ===============================
     BUSCAR NÚMERO REAL DO CONTATO
     (Resolve LID para número de telefone)
  =============================== */

  async function getPhoneFromContact(participantId) {
    try {
      const ContactCollection = resolveContactCollection();
      if (!ContactCollection) return null;

      const contact = ContactCollection.get(participantId);
      if (!contact) return null;

      // Verificar múltiplos campos onde o número pode estar
      const possibleNumbers = [
        contact.id?.user,
        contact.id?._serialized?.replace('@c.us', '').replace('@s.whatsapp.net', ''),
        contact.phoneNumber,
        contact.formattedNumber
      ];

      for (const num of possibleNumbers) {
        if (num) {
          const clean = String(num).replace(/\D/g, '');
          if (/^\d{10,15}$/.test(clean)) {
            return clean;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /* ===============================
     LISTAR GRUPOS (HEADLESS)
  =============================== */

  async function getGroups() {
    try {
      const cached = getCache(GROUP_LIST_CACHE_KEY);
      if (cached && !isExpired(cached, GROUP_LIST_TTL)) {
        console.log('[WHL] Usando cache de grupos');
        return { groups: cached.data, cached: true };
      }

      const ChatCollection = await waitForChatCollection();
      if (!ChatCollection) {
        return { error: 'ChatCollection indisponível.' };
      }

      const chats = ChatCollection.getModelsArray();

      const groups = chats
        .filter(c => c?.id?.server === 'g.us')
        .map(c => ({
          id: c.id?._serialized,
          name: c.name || c.formattedTitle || 'Grupo sem nome',
          participantsCount:
            c.groupMetadata?.participants?.size ||
            c.groupMetadata?.participants?.length ||
            0
        }))
        .filter(g => g.id)
        .sort((a, b) => a.name.localeCompare(b.name));

      setCache(GROUP_LIST_CACHE_KEY, groups);
      console.log('[WHL] Grupos carregados:', groups.length);
      return { groups, cached: false };

    } catch (e) {
      console.error('[WHL] Erro ao listar grupos:', e);
      return { error: e.message };
    }
  }

  /* ===============================
     EXTRAIR CONTATOS (HEADLESS)
     ✔ loadParticipants OPCIONAL
     ✔ 5 métodos de extração
     ✔ Resolve LID via ContactCollection
     ✔ Compatível com builds A / B / C
  =============================== */

  async function extractContacts(groupId) {
    try {
      const ChatCollection = await waitForChatCollection();
      if (!ChatCollection) {
        return { error: 'ChatCollection indisponível.' };
      }

      const chat = ChatCollection.get(groupId);
      if (!chat || chat?.id?.server !== 'g.us') {
        invalidate(groupPartKey(groupId));
        return { error: 'Grupo inválido ou não encontrado.' };
      }

      const meta = chat.groupMetadata;
      if (!meta) {
        return { error: 'Metadata indisponível.' };
      }

      // Verificar cache
      const cached = getCache(groupPartKey(groupId));
      const cachedCount = cached?.data?.length || 0;

      const liveCount =
        meta.participants?.size ||
        meta.participants?.length ||
        cachedCount;

      const shouldRefresh =
        !cached ||
        isExpired(cached, GROUP_PART_TTL) ||
        Math.abs(liveCount - cachedCount) > REFRESH_SOFT_LIMIT;

      if (!shouldRefresh && cached?.data?.length) {
        console.log('[WHL] Usando cache de participantes para', groupId);
        return { contacts: cached.data, cached: true };
      }

      // loadParticipants pode ou não existir
      if (typeof meta.loadParticipants === 'function') {
        await meta.loadParticipants();
      }

      // Obter participantes em múltiplos formatos
      let participants = [];
      if (meta.participants?.toArray) {
        participants = meta.participants.toArray();
      } else if (Array.isArray(meta.participants)) {
        participants = meta.participants;
      } else if (meta.participants?.size) {
        participants = [...meta.participants.values()];
      }

      if (!participants.length) {
        invalidate(groupPartKey(groupId));
        return { error: 'Nenhum participante encontrado.' };
      }

      console.log('[WHL] Total participantes encontrados:', participants.length);

      // EXTRAÇÃO COM 5 MÉTODOS + CORREÇÃO LID
      const contacts = [];
      let lidCount = 0;
      let resolvedCount = 0;

      for (const p of participants) {
        const id = p.id;
        if (!id) continue;

        let numero = null;

        // MÉTODO 1: Se _serialized contém número válido
        if (id._serialized) {
          const extracted = id._serialized
            .replace('@c.us', '')
            .replace('@s.whatsapp.net', '')
            .replace('@lid', '');
          if (/^\d{10,15}$/.test(extracted)) {
            numero = extracted;
          }
        }

        // MÉTODO 2: Se user é número válido
        if (!numero && id.user) {
          const userStr = String(id.user);
          if (/^\d{10,15}$/.test(userStr)) {
            numero = userStr;
          }
        }

        // MÉTODO 3: Buscar no ContactCollection (RESOLVE LID!)
        if (!numero) {
          lidCount++;
          const contactPhone = await getPhoneFromContact(id._serialized || id);
          if (contactPhone) {
            numero = contactPhone;
            resolvedCount++;
          }
        }

        // MÉTODO 4: Se server é c.us, o user deve ser o número
        if (!numero && id.server === 'c.us' && id.user) {
          const cleanUser = String(id.user).replace(/\D/g, '');
          if (/^\d{10,15}$/.test(cleanUser)) {
            numero = cleanUser;
          }
        }

        // MÉTODO 5: phoneNumber do participante
        if (!numero && p.phoneNumber) {
          const cleanPhone = String(p.phoneNumber).replace(/\D/g, '');
          if (/^\d{10,15}$/.test(cleanPhone)) {
            numero = cleanPhone;
          }
        }

        // Adicionar se encontrou número válido
        if (numero) {
          contacts.push({ number: '+' + numero });
        }
      }

      const uniqueContacts = uniqueByNumber(contacts);
      
      console.log('[WHL] Membros com telefone real:', uniqueContacts.length, 'de', participants.length);
      console.log('[WHL] LIDs encontrados:', lidCount, '| Resolvidos:', resolvedCount);

      // Salvar no cache
      setCache(groupPartKey(groupId), uniqueContacts);

      return { contacts: uniqueContacts, cached: false };

    } catch (e) {
      console.error('[WHL] Erro ao extrair contatos:', e);
      invalidate(groupPartKey(groupId));
      return { error: e.message };
    }
  }

  /* ===============================
     INVALIDAÇÃO GLOBAL
  =============================== */

  window.addEventListener('beforeunload', () => {
    invalidate(GROUP_LIST_CACHE_KEY);
  });

  /* ===============================
     EXPORTAR API GLOBAL
  =============================== */

  window.__WA_WORKER_CORE__ = {
    getGroups,
    extractContacts
  };

  console.log('[WHL] Worker Core FINAL inicializado com sucesso!');

  /* ===============================
     MESSAGE BRIDGE (MV3 SAFE)
  =============================== */

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    // IMPORTANT (Fusion): this content script runs alongside other modules.
    // We must NOT answer messages that are not explicitly targeting this worker core,
    // otherwise we steal the response and break other features (WHL_SIDE_PANEL, v6 extractor, etc.).

    const action = req?.action;

    // Only respond if the caller explicitly targets this worker core
    // (prevents conflicts with the v6 side panel which also uses action:'getGroups').
    if (req?.__whlWorkerCore !== true) {
      return false;
    }

    // Avoid conflicts with the v6 extractor API signature
    if (action === 'getGroups' && Object.prototype.hasOwnProperty.call(req, 'includeArchived')) {
      return false;
    }

    if (action !== 'getGroups' && action !== 'extractContacts') {
      return false;
    }

    (async () => {
      try {
        if (action === 'getGroups') {
          const res = await getGroups();
          sendResponse(res);
          return;
        }

        if (action === 'extractContacts') {
          const res = await extractContacts(req.groupId);
          sendResponse(res);
          return;
        }
      } catch (e) {
        sendResponse({ error: e?.message || 'Erro interno' });
      }
    })();

    return true; // 🔒 keep message channel open for async sendResponse
  });

})();
