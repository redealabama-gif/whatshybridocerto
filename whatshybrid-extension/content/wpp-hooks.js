/**
 * wpp-hooks.js — concatenado de wpp-hooks-parts/*.js (gerado por build.js).
 * Não editar; mexa nos arquivos em content/wpp-hooks-parts/ e re-build.
 */
console.log('[WHL WPP Hooks] carregando');

// ─── BEGIN 01-init-debug.js ───
/**
 * @file content/wpp-hooks-parts/01-init-debug.js
 * @description Slice 1-1500 do wpp-hooks.js (refactor v9)
 * @lines 1500
 */

/**
 * WhatsHybrid Lite - WPP Hooks (WPP Boladão tested approach)
 * Uses require() to load internal WhatsApp modules via webpack
 * Does NOT use window.Store directly (CSP blocking)
 */

window.whl_hooks_main = () => {
    // ===== DEBUG LOGGING SYSTEM =====
            const WHL_DEBUG = localStorage.getItem('whl_debug') === 'true';
    const _console = window.console;
    // Shadow local console to make logs conditional without affecting the page globally
    const console = {
        log: (...args) => { if (WHL_DEBUG) _console.log(...args); },
        info: (...args) => { if (WHL_DEBUG) (_console.info || _console.log).call(_console, ...args); },
        debug: (...args) => { if (WHL_DEBUG) (_console.debug || _console.log).call(_console, ...args); },
        warn: (...args) => _console.warn(...args),
        error: (...args) => _console.error(...args)
    };
    const whlLog = {
        debug: (...args) => { if (WHL_DEBUG) console.log('[WHL Hooks DEBUG]', ...args); },
        info: (...args) => console.log('[WHL Hooks]', ...args),
        warn: (...args) => console.warn('[WHL Hooks]', ...args),
        error: (...args) => console.error('[WHL Hooks]', ...args)
    };
    
    // ===== CONSTANTS =====
    // WhatsApp ID suffixes pattern for removal
    const WHATSAPP_SUFFIXES_REGEX = /@c\.us|@s\.whatsapp\.net|@g\.us|@broadcast|@lid/g;

    // ===== SYNC RECOVER COM chrome.storage =====
    function syncRecoverToExtension(historyArray) {
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({ 
                    type: 'WHL_SYNC_RECOVER_HISTORY', 
                    history: historyArray 
                });
            }
        } catch (e) {
            // Content script pode não ter acesso
        }
    }
    

    
    // Valid ITU-T E.164 country codes for phone number validation
    const VALID_COUNTRY_CODES = [
        '1',    // USA, Canada
        '7',    // Russia
        '20',   // Egypt
        '27',   // South Africa
        '30',   // Greece
        '31',   // Netherlands
        '32',   // Belgium
        '33',   // France
        '34',   // Spain
        '36',   // Hungary
        '39',   // Italy
        '40',   // Romania
        '41',   // Switzerland
        '43',   // Austria
        '44',   // UK
        '45',   // Denmark
        '46',   // Sweden
        '47',   // Norway
        '48',   // Poland
        '49',   // Germany
        '51',   // Peru
        '52',   // Mexico
        '53',   // Cuba
        '54',   // Argentina
        '55',   // Brazil
        '56',   // Chile
        '57',   // Colombia
        '58',   // Venezuela
        '60',   // Malaysia
        '61',   // Australia
        '62',   // Indonesia
        '63',   // Philippines
        '64',   // New Zealand
        '65',   // Singapore
        '66',   // Thailand
        '81',   // Japan
        '82',   // South Korea
        '84',   // Vietnam
        '86',   // China
        '90',   // Turkey
        '91',   // India
        '92',   // Pakistan
        '93',   // Afghanistan
        '94',   // Sri Lanka
        '95',   // Myanmar
        '98',   // Iran
        '212',  // Morocco
        '213',  // Algeria
        '216',  // Tunisia
        '218',  // Libya
        '220',  // Gambia
        '221',  // Senegal
        '222',  // Mauritania
        '223',  // Mali
        '224',  // Guinea
        '225',  // Ivory Coast
        '226',  // Burkina Faso
        '227',  // Niger
        '228',  // Togo
        '229',  // Benin
        '230',  // Mauritius
        '231',  // Liberia
        '232',  // Sierra Leone
        '233',  // Ghana
        '234',  // Nigeria
        '235',  // Chad
        '236',  // Central African Republic
        '237',  // Cameroon
        '238',  // Cape Verde
        '239',  // São Tomé and Príncipe
        '240',  // Equatorial Guinea
        '241',  // Gabon
        '242',  // Republic of the Congo
        '243',  // Democratic Republic of the Congo
        '244',  // Angola
        '245',  // Guinea-Bissau
        '246',  // British Indian Ocean Territory
        '247',  // Ascension Island
        '248',  // Seychelles
        '249',  // Sudan
        '250',  // Rwanda
        '251',  // Ethiopia
        '252',  // Somalia
        '253',  // Djibouti
        '254',  // Kenya
        '255',  // Tanzania
        '256',  // Uganda
        '257',  // Burundi
        '258',  // Mozambique
        '260',  // Zambia
        '261',  // Madagascar
        '262',  // Réunion
        '263',  // Zimbabwe
        '264',  // Namibia
        '265',  // Malawi
        '266',  // Lesotho
        '267',  // Botswana
        '268',  // Eswatini
        '269',  // Comoros
        '290',  // Saint Helena
        '291',  // Eritrea
        '297',  // Aruba
        '298',  // Faroe Islands
        '299',  // Greenland
        '350',  // Gibraltar
        '351',  // Portugal
        '352',  // Luxembourg
        '353',  // Ireland
        '354',  // Iceland
        '355',  // Albania
        '356',  // Malta
        '357',  // Cyprus
        '358',  // Finland
        '359',  // Bulgaria
        '370',  // Lithuania
        '371',  // Latvia
        '372',  // Estonia
        '373',  // Moldova
        '374',  // Armenia
        '375',  // Belarus
        '376',  // Andorra
        '377',  // Monaco
        '378',  // San Marino
        '380',  // Ukraine
        '381',  // Serbia
        '382',  // Montenegro
        '385',  // Croatia
        '386',  // Slovenia
        '387',  // Bosnia and Herzegovina
        '389',  // North Macedonia
        '420',  // Czech Republic
        '421',  // Slovakia
        '423',  // Liechtenstein
        '500',  // Falkland Islands
        '501',  // Belize
        '502',  // Guatemala
        '503',  // El Salvador
        '504',  // Honduras
        '505',  // Nicaragua
        '506',  // Costa Rica
        '507',  // Panama
        '508',  // Saint Pierre and Miquelon
        '509',  // Haiti
        '590',  // Guadeloupe
        '591',  // Bolivia
        '592',  // Guyana
        '593',  // Ecuador
        '594',  // French Guiana
        '595',  // Paraguay
        '596',  // Martinique
        '597',  // Suriname
        '598',  // Uruguay
        '599',  // Curaçao
        '670',  // East Timor
        '672',  // Norfolk Island
        '673',  // Brunei
        '674',  // Nauru
        '675',  // Papua New Guinea
        '676',  // Tonga
        '677',  // Solomon Islands
        '678',  // Vanuatu
        '679',  // Fiji
        '680',  // Palau
        '681',  // Wallis and Futuna
        '682',  // Cook Islands
        '683',  // Niue
        '685',  // Samoa
        '686',  // Kiribati
        '687',  // New Caledonia
        '688',  // Tuvalu
        '689',  // French Polynesia
        '690',  // Tokelau
        '691',  // Micronesia
        '692',  // Marshall Islands
        '850',  // North Korea
        '852',  // Hong Kong
        '853',  // Macau
        '855',  // Cambodia
        '856',  // Laos
        '880',  // Bangladesh
        '886',  // Taiwan
        '960',  // Maldives
        '961',  // Lebanon
        '962',  // Jordan
        '963',  // Syria
        '964',  // Iraq
        '965',  // Kuwait
        '966',  // Saudi Arabia
        '967',  // Yemen
        '968',  // Oman
        '970',  // Palestine
        '971',  // United Arab Emirates
        '972',  // Israel
        '973',  // Bahrain
        '974',  // Qatar
        '975',  // Bhutan
        '976',  // Mongolia
        '977',  // Nepal
        '992',  // Tajikistan
        '993',  // Turkmenistan
        '994',  // Azerbaijan
        '995',  // Georgia
        '996',  // Kyrgyzstan
        '998'   // Uzbekistan
    ];
    
    // Sorted country codes (longest first) for efficient prefix matching
    const SORTED_COUNTRY_CODES = VALID_COUNTRY_CODES.slice().sort((a, b) => b.length - a.length);
    
    // ===== BUG FIX 3: HELPER FUNCTIONS =====
    
    /**
     * Convert base64 to Blob
     * @param {string} base64 - Base64 encoded data
     * @param {string} contentType - MIME type
     * @returns {Blob} - Blob object
     */
    function base64ToBlob(base64, contentType = '') {
        const sliceSize = 512;
        const byteCharacters = atob(base64.split(',').pop() || base64);
        const byteArrays = [];

        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }

        return new Blob(byteArrays, { type: contentType });
    }
    
    /**
     * Sleep helper function
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise} - Promise that resolves after delay
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // ===== HELPER FUNCTIONS FOR GROUP MEMBER EXTRACTION =====
    function safeRequire(name) {
        try {
            if (typeof require === 'function') {
                return require(name);
            }
        } catch {}
        return null;
    }

    function resolveCollections() {
        // A — require()
        try {
            const ChatMod = safeRequire('WAWebChatCollection');
            const ContactMod = safeRequire('WAWebContactCollection');

            if (ChatMod && ContactMod) {
                const ChatCollection =
                    ChatMod.ChatCollection || ChatMod.default?.ChatCollection;
                const ContactCollection =
                    ContactMod.ContactCollection || ContactMod.default?.ContactCollection;

                if (ChatCollection && ContactCollection) {
                    return { ChatCollection, ContactCollection };
                }
            }
        } catch {}

        // B — globais (quando existirem)
        try {
            if (window.ChatCollection && window.ContactCollection) {
                return {
                    ChatCollection: window.ChatCollection,
                    ContactCollection: window.ContactCollection
                };
            }
        } catch {}

        // C — introspecção defensiva
        try {
            for (const k in window) {
                const v = window[k];
                if (v?.getModelsArray && v?.get) {
                    const arr = v.getModelsArray();
                    if (Array.isArray(arr) && arr.some(c => c?.id?.server === 'g.us')) {
                        return { ChatCollection: v, ContactCollection: null };
                    }
                }
            }
        } catch {}

        return null;
    }

    async function waitForCollections(maxTries = 50, delay = 400) {
        for (let i = 0; i < maxTries; i++) {
            const cols = resolveCollections();
            if (cols?.ChatCollection) return cols;
            await new Promise(r => setTimeout(r, delay));
        }
        return null;
    }

    /**
     * PR #76 ULTRA: Validação de telefone melhorada
     * Validação básica usada em outras partes do sistema
     * Verifica comprimento e rejeita números contendo ':' ou '@lid'
     * @param {string} num - Número a ser validado
     * @returns {boolean} - true se válido, false caso contrário
     */
    function isValidPhone(num) {
        if (!num) return false;
        const clean = String(num).replace(/\D/g, '');
        
        // Rejeitar LIDs (contêm ':' ou '@lid')
        if (String(num).includes(':') || String(num).includes('@lid')) {
            return false;
        }
        
        // Aceitar apenas números válidos (10-15 dígitos)
        return /^\d{10,15}$/.test(clean);
    }

    /**
     * Valida se um número de telefone começa com um código de país válido
     * Usado especificamente para validar números extraídos de mensagens WhatsApp
     * e rejeitar LIDs (identificadores internos do WhatsApp)
     * @param {string} digits - String contendo apenas dígitos
     * @returns {boolean} - true se o número é válido, false caso contrário
     */
    function isValidPhoneNumber(digits) {
        if (!digits || digits.length < 10 || digits.length > 15) return false;
        
        // Verificar se começa com código de país válido
        // Usa códigos pré-ordenados (longest first) para evitar falsos positivos
        // Ex: '212' deve ser testado antes de '1' para números do Marrocos
        for (const code of SORTED_COUNTRY_CODES) {
            if (digits.startsWith(code)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Resolve um LID (Local ID) para o número de telefone real
     * Busca no ContactCollection do WhatsApp
     * @param {string} lid - O LID a ser resolvido (ex: '143379161678071')
     * @returns {string|null} - O número de telefone ou null se não encontrado
     */
    function resolveLidToPhone(lid) {
        if (!lid) return null;
        
        // Limpar o LID usando o regex padrão
        const cleanLid = String(lid).replace(WHATSAPP_SUFFIXES_REGEX, '');
        
        try {
            const CC = require('WAWebContactCollection');
            
            // Método 1: Buscar diretamente pelo LID
            const contact = CC.ContactCollection.get(cleanLid + '@lid');
            if (contact && contact.phoneNumber) {
                const phone = contact.phoneNumber._serialized || contact.phoneNumber.user;
                if (phone) {
                    const cleanPhone = String(phone).replace(WHATSAPP_SUFFIXES_REGEX, '');
                    // Validar se é um número válido
                    if (/^\d{10,15}$/.test(cleanPhone)) {
                        console.log('[WHL] LID resolvido:', cleanLid, '→', cleanPhone);
                        return cleanPhone;
                    }
                }
            }
            
            // Método 2: Buscar na lista de contatos
            const contacts = CC.ContactCollection.getModelsArray() || [];
            const found = contacts.find(c => 
                c.id.user === cleanLid || 
                c.id._serialized === cleanLid + '@lid'
            );
            
            if (found && found.phoneNumber) {
                const phone = found.phoneNumber._serialized || found.phoneNumber.user;
                if (phone) {
                    const cleanPhone = String(phone).replace(WHATSAPP_SUFFIXES_REGEX, '');
                    if (/^\d{10,15}$/.test(cleanPhone)) {
                        console.log('[WHL] LID resolvido via busca:', cleanLid, '→', cleanPhone);
                        return cleanPhone;
                    }
                }
            }
            
        } catch(e) {
            console.warn('[WHL] Erro ao resolver LID:', e.message);
        }
        
        return null;
    }

    /**
     * Extrai número de telefone de um objeto de mensagem do WhatsApp
     * Busca em múltiplos campos e formata corretamente
     * @param {Object} message - Objeto de mensagem do WhatsApp
     * @returns {string} - Número de telefone limpo ou "Desconhecido"
     */
    function extractPhoneNumber(message) {
        // Lista de campos onde o número pode estar
        const sources = [
            message?.sender,
            message?.phoneNumber,
            message?.number,
            message?.author?._serialized,
            message?.author?.user,
            message?.from?._serialized,
            message?.from?.user,
            message?.from,
            message?.to?._serialized,      // CORREÇÃO 1.3: ADICIONAR
            message?.to?.user,              // CORREÇÃO 1.3: ADICIONAR
            message?.to,                    // CORREÇÃO 1.3: ADICIONAR
            message?.chat?.contact?.number,
            message?.chat?.contact?.id?.user,
            message?.chat?.id?.user,
            message?.id?.remote?._serialized,
            message?.id?.remote?.user,
            message?.id?.participant?._serialized,
            message?.id?.participant?.user
        ];
        
        // Coletar LIDs encontrados para fallback
        const foundLids = [];
        
        for (const src of sources) {
            if (!src) continue;
            let s = String(src).trim();
            
            // Se é um LID, tentar resolver para número real
            if (s.includes('@lid')) {
                const resolved = resolveLidToPhone(s);
                if (resolved) {
                    return resolved;
                }
                // Coletar LID para fallback
                const lidMatch = s.match(/(\d{10,15})@lid/);
                if (lidMatch) {
                    foundLids.push(lidMatch[1]);
                }
                continue; // Pular este source se não conseguir resolver
            }
            
            // Remove TODOS os sufixos do WhatsApp usando regex constante
            s = s.replace(WHATSAPP_SUFFIXES_REGEX, '');
            
            // Extrai apenas dígitos
            const digits = s.replace(/\D/g, '');
            
            // Valida se é um número de telefone válido (com código de país)
            if (isValidPhoneNumber(digits)) {
                return digits;
            }
        }
        
        // Fallback: tentar resolver LIDs coletados
        for (const lid of foundLids) {
            const resolved = resolveLidToPhone(lid);
            if (resolved) {
                return resolved;
            }
        }
        
        return 'Desconhecido';
    }

    // PR #76 ULTRA: Resolução de LID ULTRA (7 campos + 5 variações de ID)
    async function resolveContactPhoneUltra(participantId, collections) {
        if (!collections?.ContactCollection) {
            whlLog.warn('ContactCollection não disponível');
            return null;
        }

        // Lista de IDs para tentar (5 VARIAÇÕES)
        const searchIds = [
            participantId,
            String(participantId).replace(/@c\.us|@s\.whatsapp\.net|@lid/g, ''),
            String(participantId).replace('@lid', '').split(':')[0],
            String(participantId).split(':')[0],
            String(participantId).split('@')[0]
        ];

        for (const id of searchIds) {
            if (!id) continue;

            try {
                let contact = collections.ContactCollection.get(id);
                if (!contact && !id.includes('@')) {
                    contact = collections.ContactCollection.get(id + '@c.us');
                }

                if (contact) {
                    // 7 CAMPOS onde o número pode estar
                    const possibleNumbers = [
                        contact.phoneNumber,
                        contact.formattedNumber,
                        contact.id?.user,
                        contact.userid,
                        contact.number,
                        contact.id?._serialized?.replace(/@c\.us|@s\.whatsapp\.net|@lid/g, ''),
                        contact.verifiedName,
                    ];

                    for (const num of possibleNumbers) {
                        if (!num) continue;
                        const clean = String(num).replace(/\D/g, '');
                        if (isValidPhone(clean)) {
                            whlLog.debug(`LID resolvido: ${String(participantId).substring(0, 30)}... → ${clean}`);
                            return clean;
                        }
                    }
                }
            } catch (e) {
                continue;
            }
        }

        whlLog.warn(`Não foi possível resolver: ${String(participantId).substring(0, 30)}...`);
        return null;
    }
    
    // MANTER FUNÇÃO ANTIGA PARA COMPATIBILIDADE
    async function getPhoneFromContact(participantId) {
        const cols = await waitForCollections();
        if (!cols) return null;
        return await resolveContactPhoneUltra(participantId, cols);
    }
    
    // ===== Robust Webpack require bootstrap =====
    function getWpRequire() {
        if (window.webpackChunkwhatsapp_web_client) {
            return window.webpackChunkwhatsapp_web_client.push([
                ['__whl'], {}, (req) => req
            ]);
        }
        if (window.webpackJsonp) {
            let __req;
            window.webpackJsonp.push([['__whl'], { '__whl': (m, e, r) => { __req = r; } }, ['__whl']]);
            return __req;
        }
        return null;
    }

    function findModule(filterFn) {
        const wp = getWpRequire();
        if (!wp || !wp.c) return null;
        for (const id of Object.keys(wp.c)) {
            const m = wp.c[id]?.exports;
            if (!m) continue;
            if (filterFn(m)) return m;
            if (m.default && filterFn(m.default)) return m.default;
        }
        return null;
    }

    // ===== ACESSO AOS MÓDULOS VIA REQUIRE (LAZY LOADING) =====
    // Chamado DENTRO de cada função para garantir que módulos já existem
    function getModules() {
        try {
            const ChatCollection = require('WAWebChatCollection');
            const ContactCollection = require('WAWebContactCollection');
            const BlocklistCollection = require('WAWebBlocklistCollection');
            
            return {
                ChatCollection: ChatCollection?.ChatCollection || null,
                ContactCollection: ContactCollection?.ContactCollection || null,
                BlocklistCollection: BlocklistCollection?.BlocklistCollection || null
            };
        } catch (e) {
            whlLog.warn('Módulos não disponíveis ainda:', e.message);
            return null;
        }
    }

    // Resolve a chat/contact model to a real phone-number string.
    //
    // CRITICAL: WhatsApp Web 2.3000.x migrated 1-on-1 chats to @lid (Linked
    // Device IDs). A @lid id is NOT a phone number — its digits are an
    // opaque routing identifier (e.g. "155757190365423"). Returning those as
    // if they were phones produced the "números grandes e aleatórios" the
    // user reported. We therefore ONLY accept digit strings that came from
    // a phone-shaped server (c.us / s.whatsapp.net), or from an explicit
    // __x_phoneNumber / pnh / pn field. If a @lid chat has no resolvable
    // phone, we return null and the caller skips it.
    function resolvePhoneFromChat(chat) {
        if (!chat || !chat.id) return null;

        // From a fully serialized id like "5521991639989@c.us".
        const fromSerialized = (s) => {
            if (!s) return null;
            const m = String(s).match(/^(\d{8,15})@(?:c\.us|s\.whatsapp\.net)$/);
            return m ? m[1] : null;
        };
        // From an id object — only when its server is phone-shaped.
        const userIfPhoneServer = (idObj) => {
            if (!idObj) return null;
            const server = idObj.server;
            if (server !== 'c.us' && server !== 's.whatsapp.net') return null;
            const u = idObj.user;
            return (typeof u === 'string' && /^\d{8,15}$/.test(u)) ? u : null;
        };
        // From a "bare" phone-number-ish field. Strips non-digits; rejects
        // anything that doesn't end up 8–15 digits long.
        const fromBareField = (v) => {
            if (v === undefined || v === null) return null;
            const d = String(v).replace(/\D/g, '');
            return /^\d{8,15}$/.test(d) ? d : null;
        };

        // 1) Direct id: works for @c.us / @s.whatsapp.net chats and contacts.
        let p = fromSerialized(chat.id._serialized) || userIfPhoneServer(chat.id);
        if (p) return p;

        // 2) Explicit phone-number fields on the chat model.
        for (const v of [chat.__x_phoneNumber, chat.phoneNumber,
                         chat.__x_pnh, chat.pnh,
                         chat.__x_pn, chat.pn]) {
            const r = fromBareField(v);
            if (r) return r;
        }

        // 3) Walk to Contact model. A @lid chat usually still has a Contact
        //    model whose own id is @c.us — that's the real phone.
        const contact = chat.__x_contact || chat.contact;
        if (contact && contact !== chat) {
            p = fromSerialized(contact.id?._serialized) || userIfPhoneServer(contact.id);
            if (p) return p;
            for (const v of [contact.__x_phoneNumber, contact.phoneNumber,
                             contact.__x_pnh, contact.pnh,
                             contact.__x_pn, contact.pn]) {
                const r = fromBareField(v);
                if (r) return r;
            }
        }
        return null;
    }

    // True when a chat belongs to a 1-on-1 conversation (not a group/broadcast).
    function isOneOnOneChat(chat) {
        const server = chat?.id?.server;
        if (server === 'g.us' || server === 'broadcast') return false;
        // Accept c.us (legacy), s.whatsapp.net, and lid (new linked-device IDs).
        return server === 'c.us' || server === 's.whatsapp.net' || server === 'lid';
    }

    // ===== EXTRAÇÃO DE CONTATOS =====
    function extrairContatos() {
        try {
            const modules = getModules();
            if (!modules || !modules.ChatCollection) {
                console.error('[WHL] ChatCollection não disponível');
                return { success: false, error: 'Módulos não disponíveis', contacts: [], count: 0 };
            }

            const models = modules.ChatCollection.getModelsArray() || [];
            whlLog.debug('Total de chats encontrados:', models.length);

            let lidResolved = 0;
            let cusDirect = 0;
            let unresolvable = 0;
            let archivedSkipped = 0;
            let groupsSkipped = 0;
            const collected = [];

            for (const m of models) {
                try {
                    if (!isOneOnOneChat(m)) { groupsSkipped++; continue; }
                    // Skip archived — extrairArquivados handles those.
                    if (m.__x_archive === true || m.archive === true) {
                        archivedSkipped++;
                        continue;
                    }
                    const phone = resolvePhoneFromChat(m);
                    if (!phone) { unresolvable++; continue; }
                    if (m.id?.server === 'lid') lidResolved++;
                    else cusDirect++;
                    collected.push(phone);
                } catch (_) {}
            }

            // Augment with the address book (Contact collection) — covers
            // saved contacts you've never opened a chat with.
            if (modules.ContactCollection?.getModelsArray) {
                const contacts = modules.ContactCollection.getModelsArray() || [];
                for (const c of contacts) {
                    try {
                        if (c?.id?.server === 'g.us' || c?.id?.server === 'broadcast') continue;
                        const phone = resolvePhoneFromChat(c);
                        if (phone) collected.push(phone);
                    } catch (_) {}
                }
            }

            const uniqueContatos = [...new Set(collected.filter(n => /^\d{8,15}$/.test(n)))];
            console.log(`[WHL Hooks] Contatos — chats: ${models.length}, ` +
                `c.us direto: ${cusDirect}, lid→phone: ${lidResolved}, ` +
                `arquivados ignorados: ${archivedSkipped}, grupos: ${groupsSkipped}, ` +
                `sem-telefone: ${unresolvable}, total único: ${uniqueContatos.length}`);

            return {
                success: true,
                contacts: uniqueContatos,
                count: uniqueContatos.length
            };
        } catch (e) {
            console.error('[WHL] Erro ao extrair contatos:', e);
            return {
                success: false,
                error: e.message,
                contacts: [],
                count: 0
            };
        }
    }

    // ===== EXTRAÇÃO DE GRUPOS =====
    function extrairGrupos() {
        const modules = getModules();
        if (!modules || !modules.ChatCollection) {
            console.warn('[WHL Hooks] ChatCollection não disponível');
            return { success: false, groups: [], error: 'Módulos não carregados' };
        }
        
        try {
            const models = modules.ChatCollection.getModelsArray() || [];
            const grupos = models
                .filter(m => m.id && m.id.server === 'g.us')
                .map(g => ({
                    id: g.id._serialized,
                    // WA 2.3000.x+ moved name fields under __x_ prefix.
                    name: g.__x_name || g.name || g.__x_formattedTitle || g.formattedTitle || 'Grupo sem nome',
                    participants: (g.__x_groupMetadata || g.groupMetadata)?.participants?.length || 0
                }));
            
            console.log('[WHL Hooks] Grupos extraídos:', grupos.length);
            return { success: true, groups: grupos, count: grupos.length };
        } catch (e) {
            console.error('[WHL Hooks] Erro ao extrair grupos:', e);
            return { success: false, groups: [], error: e.message };
        }
    }

    // ===== EXTRAÇÃO DE ARQUIVADOS =====
    function extrairArquivados() {
        const modules = getModules();
        if (!modules || !modules.ChatCollection) {
            return { success: false, archived: [], error: 'Módulos não carregados' };
        }

        try {
            const models = modules.ChatCollection.getModelsArray() || [];

            const arquivados = [];
            let seen = 0;
            let unresolvable = 0;
            for (const m of models) {
                try {
                    const isArchived = m.__x_archive === true || m.archive === true;
                    if (!isArchived) continue;
                    if (!isOneOnOneChat(m)) continue;
                    seen++;
                    const phone = resolvePhoneFromChat(m);
                    if (phone && /^\d{8,15}$/.test(phone)) arquivados.push(phone);
                    else unresolvable++;
                } catch (_) {}
            }

            console.log(`[WHL Hooks] Arquivados — encontrados: ${seen}, ` +
                `sem-telefone(@lid puro): ${unresolvable}, total: ${arquivados.length}`);
            return { success: true, archived: [...new Set(arquivados)], count: arquivados.length };
        } catch (e) {
            console.error('[WHL Hooks] Erro ao extrair arquivados:', e);
            return { success: false, archived: [], error: e.message };
        }
    }

    // ===== EXTRAÇÃO DE BLOQUEADOS =====
    function extrairBloqueados() {
        const modules = getModules();
        if (!modules || !modules.BlocklistCollection) {
            return { success: false, blocked: [], error: 'BlocklistCollection não disponível' };
        }

        try {
            const blocklist = modules.BlocklistCollection.getModelsArray
                ? modules.BlocklistCollection.getModelsArray()
                : (modules.BlocklistCollection._models || []);

            const bloqueados = [];
            for (const b of blocklist) {
                try {
                    // First try direct resolution (works for legacy @c.us entries).
                    let phone = resolvePhoneFromChat(b);
                    // For @lid blocklist entries, look the contact up in
                    // ContactCollection to find the underlying phone number.
                    if (!phone && b?.id?._serialized && modules.ContactCollection?.get) {
                        const c = modules.ContactCollection.get(b.id._serialized);
                        if (c) phone = resolvePhoneFromChat(c);
                    }
                    if (phone && /^\d{8,15}$/.test(phone)) bloqueados.push(phone);
                } catch (_) {}
            }

            console.log(`[WHL Hooks] Bloqueados extraídos: ${bloqueados.length}`);
            return { success: true, blocked: [...new Set(bloqueados)], count: bloqueados.length };
        } catch (e) {
            console.error('[WHL Hooks] Erro ao extrair bloqueados:', e);
            return { success: false, blocked: [], error: e.message };
        }
    }

    // ===== EXTRAÇÃO COMPLETA =====
    function extrairTudo() {
        const contatos = extrairContatos();
        const grupos = extrairGrupos();
        const arquivados = extrairArquivados();
        const bloqueados = extrairBloqueados();
        
        return {
            success: true,
            contacts: contatos.contacts || [],
            groups: grupos.groups || [],
            archived: arquivados.archived || [],
            blocked: bloqueados.blocked || [],
            stats: {
                contacts: contatos.count || 0,
                groups: grupos.count || 0,
                archived: arquivados.count || 0,
                blocked: bloqueados.count || 0
            }
        };
    }

    // ============================================
    // FUNÇÕES DE ENVIO - TESTADAS E VALIDADAS
    // ============================================

    // Timeouts para envio de mensagens (em milissegundos)
    const TIMEOUTS = {
        IMAGE_PASTE_WAIT: 2500,    // Tempo para modal de imagem aparecer após paste
        CAPTION_INPUT_WAIT: 400,   // Tempo para campo de caption processar texto
        MESSAGE_SEND_DELAY: 1200   // Delay entre envio de texto e imagem
    };

    /**
     * Extrai contatos arquivados e bloqueados via DOM
     * Combina API e DOM para máxima cobertura
     */
    async function extrairArquivadosBloqueadosDOM() {
        console.log('[WHL] Iniciando extração de arquivados/bloqueados via DOM...');
        
        const result = { archived: [], blocked: [] };
        
        // Método 1: Tentar via API primeiro (Arquivados)
        try {
            const CC = require('WAWebChatCollection');
            const chats = CC?.ChatCollection?.getModelsArray?.() || [];
            
            // Arquivados
            result.archived = chats
                .filter(c => c.archive === true && c.id?._serialized?.endsWith('@c.us'))
                .map(c => c.id._serialized.replace('@c.us', ''))
                .filter(n => /^\d{8,15}$/.test(n));
            
            console.log('[WHL] Arquivados via API:', result.archived.length);
        } catch (e) {
            console.warn('[WHL] Erro ao extrair arquivados via API:', e);
        }
        
        // Bloqueados via BlocklistCollection
        try {
            const BC = require('WAWebBlocklistCollection');
            const blocklist = BC?.BlocklistCollection?.getModelsArray?.() || [];
            
            result.blocked = blocklist
                .map(c => c.id?._serialized?.replace('@c.us', '') || c.id?.user || '')
                .filter(n => /^\d{8,15}$/.test(n));
            
            console.log('[WHL] Bloqueados via API:', result.blocked.length);
        } catch (e) {
            console.warn('[WHL] Erro ao extrair bloqueados via API:', e);
        }
        
        return result;
    }

    /**
     * Envia mensagem de TEXTO para qualquer número via API interna do WhatsApp
     * NÃO CAUSA RELOAD!
     */
    async function enviarMensagemAPI(phone, mensagem) {
        console.log('[WHL] 📨 Enviando TEXTO para', phone);

        // Resilient module pick: returns the first non-falsy candidate found
        // in (mod[name], mod.default?.[name], or — when name is omitted —
        // mod itself / mod.default). Returns null when nothing matches.
        const pickAny = (mod, ...names) => {
            if (!mod) return null;
            const candidates = names.length ? names : ['__SELF__'];
            for (const n of candidates) {
                if (n === '__SELF__') {
                    if (mod) return mod;
                    if (mod.default) return mod.default;
                    continue;
                }
                if (mod[n]) return mod[n];
                if (mod.default && mod.default[n]) return mod.default[n];
            }
            return null;
        };
        const safeRequire = (name) => {
            try { return typeof require === 'function' ? require(name) : null; }
            catch (_) { return null; }
        };

        try {
            // ── Resolve WA modules with multiple shape candidates ──────────
            // WhatsApp Web 2.3000.x renamed/restructured several exports.
            // Each pickAny() call probes legacy AND modern names so the same
            // codebase works across builds.
            const WFmod  = safeRequire('WAWebWidFactory');
            const CCmod  = safeRequire('WAWebChatCollection');
            const SCAmod = safeRequire('WAWebSendMsgChatAction');     // modern path
            const SMRA   = safeRequire('WAWebSendMsgRecordAction');   // legacy path
            const CMmod  = safeRequire('WAWebChatModel');
            const MMmod  = safeRequire('WAWebMsgModel');
            const MKmod  = safeRequire('WAWebMsgKey');

            // WAWebWidFactory can be either the namespace (with .createWid /
            // .WidFactory.createWid) or expose createWid directly on default.
            const WFns = pickAny(WFmod, 'WidFactory') || WFmod?.default || WFmod;
            const createWid =
                pickAny(WFmod, 'createWid')
                || (typeof WFns === 'function' ? WFns : null)
                || pickAny(WFns, 'createWid');
            const ChatCollection  = pickAny(CCmod, 'ChatCollection') || CCmod?.default || CCmod;
            const sendTextMsgToChat =
                pickAny(SCAmod, 'sendTextMsgToChat', 'sendTextMessageToChat')
                || (typeof (SCAmod?.default) === 'function' ? SCAmod.default : null);
            // ChatModel / MsgModel / MsgKey are only used by the legacy path.
            const ChatCtor        = pickAny(CMmod, 'Chat', 'ChatModel');
            const MsgCtor         = pickAny(MMmod, 'Msg', 'MsgModel');
            const newMsgId        = pickAny(MKmod, 'newId');
            const sendMsgRecord   = pickAny(SMRA, 'sendMsgRecord', 'addAndSendMsgToChat');

            if (!createWid) throw new Error('createWid not available');
            if (!ChatCollection) throw new Error('ChatCollection not available');

            const textoOriginal = mensagem; // preserve \n
            const wid = createWid(phone + '@c.us');

            let chat = ChatCollection.get(wid);
            if (!chat) {
                if (ChatCtor) {
                    chat = new ChatCtor({ id: wid });
                    ChatCollection.add(chat);
                } else if (typeof ChatCollection.find === 'function') {
                    chat = await ChatCollection.find(wid);
                }
                if (!chat) throw new Error('Could not create/find chat');
            }

            // ── Path A (modern): sendTextMsgToChat(chat, text, extra) ──────
            // Available in WA 2.3000.x. Single call; no need to build a Msg
            // model by hand. Use this whenever possible.
            if (typeof sendTextMsgToChat === 'function') {
                console.log('[WHL] ✅ Using modern sendTextMsgToChat');
                const result = await sendTextMsgToChat(chat, textoOriginal, {});
                console.log('[WHL] ✅ TEXTO enviado (modern):', result);
                return { success: true, result };
            }

            // ── Path B (legacy): sendMsgRecord / addAndSendMsgToChat ───────
            // Requires building a Msg object — only works when MsgModel/MsgKey
            // are still exported with the legacy shape.
            if (sendMsgRecord && MsgCtor && newMsgId) {
                console.log('[WHL] ⚠️ Falling back to legacy sendMsgRecord');
                const msgId = await newMsgId();
                const msg = new MsgCtor({
                    id: { fromMe: true, remote: wid, id: msgId,
                          _serialized: 'true_' + wid._serialized + '_' + msgId },
                    body: textoOriginal,
                    type: 'chat',
                    t: Math.floor(Date.now() / 1000),
                    from: wid, to: wid, self: 'out', isNewMsg: true, local: true
                });
                const result = await sendMsgRecord(msg);
                try {
                    if (chat.msgs?.sync) await chat.msgs.sync();
                    if (chat.reload) await chat.reload();
                } catch (_) {}
                console.log('[WHL] ✅ TEXTO enviado (legacy):', result);
                return { success: true, result };
            }

            throw new Error('No send path available — both modern and legacy missing');
        } catch (error) {
            console.error('[WHL] ❌ Erro ao enviar TEXTO:', error?.message || error);
            return { success: false, error: error?.message || String(error) };
        }
    }

    /**
     * Encontra o campo de composição de mensagem
     */
    function acharCompose() {
        return document.querySelector('footer div[contenteditable="true"][role="textbox"]')
            || document.querySelector('[data-testid="conversation-compose-box-input"]')
            || document.querySelector('div[contenteditable="true"][role="textbox"]');
    }

    /**
     * Simula pressionar ENTER em um elemento
     */
    function pressEnter(el) {
        el.focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    /**
     * Envia IMAGEM via DOM (paste + ENTER)
     * Funciona com legenda (caption)
     */
    async function enviarImagemDOM(base64Image, caption) {
        console.log('[WHL] 🖼️ Enviando IMAGEM...');
        
        try {
            var response = await fetch(base64Image);
            var blob = await response.blob();

            var input = acharCompose();
            if (!input) {
                console.error('[WHL] ❌ Campo de composição não encontrado');
                return { success: false, error: 'INPUT_NOT_FOUND' };
            }

            var dt = new DataTransfer();
            dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));

            input.focus();
            input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));

            await new Promise(r => setTimeout(r, TIMEOUTS.IMAGE_PASTE_WAIT));

            // v9.6.0: BUG — o último seletor (`div[contenteditable=true]
            // [data-lexical-editor=true]`) também casa com o COMPOSER do chat
            // (que fica no footer e aparece ANTES no DOM). Resultado: legenda
            // era escrita no chat e o ENTER mandava texto vazio, deixando a
            // imagem encalhada no modal de preview. Agora, priorizamos seletores
            // que estão FORA do footer (caption do modal vive em #app no body).
            function findCaptionInput() {
                // Aria-label costuma ser "Adicionar uma legenda..." ou similar.
                const byAria = document.querySelector('[aria-label*="legenda" i][contenteditable="true"]')
                            || document.querySelector('[aria-label*="caption" i][contenteditable="true"]');
                if (byAria) return byAria;
                // Legacy testids.
                const byTest = document.querySelector('[data-testid="media-caption-input-container"] [contenteditable="true"]')
                            || document.querySelector('[data-testid="media-caption-input"] [contenteditable="true"]');
                if (byTest) return byTest;
                // Último recurso: contenteditable lexical-editor que NÃO está dentro de <footer>.
                const candidates = document.querySelectorAll('div[contenteditable="true"][data-lexical-editor="true"]');
                for (const el of candidates) {
                    if (!el.closest('footer')) return el;
                }
                return null;
            }
            var captionInput = findCaptionInput();

            if (!captionInput) {
                // Only error if we actually need to add a caption
                if (caption) {
                    console.error('[WHL] ❌ Campo de caption não encontrado');
                    return { success: false, error: 'CAPTION_INPUT_NOT_FOUND' };
                }
                // No caption needed and no input found - try to send anyway
                console.warn('[WHL] ⚠️ Campo de caption não encontrado, mas sem caption para adicionar');
            } else {
                if (caption) {
                    captionInput.focus();
                    
                    // CORREÇÃO: Limpar completamente o campo antes de digitar
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(captionInput);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    document.execCommand('delete', false, null);
                    captionInput.innerHTML = '';
                    captionInput.textContent = '';
                    captionInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 50));
                    captionInput.focus();
                    
                    // Note: Using execCommand despite deprecation warning because it's the only method
                    // that reliably triggers WhatsApp Web's internal message handlers during testing
                    
                    // IMPORTANTE: Preservar quebras de linha (\n) dividindo em linhas
                    const lines = caption.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (i > 0) {
                            // Inserir quebra de linha com Shift+Enter
                            captionInput.dispatchEvent(new KeyboardEvent('keydown', {
                                key: 'Enter',
                                code: 'Enter',
                                keyCode: 13,
                                which: 13,
                                shiftKey: true,
                                bubbles: true,
                                cancelable: true
                            }));
                            await new Promise(r => setTimeout(r, 50));
                        }
                        
                        if (lines[i]) {
                            document.execCommand('insertText', false, lines[i]);
                        }
                    }
                    console.log('[WHL] 📝 Caption adicionado (com quebras preservadas):', caption);
                }

                await new Promise(r => setTimeout(r, TIMEOUTS.CAPTION_INPUT_WAIT));

                // v9.6.0: pressEnter sozinho não disparava em algumas builds
                // do WA. Tenta clicar no botão "Enviar" do modal antes do Enter.
                const sendBtnInModal = document.querySelector('[aria-label*="Enviar" i][role="button"]:not(footer *)')
                                   || document.querySelector('span[data-icon="send"]:not(footer *)')?.closest('[role="button"], button')
                                   || document.querySelector('[data-icon="send"]:not(footer *)')?.closest('div[role="button"]');
                if (sendBtnInModal) {
                    sendBtnInModal.click();
                } else {
                    pressEnter(captionInput);
                }
            }

            console.log('[WHL] ✅ IMAGEM enviada!');
            return { success: true };
        } catch (error) {
            console.error('[WHL] ❌ Erro ao enviar IMAGEM:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * CORREÇÃO BUG 2: Abre o chat de um número específico via navegação de URL
     * @param {string} phone - Número de telefone
     * @returns {Promise<boolean>} - true se chat foi aberto
     */
    async function abrirChatPorNumero(phone) {
        console.log('[WHL] 📱 Abrindo chat para:', phone);

        try {
            // Multi-shape module pickers (mirrors enviarMensagemAPI).
            const _pickAny = (mod, ...names) => {
                if (!mod) return null;
                for (const n of names) {
                    if (mod[n] != null) return mod[n];
                    if (mod.default && mod.default[n] != null) return mod.default[n];
                }
                return null;
            };
            const _safeReq = (n) => { try { return typeof require === 'function' ? require(n) : null; } catch (_) { return null; } };

            const WFmod = _safeReq('WAWebWidFactory');
            const CCmod = _safeReq('WAWebChatCollection');
            const CMmod = _safeReq('WAWebChatModel');
            const Cmdmod = _safeReq('WAWebCmd');

            const WFns = _pickAny(WFmod, 'WidFactory') || WFmod?.default || WFmod;
            const createWid =
                _pickAny(WFmod, 'createWid')
                || (typeof WFns === 'function' ? WFns : null)
                || _pickAny(WFns, 'createWid');
            const ChatCollection = _pickAny(CCmod, 'ChatCollection') || CCmod?.default || CCmod;
            const ChatCtor = _pickAny(CMmod, 'Chat', 'ChatModel');
            const openChatAt = _pickAny(Cmdmod, 'openChatAt') || _pickAny(_pickAny(Cmdmod, 'Cmd'), 'openChatAt');

            if (!createWid || !ChatCollection) throw new Error('WidFactory/ChatCollection unavailable');

            const wid = createWid(phone + '@c.us');
            let chat = ChatCollection.get?.(wid);

            if (!chat && ChatCtor) {
                chat = new ChatCtor({ id: wid });
                ChatCollection.add?.(chat);
            }

            // MÉTODO CORRETO: Usar openChat do CMD
            if (chat && typeof openChatAt === 'function') {
                try {
                    await openChatAt(chat);
                    await new Promise(r => setTimeout(r, 2000));
                    return true;
                } catch (e) {
                    console.log('[WHL] openChatAt falhou, tentando URL...');
                }
            }
            
            // FALLBACK: Simular clique no contato ou usar URL
            // Navegar para o chat via URL do WhatsApp Web
            const currentUrl = window.location.href;
            const targetUrl = `https://web.whatsapp.com/send?phone=${phone}`;
            
            if (!currentUrl.includes(phone)) {
                // Criar link e clicar
                const link = document.createElement('a');
                link.href = targetUrl;
                link.target = '_self';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                
                // Aguardar página carregar
                await new Promise(r => setTimeout(r, 3000));
                
                // Verificar se o número é inválido após navegação
                const bodyText = document.body.innerText || document.body.textContent || '';
                if (bodyText.includes('O número de telefone compartilhado por url é inválido')) {
                    console.log('[WHL] ❌ Número inexistente detectado após navegação');
                    return false;
                }
            }
            
            return true;
        } catch (e) {
            console.error('[WHL] Erro ao abrir chat:', e);
            return false;
        }
    }

    /**
     * CORREÇÃO BUG 2: Envia IMAGEM para um número específico (não o chat aberto)
     * @param {string} phone - Número de destino
     * @param {string} base64Image - Imagem em base64
     * @param {string} caption - Legenda opcional
     */
    async function enviarImagemParaNumero(phone, base64Image, caption) {
        console.log('[WHL] 🖼️ Enviando IMAGEM para número:', phone);
        
        // PASSO 1: Abrir o chat do número correto
        const chatAberto = await abrirChatPorNumero(phone);
        if (!chatAberto) {
            console.error('[WHL] ❌ Não foi possível abrir chat para', phone);
            return { success: false, error: 'Número inexistente' };
        }
        
        // PASSO 2: Aguardar um pouco mais para garantir
        await new Promise(r => setTimeout(r, 500));
        
        // PASSO 3: Agora enviar a imagem (chat correto está aberto)
        return await enviarImagemDOM(base64Image, caption);
    }

    /**
     * Envia TEXTO + IMAGEM combinados
     */
    async function enviarMensagemCompleta(phone, texto, base64Image, caption) {
        console.log('[WHL] 🚀 Enviando mensagem completa para', phone);
        
        var results = { texto: null, imagem: null };
        
        // Enviar texto se houver
        if (texto) {
            results.texto = await enviarMensagemAPI(phone, texto);
            await new Promise(r => setTimeout(r, TIMEOUTS.MESSAGE_SEND_DELAY));
        }
        
        // Enviar imagem se houver
        if (base64Image) {
            results.imagem = await enviarImagemDOM(base64Image, caption);
        }
        
        return results;
    }

    /**
     * Aguarda confirmação visual de que a mensagem apareceu no chat
     * @param {string} mensagemEnviada - Texto da mensagem enviada
     * @param {number} timeout - Tempo máximo de espera em ms (padrão: 10000)
     * @returns {Promise<{success: boolean, confirmed: boolean, reason?: string}>}
     */
    async function aguardarConfirmacaoVisual(mensagemEnviada, timeout = 10000) {
        console.log('[WHL] ⏳ Aguardando confirmação visual no DOM...');
        
        const startTime = Date.now();
        const textoParaBuscar = mensagemEnviada.substring(0, 50); // Primeiros 50 chars
        const isImageOnly = mensagemEnviada === '[imagem]' || !mensagemEnviada || mensagemEnviada.trim().length === 0;
        
        while (Date.now() - startTime < timeout) {
            try {
                // Seletores para mensagens no chat (WA 2.3000.x + legados)
                const mensagensNoChat = document.querySelectorAll(
                    '[data-testid="msg-container"], ' +
                    '.message-out, ' +
                    '[class*="message-out"], ' +
                    '[data-testid="conversation-panel-messages"] [role="row"], ' +
                    '#main [role="row"]:has(div.message-out), ' +
                    '#main div[data-id^="true_"]'
                );
                
                for (const msgEl of mensagensNoChat) {
                    const texto = msgEl.textContent || '';
                    
                    // Se for imagem sem texto, procurar por elementos de mídia recentes
                    if (isImageOnly) {
                        const hasImage = msgEl.querySelector('img[src*="blob"], img[src*="data:image"], [data-testid="image-thumb"]');
                        if (hasImage) {
                            // Verificar se tem o tick de enviado
                            const ticks = msgEl.querySelector(
                                '[data-testid="msg-check"], ' +
                                '[data-testid="msg-dblcheck"], ' +
                                '[data-icon="msg-check"], ' +
                                '[data-icon="msg-dblcheck"], ' +
                                'span[data-icon="msg-time"]'
                            );
                            
                            if (ticks) {
                                console.log('[WHL] ✅ Confirmação visual: Imagem apareceu no chat com tick!');
                                return { success: true, confirmed: true };
                            }
                            
                            console.log('[WHL] 📝 Imagem encontrada, aguardando tick...');
                        }
                    } else {
                        // Verificar se a mensagem apareceu (comparar início do texto)
                        if (texto.includes(textoParaBuscar)) {
                            // Verificar se tem o tick de enviado (✓ ou ✓✓)
                            const ticks = msgEl.querySelector(
                                '[data-testid="msg-check"], ' +
                                '[data-testid="msg-dblcheck"], ' +
                                '[data-icon="msg-check"], ' +
                                '[data-icon="msg-dblcheck"], ' +
                                'span[data-icon="msg-time"]'
                            );
                            
                            if (ticks) {
                                console.log('[WHL] ✅ Confirmação visual: Mensagem apareceu no chat com tick!');
                                return { success: true, confirmed: true };
                            }
                            
                            // Se encontrou a mensagem mas sem tick ainda, aguardar mais um pouco
                            console.log('[WHL] 📝 Mensagem encontrada, aguardando tick...');
                        }
                    }
                }
            } catch (e) {
                console.warn('[WHL] Erro ao verificar confirmação visual:', e);
            }
            
            // Verificar a cada 500ms
            await new Promise(r => setTimeout(r, 500));
        }
        
        console.warn('[WHL] ⚠️ Timeout: Mensagem não confirmada visualmente após', timeout, 'ms');
        return { success: false, confirmed: false, reason: 'TIMEOUT' };
    }

    class Hook {
        constructor() { 
            this.is_registered = false; 
        }
        register() { 
            this.is_registered = true; 
        }
        unregister() { 
            this.is_registered = false; 
        }
    }

    const WA_MODULES = {
        PROCESS_EDIT_MESSAGE: 'WAWebDBProcessEditProtocolMsgs',
        PROCESS_RENDERABLE_MESSAGES: 'WAWebMessageProcessRenderable',
        MESSAGES_RENDERER: 'WAWebMessageMeta.react',
        PROTOBUF_HOOK: ['decodeProtobuf', 'WAWebProtobufdecode', 'WAWebProtobufUtils'],
        SEND_MESSAGE: 'WAWebSendMsgRecordAction',
        QUERY_GROUP: 'WAWebGroupMsgSendUtils',
        CHAT_COLLECTION: 'WAWebChatCollection',
        CONTACT_STORE: 'WAWebContactCollection',
        GROUP_METADATA: 'WAWebGroupMetadata',
        // Novos módulos para envio direto
        OPEN_CHAT: 'useWAWebSetModelValue',
        WID_FACTORY: 'WAWebWidFactory',
        // Módulos de mídia
        MEDIA_PREP: 'WAWebMediaPrep',
        MEDIA_UPLOAD: 'WAWebMediaUpload',
        MSG_MODELS: 'WAWebMsgModel',
    };

    let MODULES = {};

    // ===== RECOVER HISTORY TRACKING =====
    // CORREÇÃO BUG 4: Cache mais robusto de mensagens para recuperar conteúdo quando forem apagadas
    // Mantém as últimas 1000 mensagens em memória
    const messageCache = new Map(); // Map<messageId, {body, from, timestamp, type}>
    const MAX_CACHE_SIZE = 1000; // Aumentar para 1000
    
    // Array para armazenar histórico de mensagens recuperadas
    let historicoRecover = [];
    
    // Constants for recover history limits
    const MAX_STORAGE_MB = 5;
    const MAX_STORAGE_BYTES = MAX_STORAGE_MB * 1024 * 1024;
    const MAX_RECOVER_MESSAGES = 100; // Maximum number of messages to keep
    const FALLBACK_RECOVER_MESSAGES = 50; // Fallback when storage is full
    
    /**
     * CORREÇÃO BUG 4: Cachear mensagem recebida para poder recuperá-la se for apagada
     * ATUALIZADO: Agora também captura dados de mídia (stickers, imagens, etc)
     */
    function cachearMensagem(msg) {
        if (!msg) return;
        
        // Múltiplos IDs para cache
        const ids = [
            msg.id?.id,
            msg.id?._serialized,
            msg.id?.remote?._serialized + '_' + msg.id?.id
        ].filter(Boolean);
        
        const body = msg.body || msg.caption || msg.text || '';
        const from = msg.from?._serialized || msg.from?.user || msg.author?._serialized || msg.id?.remote?._serialized || '';
        
        // Capturar dados de mídia se disponível
        let mediaData = null;
        let mediaType = msg.type || 'chat';
        let mimetype = msg.mimetype || null;
        let filename = msg.filename || null;
        
        // Tentar extrair mídia base64 de MÚLTIPLAS fontes possíveis
        // Ordem de prioridade: mediaData -> mediaPreview -> thumbnailData -> body
        const possibleMediaSources = [
            msg.mediaData,
            msg.mediaPreview,
            msg.thumbnailData,
            msg.stickerData,
            msg.imageData,
            msg.mediaBlob,
            msg._data?.preview,
            msg._data?.body,
            msg.__x_mediaData,
            msg.__x_thumbnailData
        ];
        
        for (const source of possibleMediaSources) {
            if (source) {
                if (typeof source === 'string') {
                    // Verificar se é base64 válido
                    if (source.startsWith('/9j/') || source.startsWith('iVBOR') || 
                        source.startsWith('UklGR') || source.startsWith('R0lGOD') ||
                        source.startsWith('data:image')) {
                        mediaData = source;
                        break;
                    }
                } else if (source.preview || source.data) {
                    mediaData = source.preview || source.data;
                    break;
                }
            }
        }
        
        // Se for mídia e body contém dados base64
        if (!mediaData && msg.body && (msg.type === 'image' || msg.type === 'sticker' || msg.type === 'video' || msg.type === 'ptt' || msg.type === 'audio' || msg.type === 'document')) {
            if (msg.body.startsWith('/9j/') || msg.body.startsWith('iVBOR') || msg.body.startsWith('UklGR') || msg.body.startsWith('R0lGOD')) {
                mediaData = msg.body;
            }
        }
        
        // FIX PEND-MED-005: Mark media for potential download
        const hasMediaUrl = !!(msg.deprecatedMms3Url || msg.directPath || msg.url);
        const needsDownload = !mediaData && hasMediaUrl;

        if (needsDownload) {
            // Marcar que tem mídia mas dados não disponíveis localmente
            mediaData = '__HAS_MEDIA__';
        }

        if (!body && !from && !mediaData) return;

        const cacheData = {
            body: body,
            from: from,
            timestamp: Date.now(),
            type: mediaType,
            mimetype: mimetype,
            filename: filename,
            mediaData: mediaData, // NOVO: dados de mídia
            isMedia: ['image', 'sticker', 'video', 'ptt', 'audio', 'document'].includes(mediaType),
            // Dados extras para debug
            hasUrl: hasMediaUrl,
            // 🔧 FIX: Guardar dados de URL para re-download futuro (fallback quando __HAS_MEDIA__)
            directPath: msg.directPath || null,
            mediaKey: msg.mediaKey || null,
            mediaUrl: msg.deprecatedMms3Url || msg.url || null,
        };

        // Cachear com TODOS os IDs possíveis
        ids.forEach(id => {
            messageCache.set(id, cacheData);
        });

        // FIX PEND-MED-005: Proactive media download for critical types
        if (needsDownload) {
            const criticalMediaTypes = ['image', 'sticker', 'video', 'audio', 'ptt', 'document'];

            if (criticalMediaTypes.includes(mediaType) && window.Store?.DownloadManager?.downloadMedia) {
                // Attempt async download without blocking message processing
                setTimeout(async () => {
                    try {
                        const media = await window.Store.DownloadManager.downloadMedia(msg);
                        if (!media) return;

                        // 🔧 FIX CRÍTICO: DownloadManager retorna um Blob que NÃO é serializável em JSON.
                        // Converter para base64 Data URI antes de armazenar no cache/histórico.
                        let base64Media = null;
                        if (typeof media === 'string') {
                            base64Media = media; // já é string/base64
                        } else if (media instanceof Blob) {
                            base64Media = await new Promise((res, rej) => {
                                const reader = new FileReader();
                                reader.onload = () => res(reader.result); // "data:mime;base64,..."
                                reader.onerror = () => rej(new Error('FileReader error'));
                                reader.readAsDataURL(media);
                            });
                        }

                        if (!base64Media || base64Media.length < 50) return;

                        // Atualizar messageCache com base64 serializável
                        ids.forEach(id => {
                            const existing = messageCache.get(id);
                            if (existing) {
                                messageCache.set(id, {
                                    ...existing,
                                    mediaData: base64Media,
                                    mediaDownloadTime: Date.now()
                                });
                            }
                        });

                        // 🔧 FIX RACE CONDITION: Atualizar entradas do historicoRecover que foram
                        // gravadas como '__HAS_MEDIA__' antes do download terminar.
                        const idsSet = new Set(ids.map(String));
                        let histUpdated = false;
                        for (let i = 0; i < historicoRecover.length; i++) {
                            const h = historicoRecover[i];
                            const hId = String(h.id || '');
                            const hPid = String(h.protocolId || '');
                            if (idsSet.has(hId) || idsSet.has(hPid)) {
                                const currentMedia = h.mediaData;
                                const needsUpdate = !currentMedia ||
                                    currentMedia === '__HAS_MEDIA__' ||
                                    typeof currentMedia !== 'string' ||
                                    currentMedia.length < 50;
                                if (needsUpdate) {
                                    historicoRecover[i] = { ...h, mediaData: base64Media };
                                    histUpdated = true;
                                    console.log('[WHL Cache] ✅ historicoRecover atualizado com mídia real (race condition fix):', hId.substring(0, 12));
                                }
                            }
                        }

                        if (histUpdated) {
                            try {
                                localStorage.setItem('whl_recover_history', JSON.stringify(historicoRecover));
                                syncRecoverToExtension(historicoRecover);
                            } catch (_) {}
                        }

                        console.log('[WHL Cache] ✅ Proactive media cached as base64:', ids[0]?.substring(0, 8), `(${Math.round(base64Media.length / 1024)}KB)`);
                    } catch (e) {
                        console.warn('[WHL Cache] Proactive media download failed:', e?.message);
                    }
                }, 100); // Small delay to not block message rendering
            }
        }
        
        // Limitar tamanho do cache (reduzido para comportar mídia)
        if (messageCache.size > MAX_CACHE_SIZE) {
            const firstKey = messageCache.keys().next().value;
            messageCache.delete(firstKey);
        }
        
        const logInfo = mediaData && mediaData !== '__HAS_MEDIA__' 
            ? `[MÍDIA:${mediaType} - ${mediaData.substring(0,10)}...]` 
            : mediaData === '__HAS_MEDIA__' 
                ? `[MÍDIA:${mediaType} - URL]`
                : body.substring(0, 30);
        console.log('[WHL Cache] Mensagem cacheada:', logInfo, 'IDs:', ids.length);
        
        // NOVO: Notificar sobre mensagem recebida (não enviada por mim)
        const isFromMe = msg.id?.fromMe || msg.fromMe || false;
        if (!isFromMe && body && mediaType === 'chat') {
            try {
                const chatId = msg.id?.remote?._serialized || msg.from?._serialized || msg.chatId?._serialized || null;
                const senderName = msg.notifyName || msg.pushName || msg.senderName || null;
                
                window.postMessage({
                    type: 'WHL_MESSAGE_RECEIVED',
                    payload: {
                        chatId: chatId,
                        message: body,
                        sender: senderName,
                        senderId: from,
                        timestamp: Date.now(),
                        messageId: ids[0] || null
                    }
                }, window.location.origin);
                
                console.log('[WHL Cache] 📩 Notificação de mensagem recebida enviada');
            } catch (e) {
                console.warn('[WHL Cache] Falha ao notificar mensagem:', e);
            }
        }
    }
    
    /**
     * Detects message type based on content
     * @param {string} body - Message content
     * @param {string} originalType - Original message type
     * @returns {string} - Detected type ('image', 'video', 'audio', 'sticker', 'text')
     */
    function detectMessageType(body, originalType) {
        // Priorizar tipo original se for sticker
        if (originalType === 'sticker') return 'sticker';
        
        if (!body || typeof body !== 'string') return originalType || 'text';
        
        // Detect base64 images
        // JPEG starts with /9j/
        // PNG starts with iVBOR
        // WEBP starts with UklGR (stickers)
        // GIF starts with R0lGOD
        if (body.startsWith('/9j/') || body.startsWith('iVBOR')) {
            return 'image';
        }
        
        // Detect WEBP (stickers)
        if (body.startsWith('UklGR')) {
            return originalType === 'sticker' ? 'sticker' : 'image';
        }
        
        // Detect GIF
        if (body.startsWith('R0lGOD')) {
            return 'image';
        }
        
        // Detect data URLs
        if (body.startsWith('data:image/webp')) return originalType === 'sticker' ? 'sticker' : 'image';
        if (body.startsWith('data:image')) return 'image';
        if (body.startsWith('data:video')) return 'video';
        if (body.startsWith('data:audio')) return 'audio';
        
        // Keep original type if not detected
        return originalType || 'text';
    }
    
    /**
     * Checks if content is a base64 image
     * Helper function shared between hooks and UI rendering
     * @param {string} content - Content to check
     * @returns {boolean} - True if content is base64 image
     */
    function isBase64Image(content) {

// ─── END 01-init-debug.js ───

// ─── BEGIN 02-webpack-interceptor.js ───
/**
 * @file content/wpp-hooks-parts/02-webpack-interceptor.js
 * @description Slice 1501-3000 do wpp-hooks.js (refactor v9)
 * @lines 1500
 */

        if (!content || typeof content !== 'string') return false;
        return content.startsWith('/9j/') || 
               content.startsWith('iVBOR') || 
               content.startsWith('data:image');
    }
    
    /**
     * Converts base64 content to data URL
     * @param {string} content - Base64 content
     * @returns {string|null} - Data URL or null if not convertible
     */
    function toDataUrl(content) {
        if (!content || typeof content !== 'string') return null;
        
        // Already a data URL
        if (content.startsWith('data:')) return content;
        
        // JPEG base64
        if (content.startsWith('/9j/')) {
            return `data:image/jpeg;base64,${content}`;
        }
        
        // PNG base64
        if (content.startsWith('iVBOR')) {
            return `data:image/png;base64,${content}`;
        }
        
        return null;
    }
    
    // ============================================
    // BUG 3: DELETION TYPE DETECTION
    // ============================================
    
    /**
     * BUG 3: Detect type of deletion/revoke
     * 
     * @param {Object} msg - The message object
     * @param {Object} event - Optional event data with additional context
     * @returns {string} Type of deletion: 'revoked_by_sender', 'deleted_locally', 'deleted_by_admin', or 'unknown'
     */
    function detectDeletionType(msg, event) {
        try {
            // Check if it's a revoke from sender
            if (event?.type === 'revoke' || msg.isRevoked || msg.type === 'revoked') {
                return 'revoked_by_sender';
            }
            
            // Check if deleted from my own device
            if (event?.fromMe || msg.fromMe) {
                return 'deleted_locally';
            }
            
            // Try to detect owner
            const owner = getOwnerNumber();
            const from = extractPhoneNumber(msg.from || msg.author || msg.sender);
            
            if (owner && from === owner) {
                return 'deleted_locally';
            }
            
            // Check if deleted by admin in group (enhanced validation)
            if (msg.isGroup || msg.chat?.isGroup) {
                const author = extractPhoneNumber(msg.author || event?.author);
                const sender = extractPhoneNumber(msg.from || msg.sender);
                
                // Additional validation: check if this is a deletion event specifically
                // and if author has different permissions (is admin)
                if (author && sender && author !== sender) {
                    // Check if event is specifically a message deletion by admin
                    if (event?.type === 'admin_delete' || event?.subtype === 'admin_revoke') {
                        return 'deleted_by_admin';
                    }
                    
                    // Check if message has admin metadata
                    if (msg.adminDelete || event?.adminDelete) {
                        return 'deleted_by_admin';
                    }
                    
                    // If author is different but no admin indicator, treat as third-party delete
                    // This avoids false positives with forwarded messages
                    return 'unknown';
                }
            }
            
            return 'unknown';
        } catch (e) {
            console.warn('[WHL] detectDeletionType error:', e);
            return 'unknown';
        }
    }
    
    /**
     * BUG 3: Get actor who deleted/revoked the message
     */
    function getDeleteActor(msg, event) {
        try {
            const author = extractPhoneNumber(msg.author || event?.author || msg.from || msg.sender);
            return author || 'Desconhecido';
        } catch (e) {
            return 'Desconhecido';
        }
    }
    
    /**
     * BUG 3: Get notification text based on deletion type
     */
    function getNotificationText(deletionType) {
        const texts = {
            'revoked_by_sender': 'Mensagem apagada pelo remetente',
            'deleted_locally': 'Mensagem excluída localmente',
            'deleted_by_admin': 'Mensagem removida por administrador',
            'unknown': 'Mensagem deletada'
        };
        return texts[deletionType] || texts.unknown;
    }
    
    /**
     * BUG 3: Get owner number (current user)
     */
    function getOwnerNumber() {
        try {
            // Try Store.Conn
            if (window.Store?.Conn?.me?._serialized) {
                return cleanPhoneNumber(window.Store.Conn.me._serialized);
            }
            
            if (window.Store?.Conn?.wid?._serialized) {
                return cleanPhoneNumber(window.Store.Conn.wid._serialized);
            }
            
            // Try localStorage
            const storedWid = localStorage.getItem('last-wid-md') || localStorage.getItem('last-wid');
            if (storedWid) {
                try {
                    const parsed = JSON.parse(storedWid);
                    const num = cleanPhoneNumber(parsed._serialized || parsed);
                    if (/^\d{8,15}$/.test(num)) {
                        return num;
                    }
                } catch (e) {}
            }
            
            return null;
        } catch (e) {
            return null;
        }
    }
    
    /**
     * BUG 3: Clean phone number helper
     */
    function cleanPhoneNumber(phone) {
        if (!phone || typeof phone !== 'string') return '';
        return phone.replace(WHATSAPP_SUFFIXES_REGEX, '').replace(/\D/g, '');
    }
    
    /**
     * CORREÇÃO 1.2 + BUG 2 + BUG 3: Salvar mensagem apagada com notificação persistente e tipo de deleção
     */
    function salvarMensagemApagada(msg) {
        let from = extractPhoneNumber(msg);
        const to = extractPhoneNumber({ to: msg.to || msg.chatId || msg.id?.remote });
        const body = msg.body || '[mensagem sem texto]';
        const chatId = (msg.id?.remote?._serialized || msg.chatId?._serialized || msg.chatId || msg.id?.remote || null);
        
        // BUG 3: Detect deletion type
        const deletionType = detectDeletionType(msg);
        
        // PrivacyShield+: Detectar tipo de dispositivo remetente
        const _participant = msg.author?._serialized || msg.from?._serialized || msg.id?.remote?._serialized || '';
        const _senderIsPhone = _participant.includes(':0@') || !_participant.includes(':');
        const _deviceType = _senderIsPhone ? 'phone' : 'computer';

        const entrada = {
            id: msg.id?.id || Date.now().toString(),
            chatId: chatId,
            from,
            to,
            body,
            type: detectMessageType(body, msg.type),
            action: 'deleted',
            mediaType: msg.type,
            mediaData: null,
            deviceType: _deviceType,
            deviceIcon: _senderIsPhone ? '📱' : '💻',
            timestamp: Date.now(),
            // BUG 3: Add deletion type info
            deletionType: deletionType,
            deletionInfo: {
                type: deletionType,
                actor: getDeleteActor(msg),
                timestamp: Date.now()
            },
            // BUG 2: Add persistent notification
            notification: {
                type: 'deleted',
                text: getNotificationText(deletionType),
                timestamp: Date.now(),
                persistent: true  // BUG 2: Flag to keep visible always
            }
        };
        
        // PHASE 2: Usar novo sistema de versões via RecoverAdvanced
        if (window.RecoverAdvanced?.registerMessageEvent) {
            window.RecoverAdvanced.registerMessageEvent(
                entrada,
                window.RecoverAdvanced.MESSAGE_STATES.DELETED_LOCAL,
                'wpp_hooks_delete'
            );
        }
        
        historicoRecover.push(entrada);
        
        // Aplicar limites
        let currentSize = new Blob([JSON.stringify(historicoRecover)]).size;
        
        while (currentSize > MAX_STORAGE_BYTES && historicoRecover.length > 10) {
            historicoRecover.shift();
            currentSize = new Blob([JSON.stringify(historicoRecover)]).size;
        }
        
        if (historicoRecover.length > MAX_RECOVER_MESSAGES) {
            historicoRecover.splice(0, historicoRecover.length - MAX_RECOVER_MESSAGES);
        }
        
        // Salvar no localStorage
        try {
            const dataToSave = JSON.stringify(historicoRecover);
            localStorage.setItem('whl_recover_history', dataToSave);
            syncRecoverToExtension(historicoRecover);
        } catch(e) {
            console.error('[WHL Recover] Erro ao salvar mensagem apagada:', e);
        }
        
        // Notificar UI
        window.postMessage({
            type: 'WHL_RECOVER_NEW_MESSAGE',
            payload: {
                ...entrada,
                action: 'deleted'
            },
            message: entrada,
            total: historicoRecover.length
        }, window.location.origin);
        
        // CORREÇÃO 5.2: Enviar para background para broadcast
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                    type: 'WHL_RECOVER_NEW_MESSAGE',
                    payload: entrada
                });
            }
        } catch (e) {
            // Ignorar erros de contexto
        }
        
        console.log(`[WHL Recover] 🗑️ Mensagem apagada (${deletionType}) de ${entrada.from}: ${entrada.body.substring(0, 50)}...`);
    }

    /**
     * Bug fix + BUG 2: Save edited message to history with persistent notification
     */
    function salvarMensagemEditada(message) {
        const messageContent = message?.body || message?.caption || '[sem conteúdo]';
        let from = extractPhoneNumber(message);
        
        if (!from || from === 'Desconhecido') from = 'Número desconhecido';
        
        // CORREÇÃO 3: Recuperar previousContent do cache (usar ID original quando existir)
        const originalId = message.protocolMessageKey?.id || message.quotedStanzaID || message.id?.id || Date.now().toString();
        const protocolId = message.id?.id || message.id?._serialized || null;
        const chatId = (message.id?.remote?._serialized || message.chatId?._serialized || message.chatId || message.id?.remote || null);

        const originalCached = messageCache.get(originalId) || messageCache.get(message.id?.id);
        const previousContent = message.previousBody || originalCached?.body || null;
        
        const entrada = {
            id: originalId,
            protocolId: protocolId,
            chatId: chatId,
            from: from,
            to: extractPhoneNumber({ to: message.to || message.chatId || message.id?.remote }),
            body: messageContent,
            type: 'chat',
            action: 'edited',
            previousContent: previousContent,
            previousBody: previousContent, // PHASE 2: Add for compatibility
            timestamp: Date.now(),
            // BUG 3: Add deletion type info (for consistency)
            deletionType: 'edited',
            deletionInfo: {
                type: 'edited',
                actor: from,
                timestamp: Date.now(),
                original: previousContent,
                edited: messageContent
            },
            // BUG 2: Add persistent notification
            notification: {
                type: 'edited',
                text: 'Mensagem editada',
                timestamp: Date.now(),
                persistent: true  // BUG 2: Flag to keep visible always
            }
        };
        
        console.log('[WHL Recover] ✏️ Salvando mensagem editada:', entrada);
        
        // PHASE 2: Usar novo sistema de versões via RecoverAdvanced
        if (window.RecoverAdvanced?.registerMessageEvent) {
            window.RecoverAdvanced.registerMessageEvent(
                entrada,
                window.RecoverAdvanced.MESSAGE_STATES.EDITED,
                'wpp_hooks_edit'
            );
        }
        
        historicoRecover.push(entrada);
        
        // Item 4: Limit Recover localStorage storage
        let currentSize = new Blob([JSON.stringify(historicoRecover)]).size;
        
        while (currentSize > MAX_STORAGE_BYTES && historicoRecover.length > 10) {
            historicoRecover.shift();
            currentSize = new Blob([JSON.stringify(historicoRecover)]).size;
        }
        
        if (historicoRecover.length > MAX_RECOVER_MESSAGES) {
            historicoRecover = historicoRecover.slice(-MAX_RECOVER_MESSAGES);
        }
        
        // Salvar no localStorage
        try {
            const dataToSave = JSON.stringify(historicoRecover);
            const sizeKB = (new Blob([dataToSave]).size / 1024).toFixed(2);
            localStorage.setItem('whl_recover_history', dataToSave);
            syncRecoverToExtension(historicoRecover);
            console.log(`[WHL Recover] Histórico salvo: ${historicoRecover.length} mensagens, ${sizeKB}KB`);
        } catch(e) {
            console.error('[WHL Recover] Erro ao salvar (limite excedido?)', e);
            historicoRecover = historicoRecover.slice(-FALLBACK_RECOVER_MESSAGES);
            try {
                localStorage.setItem('whl_recover_history', JSON.stringify(historicoRecover));
                syncRecoverToExtension(historicoRecover);
            } catch(e2) {
                console.error('[WHL Recover] Falha crítica ao salvar histórico', e2);
            }
        }
        
        // CORREÇÃO 1.4: Manter apenas um postMessage com action correto
        window.postMessage({
            type: 'WHL_RECOVER_NEW_MESSAGE',
            payload: {
                ...entrada,
                action: 'edited'
            },
            message: entrada,
            total: historicoRecover.length
        }, window.location.origin);
        
        // CORREÇÃO 5.2: Enviar para background para broadcast
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                    type: 'WHL_RECOVER_NEW_MESSAGE',
                    payload: entrada
                });
            }
        } catch (e) {
            // Ignorar erros de contexto
        }
        
        console.log(`[WHL Recover] Mensagem editada de ${entrada.from}: ${entrada.body.substring(0, 50)}...`);
    }

    function salvarMensagemRecuperada(msg) {
        // CORREÇÃO BUG 4: Tentar múltiplas fontes para o body
        let body = msg.body || msg.caption || msg.text || '';
        let from = extractPhoneNumber(msg);
        let mediaData = null;
        let mediaType = msg.type || 'chat';
        let mimetype = msg.mimetype || null;
        let filename = msg.filename || null;
        
        // Se body estiver vazio ou for mídia, TENTAR RECUPERAR DO CACHE
        const possibleIds = [
            msg.protocolMessageKey?.id,
            msg.id?.id,
            msg.id?._serialized,
            msg.quotedStanzaID,
            msg.id?.remote?._serialized + '_' + msg.protocolMessageKey?.id
        ].filter(Boolean);
        
        let cachedDirectPath = null;
        let cachedMediaKey = null;
        let cachedMediaUrl = null;

        for (const id of possibleIds) {
            const cached = messageCache.get(id);
            if (cached) {
                // Recuperar body se vazio
                if (!body && cached.body) {
                    body = cached.body;
                }
                // Se from não foi encontrado, tentar recuperar do cache
                if ((!from || from === 'Desconhecido') && cached.from) {
                    from = extractPhoneNumber({ from: { _serialized: cached.from } });
                }
                // NOVO: Recuperar dados de mídia — validar que é uma string base64 real
                if (cached.mediaData &&
                    cached.mediaData !== '__HAS_MEDIA__' &&
                    typeof cached.mediaData === 'string' &&
                    cached.mediaData.length > 50) {
                    mediaData = cached.mediaData;
                }
                if (cached.type) {
                    mediaType = cached.type;
                }
                if (cached.mimetype) {
                    mimetype = cached.mimetype;
                }
                if (cached.filename) {
                    filename = cached.filename;
                }
                // 🔧 FIX: Guardar URL info para fallback de re-download
                if (cached.directPath) cachedDirectPath = cached.directPath;
                if (cached.mediaKey) cachedMediaKey = cached.mediaKey;
                if (cached.mediaUrl) cachedMediaUrl = cached.mediaUrl;
                if (body || mediaData) {
                    console.log('[WHL Recover] ✅ Conteúdo recuperado do cache:', mediaData ? `[MÍDIA:${mediaType} ${Math.round(mediaData.length/1024)}KB]` : body.substring(0, 50));
                    break;
                }
            }
        }
        
        // Validar resultados
        if (!body && !mediaData) body = '[Mensagem sem texto - mídia ou sticker]';
        if (!from || from === 'Desconhecido') from = 'Número desconhecido';
        
        // BUG 3: Detect deletion type (revoked)
        const deletionType = 'revoked_by_sender'; // Always revoked for this function
        const originalId = msg.protocolMessageKey?.id || msg.quotedStanzaID || msg.id?.id || Date.now().toString();
        const protocolId = msg.id?.id || msg.id?._serialized || null;
        const chatId = (msg.id?.remote?._serialized || msg.chatId?._serialized || msg.chatId || msg.id?.remote || null);

        // PrivacyShield+: Detectar tipo de dispositivo remetente (telefone vs computador)
        // Baseado na lógica do WAIncognito: participante sem ':N' é telefone
        const participant = msg.author?._serialized || msg.from?._serialized || msg.id?.remote?._serialized || '';
        const senderIsPhone = participant.includes(':0@') || !participant.includes(':');
        const deviceType = senderIsPhone ? 'phone' : 'computer';
        const deviceIcon = senderIsPhone ? '📱' : '💻';

        const entrada = {
            id: originalId,
            protocolId: protocolId,
            chatId: chatId,
            from: from,
            to: extractPhoneNumber({ to: msg.to || msg.chatId || msg.id?.remote }), // v7.5.0: Destinatário
            body: body,
            type: detectMessageType(body, mediaType),
            action: 'revoked', // v7.5.0: Tipo de ação
            mediaType: mediaType,
            mediaData: mediaData,
            mimetype: mimetype,
            filename: filename,
            // 🔧 FIX: Guardar URL para re-download quando mediaData não disponível
            directPath: cachedDirectPath || msg.directPath || null,
            mediaKey: cachedMediaKey || msg.mediaKey || null,
            mediaUrl: cachedMediaUrl || msg.deprecatedMms3Url || msg.url || null,
            timestamp: Date.now(),
            // PrivacyShield+: Informações de dispositivo remetente
            deviceType: deviceType,
            deviceIcon: deviceIcon,
            // BUG 3: Add deletion type info
            deletionType: deletionType,
            deletionInfo: {
                type: deletionType,
                actor: from,
                timestamp: Date.now()
            },
            // BUG 2: Add persistent notification
            notification: {
                type: 'revoked',
                text: 'Mensagem apagada pelo remetente',
                timestamp: Date.now(),
                persistent: true  // BUG 2: Flag to keep visible always
            }
        };
        
        console.log('[WHL Recover] 📝 Salvando mensagem revogada:', entrada.mediaData ? `[MÍDIA:${entrada.mediaType}]` : entrada.body?.substring(0, 30));
        
        // PHASE 2: Usar novo sistema de versões via RecoverAdvanced
        if (window.RecoverAdvanced?.registerMessageEvent) {
            window.RecoverAdvanced.registerMessageEvent(
                entrada,
                window.RecoverAdvanced.MESSAGE_STATES.REVOKED_GLOBAL,
                'wpp_hooks_revoke'
            );
        }
        
        historicoRecover.push(entrada);
        
        // Item 4: Limit Recover localStorage storage
        // Calculate approximate size and limit storage
        let currentSize = new Blob([JSON.stringify(historicoRecover)]).size;
        
        // Keep trimming until under size limit
        while (currentSize > MAX_STORAGE_BYTES && historicoRecover.length > 10) {
            historicoRecover.shift(); // Remove oldest messages
            currentSize = new Blob([JSON.stringify(historicoRecover)]).size;
        }
        
        // Also limit by count (max messages as fallback)
        if (historicoRecover.length > MAX_RECOVER_MESSAGES) {
            historicoRecover = historicoRecover.slice(-MAX_RECOVER_MESSAGES);
        }
        
        // Salvar no localStorage
        try {
            const dataToSave = JSON.stringify(historicoRecover);
            const sizeKB = (new Blob([dataToSave]).size / 1024).toFixed(2);
            localStorage.setItem('whl_recover_history', dataToSave);
            console.log(`[WHL Recover] Histórico salvo: ${historicoRecover.length} mensagens, ${sizeKB}KB`);
        } catch(e) {
            console.error('[WHL Recover] Erro ao salvar (limite excedido?)', e);
            // If storage fails, remove oldest half and retry
            historicoRecover = historicoRecover.slice(-FALLBACK_RECOVER_MESSAGES);
            try {
                localStorage.setItem('whl_recover_history', JSON.stringify(historicoRecover));
                syncRecoverToExtension(historicoRecover);
            } catch(e2) {
                console.error('[WHL Recover] Falha crítica ao salvar histórico', e2);
            }
        }
        
        // Notificar UI
        // v7.5.0: Emitir evento compatível com RecoverAdvanced
        window.postMessage({
            type: 'WHL_RECOVER_NEW_MESSAGE',
            payload: {
                ...entrada,
                action: 'revoked'  // Default para mensagens revogadas
            },
            message: entrada,
            total: historicoRecover.length
        }, window.location.origin);
        
        // CORREÇÃO 5.2: Enviar para background para broadcast
        try {
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage({
                    type: 'WHL_RECOVER_NEW_MESSAGE',
                    payload: entrada
                });
            }
        } catch (e) {
            // Ignorar erros de contexto
        }
        
        console.log(`[WHL Recover] Mensagem recuperada de ${entrada.from}: ${entrada.body.substring(0, 50)}...`);
    }

    // BUG FIX 3: Enhanced module detection with multiple fallback methods
    function tryRequireModule(moduleNames) {
        const names = Array.isArray(moduleNames) ? moduleNames : [moduleNames];
        
        for (const name of names) {
            try {
                // Method 1: Direct require
                if (typeof require === 'function') {
                    const mod = require(name);
                    if (mod) return mod;
                }
            } catch (e) {}
            
            try {
                // Method 2: Via window.require
                if (typeof window.require === 'function') {
                    const mod = window.require(name);
                    if (mod) return mod;
                }
            } catch (e) {}
            
            try {
                // Method 3: Via Store global
                if (window.Store) {
                    // Try common Store paths
                    const paths = ['Msg', 'Chat', 'Contact', 'MediaPrep', 'MediaUpload'];
                    for (const path of paths) {
                        if (window.Store[path]) return { [path]: window.Store[path] };
                    }
                }
            } catch (e) {}
            
            try {
                // Method 4: Via webpack chunks (WhatsApp Web 2024/2025)
                const webpackChunks = window.webpackChunkwhatsapp_web_client || 
                                     window.webpackChunkbuild || 
                                     window.webpackChunkwhatsapp_web;
                if (webpackChunks && webpackChunks.push) {
                    // Tentar encontrar módulo via webpack
                    let foundModule = null;
                    webpackChunks.push([['whl_finder'], {}, (req) => {
                        try {
                            const cache = req.c || req.m;
                            if (cache) {
                                for (const key of Object.keys(cache)) {
                                    const mod = cache[key];
                                    if (mod && mod.exports) {
                                        const exports = mod.exports;
                                        // Verificar se é o módulo que procuramos
                                        if (exports[name] || exports.default?.[name]) {
                                            foundModule = exports[name] || exports.default?.[name];
                                            break;
                                        }
                                    }
                                }
                            }
                        } catch (e) {}
                    }]);
                    if (foundModule) return foundModule;
                }
            } catch (e) {}
        }
        
        return null;
    }

    // ===== HOOK PARA MENSAGENS APAGADAS =====
    class RenderableMessageHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();
            
            if (!MODULES.PROCESS_RENDERABLE_MESSAGES) {
                console.warn('[WHL Hooks] PROCESS_RENDERABLE_MESSAGES module not available');
                return;
            }
            
            this.original_function = MODULES.PROCESS_RENDERABLE_MESSAGES.processRenderableMessages;
            
            MODULES.PROCESS_RENDERABLE_MESSAGES.processRenderableMessages = function (...args) {
                args[0] = args[0].filter((message) => !RenderableMessageHook.handle_message(message));
                return RenderableMessageHook.originalProcess(...args);
            };
            
            RenderableMessageHook.originalProcess = this.original_function;
            console.log('[WHL Hooks] RenderableMessageHook registered');
        }
        
        static handle_message(message) {
            // CORREÇÃO ISSUE 05: Cachear todas as mensagens antes de processar
            // Isso permite recuperar o conteúdo quando a mensagem for apagada
            cachearMensagem(message);
            
            return RenderableMessageHook.revoke_handler(message);
        }
        
        static async attemptGracePeriodMediaDownload(message) {
            // FIX PEND-MED-005: Grace period media download
            // When a message is revoked, media may still be accessible for a few seconds
            // Attempt to download it before WhatsApp servers delete it

            const originalId = message.protocolMessageKey?.id;
            if (!originalId) return;

            // Check if we have the original message cached
            const cached = messageCache.get(originalId);
            if (!cached || cached.mediaData === '__HAS_MEDIA__') {
                // Media URL exists but data not downloaded
                console.log('[WHL Hooks] 📥 Attempting grace period media download for:', originalId);

                try {
                    // Use RecoverAdvanced's download methods if available
                    if (window.RecoverAdvanced?.downloadMediaActive) {
                        const result = await window.RecoverAdvanced.downloadMediaActive(message);
                        if (result?.success && result?.data) {
                            // Update cache with actual media data
                            messageCache.set(originalId, {
                                ...cached,
                                mediaData: result.data,
                                mediaDownloadTime: Date.now()
                            });
                            console.log('[WHL Hooks] ✅ Grace period download successful:', result.method);
                            return true;
                        }
                    } else if (window.Store?.DownloadManager?.downloadMedia) {
                        // Fallback: Direct Store download
                        const media = await window.Store.DownloadManager.downloadMedia(message);
                        if (media) {
                            messageCache.set(originalId, {
                                ...cached,
                                mediaData: media,
                                mediaDownloadTime: Date.now()
                            });
                            console.log('[WHL Hooks] ✅ Grace period download successful: store');
                            return true;
                        }
                    }
                } catch (e) {
                    console.warn('[WHL Hooks] ⚠️ Grace period download failed:', e.message);
                }
            }
            return false;
        }

        static revoke_handler(message) {
            const REVOKE_SUBTYPES = ['sender_revoke', 'admin_revoke'];
            if (!REVOKE_SUBTYPES.includes(message?.subtype)) return false;

            // Check if protocolMessageKey exists before accessing
            if (!message.protocolMessageKey) {
                console.warn('[WHL Hooks] protocolMessageKey not found in revoked message');
                return false;
            }

            // FIX PEND-MED-005: Attempt immediate media download
            RenderableMessageHook.attemptGracePeriodMediaDownload(message)
                .catch(e => console.warn('[WHL Hooks] Grace period download error:', e));

            // Salvar mensagem recuperada ANTES de transformar
            salvarMensagemRecuperada(message);
            
            // Notificar via postMessage para UI
            try {
                window.postMessage({
                    type: 'WHL_RECOVERED_MESSAGE',
                    payload: {
                        chatId: message?.id?.remote || message?.from?._serialized || null,
                        from: message?.author?._serialized || message?.from?._serialized || null,
                        ts: Date.now(),
                        kind: 'revoked',
                        preview: message?.body || '🚫 Esta mensagem foi excluída!'
                    }
                }, window.location.origin);
            } catch (e) {
                console.warn('[WHL Hooks] recover postMessage failed', e);
            }
            
            // Transformar mensagem apagada em mensagem visível
            message.type = 'chat';
            message.body = '🚫 Esta mensagem foi excluída!';
            message.quotedStanzaID = message.protocolMessageKey.id;
            message.quotedParticipant = message.protocolMessageKey?.participant || message.from;
            message.quotedMsg = { type: 'chat' };
            delete message.protocolMessageKey;
            delete message.subtype;
            
            return false; // Não filtrar, manter a mensagem
        }
    }

    // ===== HOOK PARA MENSAGENS EDITADAS =====
    class EditMessageHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();
            
            if (!MODULES.PROCESS_EDIT_MESSAGE) {
                console.warn('[WHL Hooks] PROCESS_EDIT_MESSAGE module not available');
                return;
            }
            
            this.original_function = MODULES.PROCESS_EDIT_MESSAGE.processEditProtocolMsgs;
            
            MODULES.PROCESS_EDIT_MESSAGE.processEditProtocolMsgs = function (...args) {
                args[0] = args[0].filter((message) => {
                    return !EditMessageHook.handle_edited_message(message, ...args);
                });
                return EditMessageHook.originalEdit(...args);
            };
            
            MODULES.PROCESS_EDIT_MESSAGE.processEditProtocolMsg = MODULES.PROCESS_EDIT_MESSAGE.processEditProtocolMsgs;
            EditMessageHook.originalEdit = this.original_function;
            console.log('[WHL Hooks] EditMessageHook registered');
        }
        
        static handle_edited_message(message, arg1, arg2) {
            // CORREÇÃO ISSUE 05: Salvar mensagem editada no histórico ANTES de modificar
            salvarMensagemEditada(message);
            
            // Extract message content - body for text, caption for media
            const messageContent = message?.body || message?.caption || '[sem conteúdo]';
            message.type = 'chat';
            message.body = `✏️ Esta mensagem foi editada para: ${messageContent}`;
            
            if (!message.protocolMessageKey) return true;
            
            message.quotedStanzaID = message.protocolMessageKey.id;
            message.quotedParticipant = message.protocolMessageKey?.participant || message.from;
            message.quotedMsg = { type: 'chat' };
            delete message.latestEditMsgKey;
            delete message.protocolMessageKey;
            delete message.subtype;
            delete message.editMsgType;
            delete message.latestEditSenderTimestampMs;
            
            // Processar mensagem editada como nova mensagem
            if (MODULES.PROCESS_RENDERABLE_MESSAGES) {
                MODULES.PROCESS_RENDERABLE_MESSAGES.processRenderableMessages(
                    [message],
                    { 
                        author: message.from, 
                        type: 'chat', 
                        externalId: message.id.id, 
                        edit: -1, 
                        isHsm: false, 
                        chat: message.id.remote 
                    },
                    null,
                    { verifiedLevel: 'unknown' },
                    null,
                    0,
                    arg2 === undefined ? arg1 : arg2
                );
            }
            
            return true; // Filtrar a mensagem original de edição
        }
    }

    // ===== CORREÇÃO 1.1: HOOK PARA MENSAGENS DELETADAS LOCALMENTE =====
    class DeletedMessageHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();
            
            // Tentar múltiplos módulos possíveis
            const storeMod = tryRequireModule('WAWebMsgCollection') || tryRequireModule('WAWebMsgModel');
            
            if (!storeMod || !storeMod.Msg) {
                console.warn('[WHL Hooks] Msg store not available for delete hook');
                return;
            }
            
            try {
                // Hook no evento 'remove' da coleção de mensagens
                storeMod.Msg.on('remove', (msg) => {
                    DeletedMessageHook.handle_deleted_message(msg);
                });
                
                console.log('[WHL Hooks] DeletedMessageHook registered on Msg.on("remove")');
            } catch (e) {
                console.warn('[WHL Hooks] Failed to register delete hook:', e);
            }
        }
        
        static handle_deleted_message(message) {
            if (!message) return;
            
            // Salvar mensagem apagada no histórico
            salvarMensagemApagada(message);
            
            // Notificar via postMessage para UI
            try {
                window.postMessage({
                    type: 'WHL_MESSAGE_DELETED',
                    payload: {
                        chatId: message?.id?.remote || message?.from?._serialized || null,
                        from: message?.author?._serialized || message?.from?._serialized || null,
                        ts: Date.now(),
                        kind: 'deleted',
                        preview: message?.body || '[mensagem apagada]'
                    }
                }, window.location.origin);
            } catch (e) {
                console.warn('[WHL Hooks] delete postMessage failed', e);
            }
        }
    }

    // ===== FASE 3.1: HOOK PARA CRIAÇÃO DE MENSAGENS =====
    class MessageCreatedHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();
            
            const storeMod = tryRequireModule('WAWebMsgCollection') || tryRequireModule('WAWebMsgModel');
            
            if (!storeMod || !storeMod.Msg) {
                console.warn('[WHL Hooks] Msg store not available for add hook');
                return;
            }
            
            try {
                storeMod.Msg.on('add', (msg) => {
                    MessageCreatedHook.handle_created_message(msg);
                });
                
                console.log('[WHL Hooks] MessageCreatedHook registered on Msg.on("add")');
            } catch (e) {
                console.warn('[WHL Hooks] Failed to register add hook:', e);
            }
        }
        
        static handle_created_message(message) {
            if (!message) return;
            
            // Cache the message
            cacheMessage(message);
            
            // Notify RecoverAdvanced via postMessage
            notifyRecoverUI({
                type: 'WHL_MESSAGE_CREATED',
                payload: {
                    id: message?.id?.id || message?.id?._serialized || Date.now().toString(),
                    chatId: message?.id?.remote || message?.from?._serialized || null,
                    from: message?.author?._serialized || message?.from?._serialized || null,
                    to: message?.to?._serialized || message?.id?.remote || null,
                    body: message?.body || message?.caption || '',
                    type: message?.type || 'chat',
                    mediaType: message?.mimetype || null,
                    timestamp: message?.t || Date.now(),
                    state: 'created',
                    origin: 'msg_add_hook'
                }
            });
        }
    }

    // ===== FASE 3.3: HOOK PARA FALHA DE ENVIO (ACK) =====
    class MessageFailedHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();
            
            const storeMod = tryRequireModule('WAWebMsgCollection') || tryRequireModule('WAWebMsgModel');
            
            if (!storeMod || !storeMod.Msg) {
                console.warn('[WHL Hooks] Msg store not available for ack hook');
                return;
            }
            
            try {
                storeMod.Msg.on('change:ack', (msg, ack) => {
                    MessageFailedHook.handle_ack_change(msg, ack);
                });
                
                console.log('[WHL Hooks] MessageFailedHook registered on Msg.on("change:ack")');
            } catch (e) {
                console.warn('[WHL Hooks] Failed to register ack hook:', e);
            }
        }
        
        static handle_ack_change(message, ack) {
            if (!message) return;
            
            // ACK -1 = failed to send
            if (ack === -1 || ack === '-1') {
                notifyRecoverUI({
                    type: 'WHL_MESSAGE_FAILED',
                    payload: {
                        id: message?.id?.id || message?.id?._serialized || Date.now().toString(),
                        chatId: message?.id?.remote || message?.from?._serialized || null,
                        from: message?.author?._serialized || message?.from?._serialized || null,
                        to: message?.to?._serialized || message?.id?.remote || null,
                        body: message?.body || message?.caption || '',
                        type: message?.type || 'chat',
                        timestamp: message?.t || Date.now(),
                        state: 'failed',
                        ack: ack,
                        origin: 'ack_change_hook'
                    }
                });
            }
        }
    }

    // ===== FASE 3.4: HOOK PARA STATUS (HISTÓRIAS) =====
    class StatusHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();
            
            const statusMod = tryRequireModule('WAWebStatusCollection') || tryRequireModule('WAWebStatusStore');
            
            if (statusMod && statusMod.StatusStore) {
                try {
                    statusMod.StatusStore.on('add', (status) => {
                        StatusHook.handle_status_published(status);
                    });
                    
                    statusMod.StatusStore.on('remove', (status) => {
                        StatusHook.handle_status_deleted(status);
                    });
                    
                    console.log('[WHL Hooks] StatusHook registered on StatusStore');
                } catch (e) {
                    console.warn('[WHL Hooks] Failed to register status hook:', e);
                }
            } else {
                console.warn('[WHL Hooks] StatusStore not available, skipping status hooks');
            }
        }
        
        static handle_status_published(status) {
            if (!status) return;
            
            notifyRecoverUI({
                type: 'WHL_STATUS_PUBLISHED',
                payload: {
                    id: status?.id?.id || Date.now().toString(),
                    from: status?.from?._serialized || status?.author?._serialized || null,
                    body: status?.body || status?.caption || '[Status]',
                    type: 'status',
                    mediaType: status?.mimetype || null,
                    timestamp: status?.t || Date.now(),
                    state: 'status_published',
                    origin: 'status_add_hook'
                }
            });
        }
        
        static handle_status_deleted(status) {
            if (!status) return;
            
            notifyRecoverUI({
                type: 'WHL_STATUS_DELETED',
                payload: {
                    id: status?.id?.id || Date.now().toString(),
                    from: status?.from?._serialized || status?.author?._serialized || null,
                    body: status?.body || status?.caption || '[Status deletado]',
                    type: 'status',
                    timestamp: Date.now(),
                    state: 'status_deleted',
                    origin: 'status_remove_hook'
                }
            });
        }
    }

    // ===== FASE 3.5: NOTIFICAR RECOVER UI =====
    function notifyRecoverUI(data) {
        try {
            // 1. postMessage para content scripts
            window.postMessage(data, window.location.origin);
            
            // 2. chrome.runtime para sidepanel/background
            if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
                chrome.runtime.sendMessage(data).catch((error) => {
                    // Log different error types for debugging
                    const errorMsg = error?.message || String(error);
                    if (errorMsg.includes('Receiving end does not exist')) {
                        // Expected when no listener is registered - can be ignored
                        console.debug('[WHL Hooks] No receiver for runtime message (expected)');
                    } else if (errorMsg.includes('The message port closed')) {
                        console.warn('[WHL Hooks] Message port closed - listener may have disconnected');
                    } else {
                        // Unexpected error - log for debugging
                        console.warn('[WHL Hooks] Unexpected runtime.sendMessage error:', errorMsg);
                    }
                });
            }
            
            // 3. EventBus (se disponível)
            if (window.EventBus && typeof window.EventBus.emit === 'function') {
                window.EventBus.emit('recover:new_message', data.payload);
            }
            
            // 4. RecoverAdvanced direto (se disponível)
            if (window.RecoverAdvanced && typeof window.RecoverAdvanced.addMessage === 'function') {
                window.RecoverAdvanced.addMessage(data.payload);
            }
        } catch (e) {
            console.warn('[WHL Hooks] notifyRecoverUI failed:', e);
        }
    }

    // ===== FASE 4.1: SNAPSHOT INICIAL =====
    async function performInitialSnapshot() {
        console.log('[WHL Hooks] Starting initial snapshot...');
        
        try {
            const ChatMod = tryRequireModule('WAWebChatCollection');
            if (!ChatMod || !ChatMod.ChatCollection) {
                throw new Error('ChatCollection not available');
            }
            
            const chats = ChatMod.ChatCollection.getModelsArray() || [];
            let totalMessages = 0;
            const seenIds = new Set();
            
            for (const chat of chats) {
                if (!chat.msgs || typeof chat.msgs.getModelsArray !== 'function') continue;
                
                const messages = chat.msgs.getModelsArray() || [];
                
                for (const msg of messages) {
                    const msgId = msg?.id?.id || msg?.id?._serialized;
                    if (!msgId || seenIds.has(msgId)) continue;
                    
                    seenIds.add(msgId);
                    totalMessages++;
                    
                    // Register as snapshot_initial
                    notifyRecoverUI({
                        type: 'WHL_MESSAGE_SNAPSHOT',
                        payload: {
                            id: msgId,
                            chatId: chat?.id?._serialized || null,
                            from: msg?.author?._serialized || msg?.from?._serialized || null,
                            to: msg?.to?._serialized || chat?.id?._serialized || null,
                            body: msg?.body || msg?.caption || '',
                            type: msg?.type || 'chat',
                            mediaType: msg?.mimetype || null,
                            timestamp: msg?.t || Date.now(),
                            state: 'snapshot_initial',
                            origin: 'initial_snapshot'
                        }
                    });
                }
            }
            
            console.log(`[WHL Hooks] Initial snapshot complete: ${totalMessages} messages from ${chats.length} chats`);
            return { success: true, totalMessages, totalChats: chats.length };
        } catch (e) {
            console.error('[WHL Hooks] Snapshot failed:', e);
            return { success: false, error: e.message };
        }
    }

    // ===== FASE 4.2: DEEP SCAN =====
    async function performDeepScan(options = {}) {
        console.log('[WHL Hooks] Starting deep scan with options:', options);
        
        const {
            chatIds = null, // null = all chats
            maxMessagesPerChat = 1000,
            maxIterationsPerChat = 10,
            delayBetweenLoads = 1000, // Rate limiting: minimum 1 second between loads
            onProgress = null
        } = options;
        
        // Enforce minimum delay to prevent API abuse
        const safeDelay = Math.max(delayBetweenLoads, 500); // At least 500ms
        
        try {
            const ChatMod = tryRequireModule('WAWebChatCollection');
            if (!ChatMod || !ChatMod.ChatCollection) {
                throw new Error('ChatCollection not available');
            }
            
            let chatsToScan = [];
            
            if (chatIds && Array.isArray(chatIds)) {
                // Scan specific chats
                for (const chatId of chatIds) {
                    const chat = ChatMod.ChatCollection.get(chatId);
                    if (chat) chatsToScan.push(chat);
                }
            } else {
                // Scan all chats
                chatsToScan = ChatMod.ChatCollection.getModelsArray() || [];
            }
            
            let totalScanned = 0;
            let totalChatsScanned = 0;
            let consecutiveFailures = 0; // Track failures for exponential backoff
            
            for (const chat of chatsToScan) {
                if (!chat.msgs) continue;
                
                let iterations = 0;
                let previousCount = 0;
                
                while (iterations < maxIterationsPerChat) {
                    const currentCount = chat.msgs.length || 0;
                    
                    if (currentCount >= maxMessagesPerChat || currentCount === previousCount) {
                        break; // Reached limit or no new messages loaded
                    }
                    
                    // Try to load earlier messages with exponential backoff on failures
                    try {
                        if (typeof chat.loadEarlierMsgs === 'function') {
                            await chat.loadEarlierMsgs();
                            consecutiveFailures = 0; // Reset on success
                        }
                    } catch (e) {
                        console.warn('[WHL Hooks] loadEarlierMsgs failed for chat:', chat.id?._serialized, e);
                        consecutiveFailures++;
                        
                        // Exponential backoff: wait longer after repeated failures
                        if (consecutiveFailures > 0) {
                            const backoffDelay = safeDelay * Math.pow(2, Math.min(consecutiveFailures, 5));
                            console.log(`[WHL Hooks] Applying backoff: ${backoffDelay}ms after ${consecutiveFailures} failures`);
                            await new Promise(resolve => setTimeout(resolve, backoffDelay));
                        }
                        
                        break; // Stop loading for this chat after failure
                    }
                    
                    // Register loaded messages
                    const messages = chat.msgs.getModelsArray() || [];
                    for (const msg of messages.slice(previousCount)) {
                        const msgId = msg?.id?.id || msg?.id?._serialized;
                        if (!msgId) continue;
                        
                        notifyRecoverUI({
                            type: 'WHL_MESSAGE_DEEP_SCAN',
                            payload: {
                                id: msgId,
                                chatId: chat?.id?._serialized || null,
                                from: msg?.author?._serialized || msg?.from?._serialized || null,
                                to: msg?.to?._serialized || chat?.id?._serialized || null,
                                body: msg?.body || msg?.caption || '',
                                type: msg?.type || 'chat',
                                mediaType: msg?.mimetype || null,
                                timestamp: msg?.t || Date.now(),
                                state: 'snapshot_loaded',
                                origin: 'deep_scan'
                            }
                        });
                        
                        totalScanned++;
                    }
                    
                    previousCount = currentCount;
                    iterations++;
                    
                    // Progress callback
                    if (onProgress && typeof onProgress === 'function') {
                        onProgress({
                            chatId: chat.id?._serialized,
                            chatName: chat.name || 'Unknown',
                            messagesLoaded: currentCount,
                            iteration: iterations,
                            totalScanned
                        });
                    }
                    
                    // Rate limiting: delay between loads (with backoff if needed)
                    const effectiveDelay = consecutiveFailures > 0 
                        ? safeDelay * Math.pow(2, Math.min(consecutiveFailures, 3))
                        : safeDelay;
                    await new Promise(resolve => setTimeout(resolve, effectiveDelay));
                }
                
                totalChatsScanned++;
            }
            
            console.log(`[WHL Hooks] Deep scan complete: ${totalScanned} messages from ${totalChatsScanned} chats`);
            return { success: true, totalScanned, totalChatsScanned };
        } catch (e) {
            console.error('[WHL Hooks] Deep scan failed:', e);
            return { success: false, error: e.message };
        }
    }

    // ===== UTILITY: FIND MESSAGE BY ID =====
    function findMessageById(messageId) {
        try {
            const ChatMod = tryRequireModule('WAWebChatCollection');
            if (!ChatMod || !ChatMod.ChatCollection) return null;
            
            const chats = ChatMod.ChatCollection.getModelsArray() || [];
            
            for (const chat of chats) {
                if (!chat.msgs) continue;
                const msg = chat.msgs.get(messageId);
                if (msg) return msg;
            }
            
            return null;
        } catch (e) {
            console.error('[WHL Hooks] findMessageById failed:', e);
            return null;
        }
    }

    const hooks = {
        keep_revoked_messages: new RenderableMessageHook(),
        keep_edited_messages: new EditMessageHook(),
        keep_deleted_messages: new DeletedMessageHook(),
        message_created: new MessageCreatedHook(),
        message_failed: new MessageFailedHook(),
        status_updates: new StatusHook(),
    };

    const initialize_modules = () => {
        MODULES = {
            PROCESS_EDIT_MESSAGE: tryRequireModule(WA_MODULES.PROCESS_EDIT_MESSAGE),
            PROCESS_RENDERABLE_MESSAGES: tryRequireModule(WA_MODULES.PROCESS_RENDERABLE_MESSAGES),
            QUERY_GROUP: tryRequireModule(WA_MODULES.QUERY_GROUP),
            CHAT_COLLECTION: tryRequireModule(WA_MODULES.CHAT_COLLECTION),
            CONTACT_STORE: tryRequireModule(WA_MODULES.CONTACT_STORE),
            GROUP_METADATA: tryRequireModule(WA_MODULES.GROUP_METADATA),
            // Novos módulos
            WID_FACTORY: tryRequireModule(WA_MODULES.WID_FACTORY),
            MEDIA_PREP: tryRequireModule(WA_MODULES.MEDIA_PREP),
            MEDIA_UPLOAD: tryRequireModule(WA_MODULES.MEDIA_UPLOAD),
            MSG_MODELS: tryRequireModule(WA_MODULES.MSG_MODELS),
        };
        
        console.log('[WHL Hooks] Modules initialized:', {
            PROCESS_EDIT_MESSAGE: !!MODULES.PROCESS_EDIT_MESSAGE,
            PROCESS_RENDERABLE_MESSAGES: !!MODULES.PROCESS_RENDERABLE_MESSAGES,
            QUERY_GROUP: !!MODULES.QUERY_GROUP,
            CHAT_COLLECTION: !!MODULES.CHAT_COLLECTION,
            CONTACT_STORE: !!MODULES.CONTACT_STORE,
            GROUP_METADATA: !!MODULES.GROUP_METADATA,
            WID_FACTORY: !!MODULES.WID_FACTORY,
            MEDIA_PREP: !!MODULES.MEDIA_PREP,
            MEDIA_UPLOAD: !!MODULES.MEDIA_UPLOAD,
            MSG_MODELS: !!MODULES.MSG_MODELS
        });
    };

    const start = () => {
        initialize_modules();
        
        for (const [name, hook] of Object.entries(hooks)) {
            try {
                hook.register();
            } catch (e) {
                console.error(`[WHL Hooks] Error registering ${name}:`, e);
            }
        }
        
        console.log('[WHL Hooks] ✅ Hooks registrados com sucesso!');
    };
    
    /**
     * Carregar grupos via require() interno
     */
    function carregarGrupos() {
        try {
            // Usar require() diretamente aqui, não Store global
            const CC = require('WAWebChatCollection');
            const ChatCollection = CC?.ChatCollection;
            
            if (!ChatCollection || !ChatCollection.getModelsArray) {
                console.warn('[WHL] ChatCollection não disponível para grupos');
                return { success: false, groups: [] };
            }
            
            const models = ChatCollection.getModelsArray() || [];
            const grupos = models
                .filter(c => c.id && c.id.server === 'g.us')
                .map(g => ({
                    id: g.id._serialized,
                    name: g.name || g.formattedTitle || g.contact?.name || 'Grupo sem nome',
                    participants: g.groupMetadata?.participants?.length || 0
                }));
            
            console.log(`[WHL] ${grupos.length} grupos encontrados via require()`);
            return { success: true, groups: grupos };
        } catch (error) {
            console.error('[WHL] Erro ao carregar grupos:', error);
            return { success: false, error: error.message, groups: [] };
        }
    }

    // Aguardar módulos carregarem
    const load_and_start = async () => {
        let attempts = 0;
        const maxAttempts = 50;
        
        while (attempts < maxAttempts) {
            try {
                // Testar se módulos do WhatsApp estão disponíveis
                // Use constant for consistency
                if (require(WA_MODULES.PROCESS_RENDERABLE_MESSAGES)) {
                    console.log('[WHL Hooks] WhatsApp modules detected, starting...');
                    start();
                    return;
                }
            } catch (e) {
                // Módulo ainda não disponível
            }
            
            attempts++;
            await new Promise(r => setTimeout(r, 100));
        }
        
        console.warn('[WHL Hooks] ⚠️ Módulos não encontrados após', maxAttempts, 'tentativas, iniciando mesmo assim...');
        start();
    };

    // Iniciar após delay para garantir que WhatsApp Web carregou
    setTimeout(load_and_start, 1000);
    
    // ===== FUNÇÕES DE ENVIO DIRETO (API) =====
    
    /**
     * Abre chat sem reload da página
     * @param {string} phoneNumber - Número no formato internacional (ex: 5511999998888)
     * @returns {Promise<boolean>} - true se chat foi aberto com sucesso
     */
    async function openChatDirect(phoneNumber) {
        try {
            if (!MODULES.WID_FACTORY || !MODULES.CHAT_COLLECTION) {
                console.warn('[WHL Hooks] Módulos necessários não disponíveis para openChatDirect');
                return false;
            }
            
            const wid = MODULES.WID_FACTORY.createWid(phoneNumber + '@c.us');
            const chat = MODULES.CHAT_COLLECTION?.ChatCollection?.get?.(wid);
            
            if (chat) {
                // Abrir chat usando API interna
                if (MODULES.CHAT_COLLECTION.setActive) {
                    await MODULES.CHAT_COLLECTION.setActive(chat);
                }
                return true;
            }
            return false;
        } catch (error) {
            console.error('[WHL Hooks] Erro ao abrir chat:', error);
            return false;
        }
    }
    
    /**
     * Envia mensagem de texto diretamente via API
     * @param {string} phoneNumber - Número no formato internacional
     * @param {string} text - Texto da mensagem
     * @returns {Promise<boolean>} - true se mensagem foi enviada
     */
    async function sendMessageDirect(phoneNumber, text) {
        try {
            if (!MODULES.WID_FACTORY || !MODULES.CHAT_COLLECTION) {
                console.warn('[WHL Hooks] Módulos necessários não disponíveis para sendMessageDirect');
                return false;
            }
            
            const wid = MODULES.WID_FACTORY.createWid(phoneNumber + '@c.us');
            let chat = MODULES.CHAT_COLLECTION?.ChatCollection?.get?.(wid);
            
            if (!chat) {
                // Criar novo chat se não existir
                console.log('[WHL Hooks] Chat não encontrado, criando novo...');
                chat = await MODULES.CHAT_COLLECTION.add(wid);
            }
            
            if (chat && chat.sendMessage) {
                await chat.sendMessage(text);
                console.log('[WHL Hooks] ✅ Mensagem enviada via API para', phoneNumber);
                return true;
            }
            
            return false;
        } catch (error) {
            console.error('[WHL Hooks] Erro ao enviar mensagem:', error);
            return false;
        }
    }
    
    /**
     * Envia imagem diretamente via API
     * @param {string} phoneNumber - Número no formato internacional
     * @param {string} imageDataUrl - Data URL da imagem (base64)
     * @param {string} caption - Legenda da imagem (opcional)
     * @returns {Promise<boolean>} - true se imagem foi enviada
     */
    async function sendImageDirect(phoneNumber, imageDataUrl, caption = '') {
        // v9.6.0: 4 camadas de fallback. Versão anterior estava truncada no
        // 'else' e o else nem chamava nada — só retornava false. Resultado:
        // Disparo com imagem nunca funcionava em WA 2.3000.x porque MEDIA_PREP
        // foi renomeado/removido.
        const phoneClean = String(phoneNumber || '').replace(/\D/g, '');

        // CAMADA 1: API interna do WhatsApp (chat.sendMessage com mediaData
        // pré-processada). Funciona quando WAWebMediaPrep está disponível.
        try {
            if (MODULES.WID_FACTORY && MODULES.CHAT_COLLECTION && MODULES.MEDIA_PREP) {
                const wid = MODULES.WID_FACTORY.createWid(phoneClean + '@c.us');
                const chat = MODULES.CHAT_COLLECTION?.ChatCollection?.get?.(wid);
                if (chat && typeof chat.sendMessage === 'function' && typeof MODULES.MEDIA_PREP.prepareMedia === 'function') {
                    const blob = await (await fetch(imageDataUrl)).blob();
                    const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
                    const mediaData = await MODULES.MEDIA_PREP.prepareMedia(file);
                    await chat.sendMessage(mediaData, { caption: caption || '' });
                    console.log('[WHL Hooks] ✅ Imagem enviada via API interna para', phoneClean);
                    return true;
                }
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ Camada 1 (API interna) falhou:', e?.message || e);
        }

        // CAMADA 2: WPP.js global (window.WPP.chat.sendFileMessage) — disponível
        // se o usuário tiver o WPP injetado. Suporta imagem/vídeo/áudio/doc com
        // o mesmo método.
        try {
            if (window.WPP?.chat?.sendFileMessage) {
                await window.WPP.chat.sendFileMessage(phoneClean + '@c.us', imageDataUrl, {
                    type: 'image', caption: caption || '', isViewOnce: false
                });
                console.log('[WHL Hooks] ✅ Imagem enviada via WPP.js para', phoneClean);
                return true;
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ Camada 2 (WPP.js) falhou:', e?.message || e);
        }

        // CAMADA 3: fluxo via DOM paste (enviarImagemParaNumero). Funciona em
        // qualquer versão recente porque depende só do paste + caption + Enter.
        // É o fallback testado de fato em produção.
        try {
            if (typeof enviarImagemParaNumero === 'function') {
                const r = await enviarImagemParaNumero(phoneClean, imageDataUrl, caption);
                if (r?.success) {
                    console.log('[WHL Hooks] ✅ Imagem enviada via DOM paste para', phoneClean);
                    return true;
                }
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ Camada 3 (DOM paste) falhou:', e?.message || e);
        }

        // CAMADA 4 (último recurso): abrir chat e tentar via input[type=file]
        // do attach menu. Mais frágil porque depende do DOM do menu de anexos.
        try {
            if (typeof abrirChatPorNumero === 'function') {
                await abrirChatPorNumero(phoneClean);
                await new Promise(r => setTimeout(r, 1200));
                const fileInput = document.querySelector('input[type="file"][accept*="image"]')
                              || document.querySelector('input[type="file"]');
                if (fileInput) {
                    const blob = await (await fetch(imageDataUrl)).blob();
                    const dt = new DataTransfer();
                    dt.items.add(new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' }));
                    fileInput.files = dt.files;
                    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 800));
                    const sendBtn = document.querySelector('[aria-label*="Enviar" i]')
                                || document.querySelector('span[data-icon="send"]')?.closest('button');
                    if (sendBtn) {
                        sendBtn.click();
                        console.log('[WHL Hooks] ✅ Imagem enviada via input[type=file] para', phoneClean);
                        return true;
                    }
                }
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ Camada 4 (file input) falhou:', e?.message || e);
        }

        console.error('[WHL Hooks] ❌ Todas as 4 camadas falharam para', phoneClean);
        return false;
    };

// ─── END 02-webpack-interceptor.js ───

// ─── BEGIN 03-message-handlers.js ───
/**
 * @file content/wpp-hooks-parts/03-message-handlers.js
 * @description Slice 3001-4500 do wpp-hooks.js (refactor v9)
 * @lines 1500
 *
 * v9.6.0: o cabeçalho deste arquivo tinha 6 linhas órfãs que fechavam a
 * antiga função sendImageDirect (truncada em 02). Agora 02 fecha a função
 * sozinho, então removemos o trecho órfão para o concat não ficar com
 * }  } catch... duplicados.
 */

    /**
     * Aguarda módulos essenciais do WhatsApp estarem disponíveis
     * @param {number} timeout - Timeout máximo em ms (default 5000)
     * @returns {Promise<boolean>} - true se módulos estão prontos
     */
    async function ensureModulesReady(timeout = 5000) {
        const startTime = Date.now();
        const requiredModules = ['WAWebWidFactory', 'WAWebChatCollection', 'WAWebMediaPrep'];
        
        while (Date.now() - startTime < timeout) {
            try {
                let allReady = true;
                for (const modName of requiredModules) {
                    const mod = require(modName);
                    if (!mod) {
                        allReady = false;
                        break;
                    }
                }
                
                // Também verificar MODULES.MEDIA_PREP
                if (allReady && MODULES.MEDIA_PREP?.prepareMedia) {
                    console.log('[WHL Hooks] ✅ Todos módulos prontos');
                    return true;
                }
            } catch (e) {
                // Módulo não disponível ainda
            }
            
            await new Promise(r => setTimeout(r, 200));
        }
        
        console.warn('[WHL Hooks] ⚠️ Timeout aguardando módulos');
        return false;
    }

    /**
     * Calcula delay pós-envio baseado no tamanho do arquivo
     * @param {number} fileSizeBytes - Tamanho em bytes
     * @returns {number} - Delay em ms
     */
    function calculatePostSendDelay(fileSizeBytes) {
        const MIN_DELAY = 2000;  // 2s mínimo
        const MAX_DELAY = 10000; // 10s máximo
        const SIZE_DELAY_THRESHOLD = 500000; // 500KB
        
        // ~1s adicional por cada 500KB
        const sizeDelayMs = Math.floor(fileSizeBytes / SIZE_DELAY_THRESHOLD) * 1000;
        
        return Math.min(MAX_DELAY, MIN_DELAY + sizeDelayMs);
    }

    /**
     * Envia áudio como arquivo de áudio (não gravação nativa)
     * @param {string} phoneNumber - Número no formato internacional
     * @param {string} audioDataUrl - Data URL do áudio (base64)
     * @param {string} filename - Nome do arquivo
     * @returns {Promise<boolean>} - true se áudio foi enviado
     */
    /**
     * Envia áudio (PTT) e, opcionalmente, envia um texto associado.
     *
     * Observação: WhatsApp não permite legenda em PTT; portanto, quando há texto
     * junto do áudio, enviamos o texto como uma mensagem separada (antes do áudio).
     */
    async function sendAudioDirect(phoneNumber, audioDataUrl, filename = 'audio.ogg', extraText = '') {
        console.log('[WHL Hooks] 🎤 ========== INICIANDO ENVIO DE ÁUDIO ==========');
        console.log('[WHL Hooks] 🎤 Telefone:', phoneNumber);
        console.log('[WHL Hooks] 🎤 Filename:', filename);
        if (extraText) console.log('[WHL Hooks] 🎤 Texto associado (len):', String(extraText).length);
        console.log('[WHL Hooks] 🎤 DataURL length:', audioDataUrl?.length);
        console.log('[WHL Hooks] 🎤 DataURL prefix:', audioDataUrl?.substring(0, 50));

        // ✅ PASSO 0: Aguardar módulos
        console.log('[WHL Hooks] 🎤 [PASSO 0] Aguardando módulos...');
        await ensureModulesReady(3000);
        console.log('[WHL Hooks] 🎤 [PASSO 0] ✅ Módulos prontos');

        // Se há texto junto do áudio, enviar o texto primeiro (mensagem separada)
        try {
            const textToSend = (extraText || '').trim();
            if (textToSend) {
                console.log('[WHL Hooks] 🎤 [TEXTO] Enviando texto associado ao áudio...');
                const textRes = await enviarMensagemAPI(phoneNumber, textToSend);
                if (!textRes?.success) {
                    console.warn('[WHL Hooks] ❌ [TEXTO] Falha ao enviar texto associado:', textRes?.error);
                    return false;
                }
                // Pequeno intervalo para evitar colisão de envios
                await new Promise(r => setTimeout(r, 650));
                console.log('[WHL Hooks] 🎤 [TEXTO] ✅ Texto enviado, prosseguindo com áudio');
            }
        } catch (e) {
            console.warn('[WHL Hooks] ❌ [TEXTO] Erro ao enviar texto associado:', e?.message);
            return false;
        }

        // Converter data URL para blob/file com tratamento de erro
        let blob, file, delayMs;
        let mimeType = 'audio/ogg;codecs=opus'; // Valor default ANTES do try
        try {
            console.log('[WHL Hooks] 🎤 [CONVERSÃO] Convertendo DataURL para Blob...');
            const response = await fetch(audioDataUrl);
            if (!response.ok) {
                throw new Error(`Fetch failed: ${response.status}`);
            }
            blob = await response.blob();
            console.log('[WHL Hooks] 🎤 [CONVERSÃO] ✅ Blob criado - Size:', blob.size, 'bytes, Type:', blob.type);

            // ✅ Normalizar MIME type (sem espaço!)
            mimeType = blob.type || 'audio/ogg';
            console.log('[WHL Hooks] 🎤 [CONVERSÃO] MIME type original:', mimeType);
            if (mimeType.includes('webm')) {
                mimeType = 'audio/ogg;codecs=opus'; // SEM espaço!
            }
            // Remover todos os espaços após ponto e vírgula
            mimeType = mimeType.replace(/;\s+/g, ';');
            console.log('[WHL Hooks] 🎤 [CONVERSÃO] MIME type normalizado:', mimeType);

            file = new File([blob], filename, { type: mimeType });
            delayMs = calculatePostSendDelay(blob.size);
            console.log('[WHL Hooks] 🎤 [CONVERSÃO] ✅ File criado - Name:', filename, 'Delay:', delayMs, 'ms');
        } catch (e) {
            console.error('[WHL Hooks] ❌ [CONVERSÃO] Erro ao processar áudio:', e.message);
            console.error('[WHL Hooks] ❌ [CONVERSÃO] Stack:', e.stack);
            return false;
        }

        // ✅ CAMADA 0: AudioSender (solução testada e validada)
        console.log('[WHL Hooks] 🎤 [CAMADA 0] Verificando AudioSender...');
        console.log('[WHL Hooks] 🎤 [CAMADA 0] window.AudioSender existe?', !!window.AudioSender);
        console.log('[WHL Hooks] 🎤 [CAMADA 0] AudioSender.isAvailable()?', window.AudioSender?.isAvailable());

        if (window.AudioSender?.isAvailable?.()) {
            try {
                console.log('[WHL Hooks] 🎤 [CAMADA 0] Tentando via AudioSender...');
                const chatJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
                console.log('[WHL Hooks] 🎤 [CAMADA 0] ChatJID:', chatJid);

                // Calcular duração estimada (aproximação: ~10KB por segundo)
                const estimatedDuration = Math.max(3, Math.round(blob.size / 10000));
                console.log('[WHL Hooks] 🎤 [CAMADA 0] Duração estimada:', estimatedDuration, 'segundos');

                // Usar o módulo AudioSender testado
                const result = await window.AudioSender.send(audioDataUrl, chatJid, estimatedDuration);

                console.log('[WHL Hooks] 🎤 [CAMADA 0] Resultado:', result.success ? 'SUCESSO' : 'FALHA');
                if (result.success) {
                    console.log('[WHL Hooks] ✅ [CAMADA 0] Áudio PTT enviado via AudioSender!');
                    await new Promise(r => setTimeout(r, delayMs));
                    return true;
                } else {
                    console.warn('[WHL Hooks] ⚠️ [CAMADA 0] AudioSender retornou falha:', result.error);
                }
            } catch (e) {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 0] AudioSender lançou exceção:', e.message);
                console.warn('[WHL Hooks] ⚠️ [CAMADA 0] Stack:', e.stack);
            }
        } else {
            console.log('[WHL Hooks] ⚠️ [CAMADA 0] AudioSender não disponível, pulando...');
        }

        // ✅ CAMADA 1: WPP.js (se disponível)
        console.log('[WHL Hooks] 🎤 [CAMADA 1] Verificando WPP.js...');
        console.log('[WHL Hooks] 🎤 [CAMADA 1] window.WPP existe?', !!window.WPP);
        console.log('[WHL Hooks] 🎤 [CAMADA 1] window.WPP.chat existe?', !!window.WPP?.chat);
        console.log('[WHL Hooks] 🎤 [CAMADA 1] window.WPP.chat.sendFileMessage existe?', !!window.WPP?.chat?.sendFileMessage);

        if (window.WPP?.chat?.sendFileMessage) {
            try {
                console.log('[WHL Hooks] 🎤 [CAMADA 1] Tentando via WPP.js...');
                const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
                console.log('[WHL Hooks] 🎤 [CAMADA 1] ChatID:', chatId);

                await window.WPP.chat.sendFileMessage(chatId, file, {
                    type: 'audio',
                    isPtt: true,
                    filename: filename,
                    mimetype: mimeType
                });
                console.log('[WHL Hooks] ✅ [CAMADA 1] Áudio PTT enviado via WPP.js');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            } catch (e) {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 1] WPP.js PTT falhou:', e.message);
                console.warn('[WHL Hooks] ⚠️ [CAMADA 1] Stack:', e.stack);
            }
        } else {
            console.log('[WHL Hooks] ⚠️ [CAMADA 1] WPP.js não disponível, pulando...');
        }
        
        // ✅ CAMADA 2: MediaPrep + OpaqueData (LÓGICA CORRETA TESTADA)
        console.log('[WHL Hooks] 🎤 [CAMADA 2] Tentando MediaPrep + OpaqueData...');
        try {
            console.log('[WHL Hooks] 🎤 [CAMADA 2] Abrindo chat...');
            const opened = await abrirChatPorNumero(phoneNumber);
            console.log('[WHL Hooks] 🎤 [CAMADA 2] Chat aberto?', opened);
            if (!opened) throw new Error('Chat não abriu');

            console.log('[WHL Hooks] 🎤 [CAMADA 2] Obtendo módulos WhatsApp...');
            const ChatCollection = require('WAWebChatCollection');
            const MediaPrep = require('WAWebMediaPrep');
            const OpaqueData = require('WAWebMediaOpaqueData');
            
            console.log('[WHL Hooks] 🎤 [CAMADA 2] ChatCollection:', !!ChatCollection);
            console.log('[WHL Hooks] 🎤 [CAMADA 2] MediaPrep:', !!MediaPrep);
            console.log('[WHL Hooks] 🎤 [CAMADA 2] OpaqueData:', !!OpaqueData);
            
            if (!ChatCollection || !MediaPrep || !OpaqueData) {
                throw new Error('Módulos não disponíveis');
            }
            
            // Pegar chat ativo ou pelo número
            const chats = ChatCollection.ChatCollection?.getModelsArray?.() || [];
            let chat = chats.find(c => c.active);
            
            // Se não achou ativo, procurar pelo número
            if (!chat) {
                const targetJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
                chat = chats.find(c => c.id?._serialized === targetJid || c.id?.user === phoneNumber);
            }
            
            console.log('[WHL Hooks] 🎤 [CAMADA 2] Chat encontrado?', !!chat, chat?.id?._serialized);
            
            if (!chat) {
                throw new Error('Chat não encontrado na coleção');
            }
            
            // Criar OpaqueData a partir do blob
            console.log('[WHL Hooks] 🎤 [CAMADA 2] Criando OpaqueData...');
            const pttMimeType = 'audio/ogg; codecs=opus';
            const mediaBlob = await OpaqueData.createFromData(blob, pttMimeType);
            console.log('[WHL Hooks] 🎤 [CAMADA 2] OpaqueData criado:', !!mediaBlob);
            
            // Calcular duração estimada
            const estimatedDuration = Math.max(1, Math.round(blob.size / 10000));
            
            // Criar MediaPrep com Promise
            console.log('[WHL Hooks] 🎤 [CAMADA 2] Criando MediaPrep...');
            const mediaPropsPromise = Promise.resolve({
                mediaBlob: mediaBlob,
                mimetype: pttMimeType,
                type: 'ptt',
                duration: estimatedDuration,
                seconds: estimatedDuration,
                isPtt: true,
                ptt: true
            });
            
            const prep = new MediaPrep.MediaPrep('ptt', mediaPropsPromise);
            console.log('[WHL Hooks] 🎤 [CAMADA 2] MediaPrep criado, aguardando prep...');
            
            // Aguardar preparação
            await prep.waitForPrep();
            console.log('[WHL Hooks] 🎤 [CAMADA 2] Prep pronto! Enviando...');
            
            // Enviar
            const result = await MediaPrep.sendMediaMsgToChat(prep, chat, {});
            console.log('[WHL Hooks] 🎤 [CAMADA 2] Resultado:', result);
            
            if (result?.messageSendResult === 'OK') {
                console.log('[WHL Hooks] ✅ [CAMADA 2] Áudio PTT enviado com sucesso!');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            } else {
                throw new Error('Resultado não foi OK: ' + JSON.stringify(result));
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [CAMADA 2] MediaPrep falhou:', e.message);
            console.warn('[WHL Hooks] ⚠️ [CAMADA 2] Stack:', e.stack);
        }
        
        // ✅ CAMADA 2.5: Tentar como arquivo de áudio (não PTT)
        // NOTA: Não há risco de recursão circular - sendFileDirect não chama sendAudioDirect
        console.log('[WHL Hooks] 🎤 [CAMADA 2.5] Tentando enviar como arquivo de áudio...');
        try {
            const result = await sendFileDirect(phoneNumber, audioDataUrl, filename, '');
            console.log('[WHL Hooks] 🎤 [CAMADA 2.5] Resultado:', result);
            if (result) {
                console.log('[WHL Hooks] ✅ [CAMADA 2.5] Áudio enviado como arquivo');
                return true;
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [CAMADA 2.5] Envio como arquivo falhou:', e.message);
            console.warn('[WHL Hooks] ⚠️ [CAMADA 2.5] Stack:', e.stack);
        }

        // ✅ CAMADA 3: FALLBACK DOM via ClipboardEvent (mesmo método da imagem)
        console.log('[WHL Hooks] 🎤 [CAMADA 3] Tentando fallback DOM via ClipboardEvent...');
        try {
            console.log('[WHL Hooks] 🎤 [CAMADA 3] Abrindo chat...');
            await abrirChatPorNumero(phoneNumber);
            await new Promise(r => setTimeout(r, 1500));

            // Encontrar campo de composição (mesmo método usado para imagem)
            const input = acharCompose();
            if (!input) {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 3] Campo de composição não encontrado');
                throw new Error('Campo de composição não encontrado');
            }

            console.log('[WHL Hooks] 🎤 [CAMADA 3] Criando DataTransfer com arquivo de áudio...');
            const dt = new DataTransfer();
            dt.items.add(file);

            input.focus();
            console.log('[WHL Hooks] 🎤 [CAMADA 3] Disparando ClipboardEvent paste...');
            input.dispatchEvent(new ClipboardEvent('paste', { 
                bubbles: true, 
                cancelable: true, 
                clipboardData: dt 
            }));

            // Aguardar modal de preview
            await new Promise(r => setTimeout(r, 2000));

            // Procurar botão de enviar
            console.log('[WHL Hooks] 🎤 [CAMADA 3] Procurando botão enviar...');
            const sendBtn = document.querySelector('[data-testid="send"]') ||
                           document.querySelector('span[data-icon="send"]')?.closest('button') ||
                           document.querySelector('[aria-label*="Enviar"]');
            
            if (sendBtn) {
                console.log('[WHL Hooks] 🎤 [CAMADA 3] Clicando botão enviar...');
                sendBtn.click();
                console.log('[WHL Hooks] ✅ [CAMADA 3] Áudio enviado via ClipboardEvent!');
                await new Promise(r => setTimeout(r, Math.max(3000, delayMs)));
                return true;
            } else {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 3] Botão enviar não encontrado');
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [CAMADA 3] ClipboardEvent falhou:', e.message);
        }

        // ✅ CAMADA 4: FALLBACK DOM via input file (último recurso)
        console.log('[WHL Hooks] 🎤 [CAMADA 4] Tentando fallback DOM via input file...');
        try {
            console.log('[WHL Hooks] 🎤 [CAMADA 4] Procurando botão anexar...');
            const attachBtn = document.querySelector('[data-testid="clip"]') ||
                              document.querySelector('span[data-icon="attach-menu-plus"]')?.closest('button') ||
                              document.querySelector('span[data-icon="plus"]')?.closest('div[role="button"]');
            console.log('[WHL Hooks] 🎤 [CAMADA 4] Botão anexar encontrado?', !!attachBtn);

            if (attachBtn) {
                console.log('[WHL Hooks] 🎤 [CAMADA 4] Clicando botão anexar...');
                attachBtn.click();
                await new Promise(r => setTimeout(r, 800));

                console.log('[WHL Hooks] 🎤 [CAMADA 4] Procurando input de arquivo...');
                const fileInput = document.querySelector('input[accept*="audio"]') ||
                                  document.querySelector('input[accept*="*"]') ||
                                  document.querySelector('input[type="file"]');
                console.log('[WHL Hooks] 🎤 [CAMADA 4] Input de arquivo encontrado?', !!fileInput);

                if (fileInput) {
                    console.log('[WHL Hooks] 🎤 [CAMADA 4] Adicionando arquivo ao input...');
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    fileInput.files = dt.files;
                    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log('[WHL Hooks] 🎤 [CAMADA 4] Arquivo adicionado, aguardando...');

                    await new Promise(r => setTimeout(r, 2500));

                    console.log('[WHL Hooks] 🎤 [CAMADA 4] Procurando botão enviar...');
                    const sendBtn = document.querySelector('[data-testid="send"]') ||
                                   document.querySelector('span[data-icon="send"]')?.closest('button');
                    console.log('[WHL Hooks] 🎤 [CAMADA 4] Botão enviar encontrado?', !!sendBtn);

                    if (sendBtn) {
                        console.log('[WHL Hooks] 🎤 [CAMADA 4] Clicando botão enviar...');
                        sendBtn.click();
                        console.log('[WHL Hooks] ✅ [CAMADA 4] Áudio enviado via input file!');
                        await new Promise(r => setTimeout(r, Math.max(3000, delayMs)));
                        return true;
                    } else {
                        console.warn('[WHL Hooks] ⚠️ [CAMADA 4] Botão enviar não encontrado');
                    }
                } else {
                    console.warn('[WHL Hooks] ⚠️ [CAMADA 4] Input de arquivo não encontrado');
                }
            } else {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 4] Botão anexar não encontrado');
            }
        } catch (e) {
            console.error('[WHL Hooks] ❌ [CAMADA 4] Fallback DOM falhou:', e.message);
            console.error('[WHL Hooks] ❌ [CAMADA 4] Stack:', e.stack);
        }

        console.error('[WHL Hooks] ❌ ========== TODAS AS CAMADAS FALHARAM ==========');
        return false;
    }

    /**
     * Envia arquivo/documento
     * @param {string} phoneNumber - Número no formato internacional
     * @param {string} fileDataUrl - Data URL do arquivo (base64)
     * @param {string} filename - Nome do arquivo
     * @param {string} caption - Legenda opcional
     * @param {string} extraText - Texto opcional (enviado como mensagem separada antes do arquivo)
     * @returns {Promise<boolean>} - true se arquivo foi enviado
     */
    async function sendFileDirect(phoneNumber, fileDataUrl, filename = 'document', caption = '', extraText = '') {
        console.log('[WHL Hooks] 📁 ========== INICIANDO ENVIO DE ARQUIVO ==========');
        console.log('[WHL Hooks] 📁 Telefone:', phoneNumber);
        console.log('[WHL Hooks] 📁 Filename:', filename);
        console.log('[WHL Hooks] 📁 Caption:', caption);
        if (extraText) console.log('[WHL Hooks] 📁 Texto associado (len):', String(extraText).length);
        console.log('[WHL Hooks] 📁 DataURL length:', fileDataUrl?.length);
        console.log('[WHL Hooks] 📁 DataURL prefix:', fileDataUrl?.substring(0, 50));

        // ✅ PASSO 0: Aguardar módulos
        console.log('[WHL Hooks] 📁 [PASSO 0] Aguardando módulos...');
        await ensureModulesReady(3000);
        console.log('[WHL Hooks] 📁 [PASSO 0] ✅ Módulos prontos');

        // Se há texto junto do arquivo, enviar o texto primeiro (mensagem separada)
        // (mesma lógica do áudio: garante que o texto não seja perdido quando o WhatsApp ignora "caption" do documento)
        try {
            const textToSend = (extraText || '').trim();
            if (textToSend) {
                console.log('[WHL Hooks] 📁 [TEXTO] Enviando texto associado ao arquivo...');
                const textRes = await enviarMensagemAPI(phoneNumber, textToSend);
                if (!textRes?.success) {
                    console.warn('[WHL Hooks] ❌ [TEXTO] Falha ao enviar texto associado:', textRes?.error);
                    return false;
                }
                // Pequeno intervalo para evitar colisão de envios
                await new Promise(r => setTimeout(r, 650));
                console.log('[WHL Hooks] 📁 [TEXTO] ✅ Texto enviado, prosseguindo com arquivo');
            }
        } catch (e) {
            console.warn('[WHL Hooks] ❌ [TEXTO] Erro ao enviar texto associado:', e?.message);
            return false;
        }

        // Converter data URL para blob/file com tratamento de erro
        // ⚠️ mimeType precisa existir fora do try (é usado na CAMADA 2)
        let blob, file, delayMs, mimeType = 'application/octet-stream';
        try {
            console.log('[WHL Hooks] 📁 [CONVERSÃO] Convertendo DataURL para Blob...');
            const response = await fetch(fileDataUrl);
            if (!response.ok) {
                throw new Error(`Fetch failed: ${response.status}`);
            }
            blob = await response.blob();
            console.log('[WHL Hooks] 📁 [CONVERSÃO] ✅ Blob criado - Size:', blob.size, 'bytes, Type:', blob.type);

            mimeType = blob.type || 'application/octet-stream';
            console.log('[WHL Hooks] 📁 [CONVERSÃO] MIME type:', mimeType);

            file = new File([blob], filename, { type: mimeType });
            delayMs = calculatePostSendDelay(blob.size);
            console.log('[WHL Hooks] 📁 [CONVERSÃO] ✅ File criado - Name:', filename, 'Delay:', delayMs, 'ms');
        } catch (e) {
            console.error('[WHL Hooks] ❌ [CONVERSÃO] Erro ao processar arquivo:', e.message);
            console.error('[WHL Hooks] ❌ [CONVERSÃO] Stack:', e.stack);
            return false;
        }

        // ✅ CAMADA 1: WPP.js (se disponível)
        console.log('[WHL Hooks] 📁 [CAMADA 1] Verificando WPP.js...');
        console.log('[WHL Hooks] 📁 [CAMADA 1] window.WPP existe?', !!window.WPP);
        console.log('[WHL Hooks] 📁 [CAMADA 1] window.WPP.chat existe?', !!window.WPP?.chat);
        console.log('[WHL Hooks] 📁 [CAMADA 1] window.WPP.chat.sendFileMessage existe?', !!window.WPP?.chat?.sendFileMessage);

        if (window.WPP?.chat?.sendFileMessage) {
            try {
                console.log('[WHL Hooks] 📁 [CAMADA 1] Tentando via WPP.js...');
                const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
                console.log('[WHL Hooks] 📁 [CAMADA 1] ChatID:', chatId);

                await window.WPP.chat.sendFileMessage(chatId, file, {
                    type: 'document',
                    filename: filename,
                    caption: caption
                });
                console.log('[WHL Hooks] ✅ [CAMADA 1] Arquivo enviado via WPP.js');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            } catch (e) {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 1] WPP.js falhou:', e.message);
                console.warn('[WHL Hooks] ⚠️ [CAMADA 1] Stack:', e.stack);
            }
        } else {
            console.log('[WHL Hooks] ⚠️ [CAMADA 1] WPP.js não disponível, pulando...');
        }
        
        // ✅ CAMADA 2: MediaPrep + OpaqueData (LÓGICA CORRETA TESTADA)
        console.log('[WHL Hooks] 📁 [CAMADA 2] Tentando MediaPrep + OpaqueData...');
        try {
            console.log('[WHL Hooks] 📁 [CAMADA 2] Abrindo chat...');
            const opened = await abrirChatPorNumero(phoneNumber);
            console.log('[WHL Hooks] 📁 [CAMADA 2] Chat aberto?', opened);
            if (!opened) throw new Error('Chat não abriu');

            console.log('[WHL Hooks] 📁 [CAMADA 2] Obtendo módulos WhatsApp...');
            const ChatCollection = require('WAWebChatCollection');
            const MediaPrep = require('WAWebMediaPrep');
            const OpaqueData = require('WAWebMediaOpaqueData');
            
            console.log('[WHL Hooks] 📁 [CAMADA 2] ChatCollection:', !!ChatCollection);
            console.log('[WHL Hooks] 📁 [CAMADA 2] MediaPrep:', !!MediaPrep);
            console.log('[WHL Hooks] 📁 [CAMADA 2] OpaqueData:', !!OpaqueData);
            
            if (!ChatCollection || !MediaPrep || !OpaqueData) {
                throw new Error('Módulos não disponíveis');
            }
            
            // Pegar chat ativo ou pelo número
            const chats = ChatCollection.ChatCollection?.getModelsArray?.() || [];
            let chat = chats.find(c => c.active);
            
            // Se não achou ativo, procurar pelo número
            if (!chat) {
                const targetJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
                chat = chats.find(c => c.id?._serialized === targetJid || c.id?.user === phoneNumber);
            }
            
            console.log('[WHL Hooks] 📁 [CAMADA 2] Chat encontrado?', !!chat, chat?.id?._serialized);
            
            if (!chat) {
                throw new Error('Chat não encontrado na coleção');
            }
            
            // Criar OpaqueData a partir do blob
            console.log('[WHL Hooks] 📁 [CAMADA 2] Criando OpaqueData...');
            const docMimeType = mimeType || 'application/octet-stream';
            const mediaBlob = await OpaqueData.createFromData(blob, docMimeType);
            console.log('[WHL Hooks] 📁 [CAMADA 2] OpaqueData criado:', !!mediaBlob);
            
            // Criar MediaPrep com Promise para documento
            console.log('[WHL Hooks] 📁 [CAMADA 2] Criando MediaPrep...');
            const mediaPropsPromise = Promise.resolve({
                mediaBlob: mediaBlob,
                mimetype: docMimeType,
                type: 'document',
                filename: filename,
                caption: caption || '',
                size: blob.size
            });
            
            const prep = new MediaPrep.MediaPrep('document', mediaPropsPromise);
            console.log('[WHL Hooks] 📁 [CAMADA 2] MediaPrep criado, aguardando prep...');
            
            // Aguardar preparação
            await prep.waitForPrep();
            console.log('[WHL Hooks] 📁 [CAMADA 2] Prep pronto! Enviando...');
            
            // Enviar
            const result = await MediaPrep.sendMediaMsgToChat(prep, chat, {});
            console.log('[WHL Hooks] 📁 [CAMADA 2] Resultado:', result);
            
            if (result?.messageSendResult === 'OK') {
                console.log('[WHL Hooks] ✅ [CAMADA 2] Arquivo enviado com sucesso!');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            } else {
                throw new Error('Resultado não foi OK: ' + JSON.stringify(result));
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [CAMADA 2] MediaPrep falhou:', e.message);
            console.warn('[WHL Hooks] ⚠️ [CAMADA 2] Stack:', e.stack);
        }
        
        // ✅ CAMADA 3: FALLBACK DOM via ClipboardEvent (mesmo método da imagem)
        console.log('[WHL Hooks] 📁 [CAMADA 3] Tentando fallback DOM via ClipboardEvent...');
        try {
            console.log('[WHL Hooks] 📁 [CAMADA 3] Abrindo chat...');
            await abrirChatPorNumero(phoneNumber);
            await new Promise(r => setTimeout(r, 1500));

            // Encontrar campo de composição (mesmo método usado para imagem)
            const input = acharCompose();
            if (!input) {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 3] Campo de composição não encontrado');
                throw new Error('Campo de composição não encontrado');
            }

            console.log('[WHL Hooks] 📁 [CAMADA 3] Criando DataTransfer com arquivo...');
            const dt = new DataTransfer();
            dt.items.add(file);

            input.focus();
            console.log('[WHL Hooks] 📁 [CAMADA 3] Disparando ClipboardEvent paste...');
            input.dispatchEvent(new ClipboardEvent('paste', { 
                bubbles: true, 
                cancelable: true, 
                clipboardData: dt 
            }));

            // Aguardar modal de preview
            await new Promise(r => setTimeout(r, 2000));

            // Se tem caption, inserir
            if (caption) {
                const captionInput = document.querySelector('[data-testid="media-caption-input-container"] [contenteditable="true"]') ||
                                    document.querySelector('[data-testid="media-caption-input"] [contenteditable="true"]') ||
                                    document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]');
                
                if (captionInput) {
                    captionInput.focus();
                    document.execCommand('selectAll', false, null);
                    document.execCommand('delete', false, null);
                    document.execCommand('insertText', false, caption);
                    console.log('[WHL Hooks] 📁 [CAMADA 3] Caption adicionado');
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            // Procurar botão de enviar
            console.log('[WHL Hooks] 📁 [CAMADA 3] Procurando botão enviar...');
            const sendBtn = document.querySelector('[data-testid="send"]') ||
                           document.querySelector('span[data-icon="send"]')?.closest('button') ||
                           document.querySelector('[aria-label*="Enviar"]');
            
            if (sendBtn) {
                console.log('[WHL Hooks] 📁 [CAMADA 3] Clicando botão enviar...');
                sendBtn.click();
                console.log('[WHL Hooks] ✅ [CAMADA 3] Arquivo enviado via ClipboardEvent!');
                await new Promise(r => setTimeout(r, Math.max(3000, delayMs)));
                return true;
            } else {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 3] Botão enviar não encontrado');
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [CAMADA 3] ClipboardEvent falhou:', e.message);
        }

        // ✅ CAMADA 4: FALLBACK DOM via input file (último recurso)
        console.log('[WHL Hooks] 📁 [CAMADA 4] Tentando fallback DOM via input file...');
        try {
            console.log('[WHL Hooks] 📁 [CAMADA 4] Procurando botão anexar...');
            const attachBtn = document.querySelector('[data-testid="clip"]') ||
                              document.querySelector('span[data-icon="attach-menu-plus"]')?.closest('button') ||
                              document.querySelector('span[data-icon="plus"]')?.closest('div[role="button"]') ||
                              document.querySelector('span[data-icon="clip"]')?.closest('div');
            console.log('[WHL Hooks] 📁 [CAMADA 4] Botão anexar encontrado?', !!attachBtn);

            if (attachBtn) {
                console.log('[WHL Hooks] 📁 [CAMADA 4] Clicando botão anexar...');
                attachBtn.click();
                await new Promise(r => setTimeout(r, 800));

                console.log('[WHL Hooks] 📁 [CAMADA 4] Procurando input de documento...');
                const docInput = document.querySelector('input[accept="*"]') ||
                                 document.querySelector('input[accept*="*"]') ||
                                 document.querySelector('input[type="file"]');
                console.log('[WHL Hooks] 📁 [CAMADA 4] Input de documento encontrado?', !!docInput);

                if (docInput) {
                    console.log('[WHL Hooks] 📁 [CAMADA 4] Adicionando arquivo ao input...');
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    docInput.files = dt.files;
                    docInput.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log('[WHL Hooks] 📁 [CAMADA 4] Arquivo adicionado, aguardando...');

                    await new Promise(r => setTimeout(r, 2500));

                    // Se tem caption, inserir
                    if (caption) {
                        const captionInput = document.querySelector('[data-testid="media-caption-input-container"] [contenteditable="true"]') ||
                                            document.querySelector('div[contenteditable="true"][data-lexical-editor="true"]');
                        if (captionInput) {
                            captionInput.focus();
                            document.execCommand('selectAll', false, null);
                            document.execCommand('delete', false, null);
                            document.execCommand('insertText', false, caption);
                            await new Promise(r => setTimeout(r, 300));
                        }
                    }

                    console.log('[WHL Hooks] 📁 [CAMADA 4] Procurando botão enviar...');
                    const sendBtn = document.querySelector('[data-testid="send"]') ||
                                   document.querySelector('span[data-icon="send"]')?.closest('button') ||
                                   document.querySelector('span[data-icon="send"]')?.parentElement;
                    console.log('[WHL Hooks] 📁 [CAMADA 4] Botão enviar encontrado?', !!sendBtn);

                    if (sendBtn) {
                        console.log('[WHL Hooks] 📁 [CAMADA 4] Clicando botão enviar...');
                        sendBtn.click();
                        console.log('[WHL Hooks] ✅ [CAMADA 4] Arquivo enviado via input file!');
                        await new Promise(r => setTimeout(r, Math.max(3000, delayMs)));
                        return true;
                    } else {
                        console.warn('[WHL Hooks] ⚠️ [CAMADA 4] Botão enviar não encontrado');
                    }
                } else {
                    console.warn('[WHL Hooks] ⚠️ [CAMADA 4] Input de documento não encontrado');
                }
            } else {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 4] Botão anexar não encontrado');
            }
        } catch (e) {
            console.error('[WHL Hooks] ❌ [CAMADA 4] Fallback DOM falhou:', e.message);
            console.error('[WHL Hooks] ❌ [CAMADA 4] Stack:', e.stack);
        }

        console.error('[WHL Hooks] ❌ ========== TODAS AS CAMADAS FALHARAM ==========');
        return false;
    }

    /**
     * BUG FIX 3: DOM-based fallback for sending media
     * @param {string} chatId - Chat ID
     * @param {Object} mediaData - Media data object
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} - Result object
     */
    async function sendMediaViaDOM(chatId, mediaData, options = {}) {
        try {
            console.log('[WHL Hooks] 📎 Sending media via DOM fallback...');
            
            // 1. Find attach button
            const attachBtn = document.querySelector('[data-testid="attach-menu-plus"]') ||
                              document.querySelector('[data-testid="clip"]') ||
                              document.querySelector('[title*="Attach"]');
            
            if (!attachBtn) throw new Error('Attach button not found');
            
            attachBtn.click();
            await sleep(500);
            
            // 2. Find file input
            const fileInput = document.querySelector('input[type="file"]');
            if (!fileInput) throw new Error('File input not found');
            
            // 3. Create file from base64
            const blob = base64ToBlob(mediaData.base64, mediaData.mimetype);
            const file = new File([blob], mediaData.filename || 'file', { type: mediaData.mimetype });
            
            // 4. Set file to input
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
            
            // 5. Dispatch change event
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));
            
            await sleep(1000);
            
            // 6. Click send button
            const sendBtn = document.querySelector('[data-testid="send"]') ||
                            document.querySelector('[aria-label*="Send"]');
            if (sendBtn) sendBtn.click();
            
            return { success: true, method: 'dom' };
        } catch (e) {
            console.error('[WHL Hooks] DOM media send failed:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * Envia mensagem com indicador de digitação
     * @param {string} phoneNumber - Número no formato internacional
     * @param {string} text - Texto da mensagem
     * @param {number} typingDuration - Duração do indicador em ms
     * @returns {Promise<boolean>} - true se mensagem foi enviada
     */
    async function sendWithTypingIndicator(phoneNumber, text, typingDuration = 2000) {
        try {
            if (!MODULES.WID_FACTORY || !MODULES.CHAT_COLLECTION) {
                console.warn('[WHL Hooks] Módulos necessários não disponíveis');
                return false;
            }
            
            const wid = MODULES.WID_FACTORY.createWid(phoneNumber + '@c.us');
            let chat = MODULES.CHAT_COLLECTION?.ChatCollection?.get?.(wid);
            
            if (!chat) {
                return false;
            }
            
            // Mostrar "digitando..." para o destinatário
            if (chat.presence) {
                await chat.presence.subscribe();
                await chat.presence.update('composing');
            }
            
            // Aguardar tempo simulado (baseado no tamanho da mensagem)
            const delay = Math.min(typingDuration, text.length * 50);
            await new Promise(r => setTimeout(r, delay));
            
            // Enviar mensagem
            if (chat.sendMessage) {
                await chat.sendMessage(text);
            }
            
            // Parar indicador
            if (chat.presence) {
                await chat.presence.update('available');
            }
            
            console.log('[WHL Hooks] ✅ Mensagem enviada com indicador de digitação');
            return true;
        } catch (error) {
            console.error('[WHL Hooks] Erro ao enviar com typing indicator:', error);
            return false;
        }
    }
    
    /**
     * Extrai todos os contatos diretamente via API
     * @returns {Object} - Objeto com arrays de contatos (normal, archived, blocked, groups)
     */
    function extractAllContactsDirect() {
        const result = {
            normal: [],
            archived: [],
            blocked: [],
            groups: []
        };
        
        try {
            const chats = MODULES.CHAT_COLLECTION?.models || 
                         MODULES.CHAT_COLLECTION?.getModelsArray?.() || 
                         [];
            
            chats.forEach(chat => {
                const id = chat.id?._serialized;
                if (!id) return;
                
                if (id.endsWith('@g.us')) {
                    // Grupo
                    result.groups.push({
                        id,
                        name: chat.formattedTitle || chat.name || 'Grupo sem nome',
                        participants: chat.groupMetadata?.participants?.length || 0
                    });
                } else if (id.endsWith('@c.us')) {
                    // Contato individual
                    const phone = id.replace('@c.us', '');
                    if (chat.archive) {
                        result.archived.push(phone);
                    } else {
                        result.normal.push(phone);
                    }
                }
            });
            
            // Bloqueados (se disponível)
            if (MODULES.CONTACT_STORE?.models) {
                MODULES.CONTACT_STORE.models.forEach(contact => {
                    if (contact.isBlocked) {
                        const id = contact.id?._serialized;
                        if (id?.endsWith('@c.us')) {
                            result.blocked.push(id.replace('@c.us', ''));
                        }
                    }
                });
            }
            
            console.log('[WHL Hooks] ✅ Extração direta concluída:', {
                normal: result.normal.length,
                archived: result.archived.length,
                blocked: result.blocked.length,
                groups: result.groups.length
            });
        } catch (error) {
            console.error('[WHL Hooks] Erro ao extrair contatos:', error);
        }
        
        return result;
    }
    
    /**
     * Extração instantânea via API interna (caminho legado).
     *
     * A versão original deste arquivo chamava `contact.id.user` direto, o
     * que para a 2.3000.x emite os dígitos do @lid como se fossem telefone
     * (foi exatamente o bug reportado: "números grandes aleatórios").
     * Aqui delegamos para extrairContatos() (definido em 01-init-debug.js)
     * que usa o resolver estrito resolvePhoneFromChat — ele recusa @lid e
     * só aceita id.user quando id.server é c.us/s.whatsapp.net.
     */
    function extrairContatosInstantaneo() {
        try {
            const r = extrairContatos();
            if (r && r.success) {
                return { success: true, contacts: r.contacts, method: 'extrairContatos(strict)' };
            }
            return r || { success: false, error: 'Nenhum método disponível' };
        } catch (error) {
            console.error('[WHL] Erro na extração instantânea:', error);
            return { success: false, error: error.message };
        }
    }

    // NB: a função extrairBloqueados duplicada que vivia aqui foi removida.
    // A 01-init-debug.js já define uma versão correta (usa resolvePhoneFromChat
    // estrito + lookup em ContactCollection para entradas @lid). A duplicata
    // legada sobrescrevia aquela na concat order, leakando os dígitos do @lid
    // como se fossem números bloqueados — foi o que o usuário viu.
    
    /**
     * PR #76 ULTRA: Helper para obter nome do grupo
     */
    async function getGroupName(groupId) {
        try {
            const cols = await waitForCollections();
            if (!cols) return 'Grupo';
            
            const chat = cols.ChatCollection.get(groupId);
            return chat?.name || chat?.formattedTitle || 'Grupo';
        } catch (e) {
            return 'Grupo';
        }
    }

    // ===== WhatsAppExtractor v4.0 (TESTADO E FUNCIONANDO) =====
    // Módulo de extração de membros do WhatsApp - v4.0 (Virtual Scroll Fix)
    const WhatsAppExtractor = {
      
      // Estado
      state: {
        isExtracting: false,
        members: new Map(),
        groupName: '',
        debug: true
      },

      log(...args) {
        if (this.state.debug) {
          console.log('[WA Extractor]', ...args);
        }
      },

      delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
      },

      getGroupName() {
        const mainHeader = document.querySelector('#main header');
        if (mainHeader) {
          const titleSpan = mainHeader.querySelector('span[title]');
          if (titleSpan) {
            const title = titleSpan.getAttribute('title');
            if (title && !title.includes('+55') && title.length < 100) {
              return title;
            }
          }
          
          const spans = mainHeader.querySelectorAll('span[dir="auto"]');
          for (const span of spans) {
            const text = span.textContent?.trim();
            if (text && text.length < 50 && !text.includes('+55')) {
              return text;
            }
          }
        }
        return 'Grupo';
      },

      async openGroupInfo() {
        this.log('Tentando abrir info do grupo...');
        
        const header = document.querySelector('#main header');
        if (!header) {
          throw new Error('Header do chat não encontrado');
        }

        const clickable = header.querySelector('[role="button"]') || 
                         header.querySelector('div[tabindex="0"]') ||
                         header;
        
        clickable.click();
        await this.delay(1500);
        return true;
      },

      async clickSeeAllMembers() {
        this.log('Procurando botão "Ver todos"...');
        await this.delay(500);

        const membersSections = document.querySelectorAll('div[role="button"]');
        
        for (const section of membersSections) {
          const text = section.textContent || '';
          if (/\d+\s*(membros|members)/i.test(text) || 
              /ver tudo|see all|view all/i.test(text)) {
            if (text.length < 500) {
              section.click();
              await this.delay(2000);
              return true;
            }
          }
        }

        const allSpans = document.querySelectorAll('span');
        for (const span of allSpans) {
          const text = span.textContent?.toLowerCase().trim() || '';
          if (text === 'ver tudo' || text === 'see all') {
            const clickable = span.closest('[role="button"]') || span.closest('div[tabindex]') || span;
            clickable.click();
            await this.delay(2000);
            return true;
          }
        }

        return false;
      },

      findMembersModal() {
        const dialogs = document.querySelectorAll('[role="dialog"]');
        
        for (const dialog of dialogs) {
          const scrollables = dialog.querySelectorAll('div');
          
          for (const div of scrollables) {
            const style = window.getComputedStyle(div);
            const hasScroll = style.overflowY === 'auto' || style.overflowY === 'scroll';
            
            if (hasScroll && div.scrollHeight > div.clientHeight + 100) {
              const items = div.querySelectorAll('[role="listitem"], [role="row"], [data-testid*="cell"]');
              
              if (items.length > 0) {
                return { modal: dialog, scrollContainer: div };
              }
            }
          }
        }

        return null;
      },

      extractMemberData(element) {
        try {
          const spans = element.querySelectorAll('span[title], span[dir="auto"]');
          
          let name = '';
          let phone = '';
          let isAdmin = false;

          const fullText = element.textContent?.toLowerCase() || '';
          isAdmin = fullText.includes('admin');

          for (const span of spans) {
            const title = span.getAttribute('title');
            const text = (title || span.textContent || '').trim();
            
            if (!text || text.length < 2) continue;
            
            const lowerText = text.toLowerCase();
            if (['admin', 'admin do grupo', 'você', 'you', 'online', 'offline', 
                 'visto por último', 'last seen', 'pesquisar', 'search',
                 'membros', 'members', 'participantes'].some(s => lowerText === s || lowerText.startsWith(s + ' '))) {
              continue;
            }

            const cleanText = text.replace(/[\s\-()]/g, '');
            if (/^\+?\d{10,}$/.test(cleanText)) {
              phone = text;
              if (!name) name = text;
              continue;
            }

            if (!name && text.length >= 2 && text.length < 100) {
              name = text;
            }
          }

          if (!name) return null;

          const key = phone || name;

          return {
            key: key,
            name: name,
            phone: phone || '',
            isAdmin: isAdmin
          };

        } catch (error) {
          return null;
        }
      },

      isValidMember(name) {
        if (!name || name.length < 2) return false;
        
        const invalidPatterns = [
          /^(admin|você|you|pesquisar|search|ver tudo|see all)$/i,
          /^(membros|members|participantes|participants)$/i,
          /^(adicionar|add|sair|exit|denunciar|report)$/i,
          /^\d+\s*(membros|members)$/i
        ];
        
        for (const pattern of invalidPatterns) {
          if (pattern.test(name.trim())) {
            return false;
          }
        }
        
        return true;
      },

      extractVisibleMembers(container) {
        const itemSelectors = [
          '[role="listitem"]',
          '[role="row"]',
          '[data-testid="cell-frame-container"]',
          '[data-testid="list-item"]'
        ];

        let memberElements = [];
        
        for (const selector of itemSelectors) {
          const items = container.querySelectorAll(selector);
          if (items.length > memberElements.length) {
            memberElements = Array.from(items);
          }
        }

        let newMembersCount = 0;

        for (const element of memberElements) {
          const memberData = this.extractMemberData(element);
          
          if (memberData && memberData.name && this.isValidMember(memberData.name)) {
            if (!this.state.members.has(memberData.key)) {
              this.state.members.set(memberData.key, {
                name: memberData.name,
                phone: memberData.phone,
                isAdmin: memberData.isAdmin
              });
              newMembersCount++;
            }
          }
        }

        return newMembersCount;
      },

      async scrollAndCapture(modalInfo, onProgress) {
        const { scrollContainer } = modalInfo;
        
        if (!scrollContainer) {
          return;
        }

        this.state.members.clear();

        const CONFIG = {
          scrollStepPercent: 0.25,
          delayBetweenScrolls: 400,
          delayAfterCapture: 200,
          maxScrollAttempts: 500,
          noNewMembersLimit: 15,
        };

        let scrollAttempts = 0;
        let noNewMembersCount = 0;
        let lastMemberCount = 0;

        scrollContainer.scrollTop = 0;
        await this.delay(800);

        this.extractVisibleMembers(scrollContainer);

        while (scrollAttempts < CONFIG.maxScrollAttempts) {
          const scrollStep = scrollContainer.clientHeight * CONFIG.scrollStepPercent;
          
          scrollContainer.scrollTop += scrollStep;
          await this.delay(CONFIG.delayBetweenScrolls);

          const newMembers = this.extractVisibleMembers(scrollContainer);
          const totalMembers = this.state.members.size;

          if (onProgress) {
            onProgress({ loaded: totalMembers });
          }

          if (totalMembers > lastMemberCount) {
            noNewMembersCount = 0;
            lastMemberCount = totalMembers;
            await this.delay(CONFIG.delayAfterCapture);
          } else {
            noNewMembersCount++;
          }

          const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 20;
          
          if (atBottom) {
            for (let i = 0; i < 3; i++) {
              await this.delay(300);
              this.extractVisibleMembers(scrollContainer);
            }
            break;
          }

          if (noNewMembersCount >= CONFIG.noNewMembersLimit) {
            break;
          }

          scrollAttempts++;
        }

        // Varredura final
        scrollContainer.scrollTop = 0;
        await this.delay(500);

        let finalSweepCount = 0;
        while (scrollContainer.scrollTop + scrollContainer.clientHeight < scrollContainer.scrollHeight - 10) {
          this.extractVisibleMembers(scrollContainer);
          scrollContainer.scrollTop += scrollContainer.clientHeight * 0.5;
          await this.delay(200);
          finalSweepCount++;
          if (finalSweepCount > 100) break;
        }

        this.extractVisibleMembers(scrollContainer);
      },

      async extractMembers(onProgress, onComplete, onError) {
        try {
          this.state.isExtracting = true;
          this.state.members.clear();

          this.state.groupName = this.getGroupName();

          onProgress?.({ status: 'Abrindo informações do grupo...', count: 0 });

          await this.openGroupInfo();
          await this.delay(1500);

          onProgress?.({ status: 'Expandindo lista de membros...', count: 0 });
          await this.clickSeeAllMembers();
          await this.delay(2000);

          onProgress?.({ status: 'Localizando lista de membros...', count: 0 });
          const modalInfo = this.findMembersModal();

          if (!modalInfo) {
            throw new Error('Modal de membros não encontrado');
          }

          onProgress?.({ status: 'Capturando membros...', count: 0 });
          await this.scrollAndCapture(modalInfo, (data) => {
            onProgress?.({ status: 'Capturando membros...', count: data.loaded });
          });

          this.state.isExtracting = false;

          const membersArray = Array.from(this.state.members.values());

          const result = {
            groupName: this.state.groupName,
            totalMembers: membersArray.length,
            members: membersArray
          };

          onComplete?.(result);
          return result;

        } catch (error) {
          this.state.isExtracting = false;
          onError?.(error.message);
          throw error;
        }
      }
    };

    window.WhatsAppExtractor = WhatsAppExtractor;

    /**
     * WhatsAppExtractor v4.0 - Extração de membros de grupo (APENAS DOM)
     * Substitui completamente o método antigo que retornava LIDs
     * @param {string} groupId - ID do grupo (_serialized)
     * @returns {Promise<Object>} Resultado com membros extraídos (números reais)
     */
    async function extractGroupMembersUltra(groupId) {
        console.log('[WHL] ═══════════════════════════════════════════');
        console.log('[WHL] 🚀 WhatsAppExtractor v4.0: Iniciando extração DOM');
        console.log('[WHL] 📱 Grupo:', groupId);
        console.log('[WHL] ═══════════════════════════════════════════');
        
        try {
            // PASSO 1: Abrir o chat do grupo na sidebar
            console.log('[WHL] PASSO 1: Abrindo chat do grupo...');
            const chatOpened = await abrirChatDoGrupo(groupId);
            
            if (!chatOpened) {
                console.warn('[WHL] Não foi possível abrir o chat, tentando continuar...');
            }
            
            await new Promise(r => setTimeout(r, 2000));
            
            // PASSO 2: Usar WhatsAppExtractor v4.0 para extrair membros
            console.log('[WHL] PASSO 2: Iniciando WhatsAppExtractor.extractMembers()...');
            
            const result = await WhatsAppExtractor.extractMembers(
                // onProgress
                (progress) => {
                    console.log('[WHL] Progresso:', progress.status, progress.count);
                    window.postMessage({
                        type: 'WHL_EXTRACTION_PROGRESS',
                        groupId: groupId,
                        phase: 'extracting',
                        message: progress.status,
                        progress: 50,
                        currentCount: progress.count
                    }, window.location.origin);
                },
                // onComplete
                (result) => {
                    console.log('[WHL] ✅ Extração concluída:', result.totalMembers, 'membros');
                },
                // onError
                (error) => {
                    console.error('[WHL] ❌ Erro na extração:', error);
                }
            );
            
            // PASSO 3: Converter resultado para formato compatível
            const members = result.members.map(m => {
                // Extrair apenas números reais (com telefone)
                if (m.phone) {
                    const cleaned = m.phone.replace(/[^\d]/g, '');
                    return cleaned;
                }
                return null;
            }).filter(Boolean);
            
            console.log('[WHL] ═══════════════════════════════════════════');
            console.log('[WHL] ✅ EXTRAÇÃO CONCLUÍDA');
            console.log('[WHL] 📱 Total de membros:', result.totalMembers);
            console.log('[WHL] 📞 Números extraídos:', members.length);
            console.log('[WHL] ═══════════════════════════════════════════');
            
            // Notificar conclusão
            window.postMessage({
                type: 'WHL_EXTRACTION_PROGRESS',
                groupId: groupId,
                phase: 'complete',
                message: `Concluído: ${members.length} números extraídos`,
                progress: 100,
                currentCount: members.length
            }, window.location.origin);
            
            return {
                success: true,
                members: members,
                count: members.length,
                groupName: result.groupName || 'Grupo',
                // Manter estrutura de stats para compatibilidade
                stats: {
                    domExtractor: members.length,
                    total: members.length
                }
            };
            
        } catch (e) {
            console.error('[WHL] ❌ Erro na extração:', e.message);
            
            // Notificar erro
            window.postMessage({
                type: 'WHL_EXTRACTION_PROGRESS',
                groupId: groupId,
                phase: 'error',
                message: 'Erro: ' + e.message,
                progress: 100
            }, window.location.origin);
            
            return { 
                success: false, 
                error: e.message, 
                members: [], 
                count: 0,
                stats: {
                    domExtractor: 0,
                    total: 0
                }
            };
        }
    }
    
    /**
     * Abre o chat do grupo usando API interna do WhatsApp
     * Mais confiável que buscar na sidebar
     * @param {string} groupId - ID do grupo (_serialized)
     * @returns {Promise<boolean>} - true se chat foi aberto
     */
    async function abrirChatDoGrupo(groupId) {
        console.log('[WHL] Abrindo chat via API interna:', groupId);
        
        try {
            // Método 1: Usar CMD.openChatAt (mais confiável)
            try {
                const CMD = require('WAWebCmd');
                const CC = require('WAWebChatCollection');
                
                const chat = CC?.ChatCollection?.get(groupId);
                if (chat) {
                    // Tentar openChatAt primeiro
                    if (CMD && typeof CMD.openChatAt === 'function') {
                        console.log('[WHL] Usando CMD.openChatAt...');
                        await CMD.openChatAt(chat);
                        await new Promise(r => setTimeout(r, 2000));
                        
                        // Verificar se o chat abriu (header deve mostrar o grupo)
                        const header = document.querySelector('#main header');
                        if (header) {
                            console.log('[WHL] ✅ Chat aberto via CMD.openChatAt');
                            return true;
                        }
                    }
                    
                    // Tentar openChatFromUnread
                    if (CMD && typeof CMD.openChatFromUnread === 'function') {
                        console.log('[WHL] Usando CMD.openChatFromUnread...');
                        await CMD.openChatFromUnread(chat);
                        await new Promise(r => setTimeout(r, 2000));
                        return true;
                    }
                }
            } catch (e) {
                console.warn('[WHL] CMD methods failed:', e.message);
            }
            
            // Método 2: Usar chat.open() se disponível
            try {
                const CC = require('WAWebChatCollection');
                const chat = CC?.ChatCollection?.get(groupId);
                
                if (chat && typeof chat.open === 'function') {
                    console.log('[WHL] Usando chat.open()...');
                    await chat.open();
                    await new Promise(r => setTimeout(r, 2000));
                    return true;
                }
            } catch (e) {
                console.warn('[WHL] chat.open() failed:', e.message);
            }
            
            // Método 3: Usar setActive no ChatCollection
            try {
                const CC = require('WAWebChatCollection');
                const chat = CC?.ChatCollection?.get(groupId);
                
                if (chat && CC?.ChatCollection?.setActive) {
                    console.log('[WHL] Usando ChatCollection.setActive...');
                    await CC.ChatCollection.setActive(chat);
                    await new Promise(r => setTimeout(r, 2000));
                    return true;
                }
            } catch (e) {
                console.warn('[WHL] setActive failed:', e.message);
            }
            
            // Método 4: Usar openChat via modelo
            try {

// ─── END 03-message-handlers.js ───

// ─── BEGIN 04-recover-helpers.js ───
/**
 * @file content/wpp-hooks-parts/04-recover-helpers.js
 * @description Slice 4501-5778 do wpp-hooks.js (refactor v9)
 * @lines 1278
 */

                const CC = require('WAWebChatCollection');
                const chat = CC?.ChatCollection?.get(groupId);
                
                if (chat) {
                    // Alguns builds têm select() ou activate()
                    if (typeof chat.select === 'function') {
                        await chat.select();
                        await new Promise(r => setTimeout(r, 2000));
                        return true;
                    }
                    
                    if (typeof chat.activate === 'function') {
                        await chat.activate();
                        await new Promise(r => setTimeout(r, 2000));
                        return true;
                    }
                }
            } catch (e) {
                console.warn('[WHL] Model methods failed:', e.message);
            }
            
            // Método 5: Fallback - buscar na sidebar (último recurso)
            console.log('[WHL] Tentando fallback: busca na sidebar...');
            const chatList = document.querySelector('#pane-side');
            if (chatList) {
                const allItems = chatList.querySelectorAll('[role="listitem"], [data-testid="cell-frame-container"]');
                const groupIdPrefix = groupId.split('@')[0];
                
                for (const item of allItems) {
                    const dataId = item.getAttribute('data-id') || '';
                    if (dataId.includes(groupId) || dataId.includes(groupIdPrefix)) {
                        console.log('[WHL] Grupo encontrado na sidebar, clicando...');
                        item.click();
                        await new Promise(r => setTimeout(r, 2000));
                        return true;
                    }
                }
                
                // Tentar scroll na sidebar para encontrar o grupo
                for (let i = 0; i < 10; i++) {
                    chatList.scrollTop += 500;
                    await new Promise(r => setTimeout(r, 300));
                    
                    const items = chatList.querySelectorAll('[role="listitem"], [data-testid="cell-frame-container"]');
                    for (const item of items) {
                        const dataId = item.getAttribute('data-id') || '';
                        if (dataId.includes(groupId) || dataId.includes(groupIdPrefix)) {
                            console.log('[WHL] Grupo encontrado após scroll, clicando...');
                            item.click();
                            await new Promise(r => setTimeout(r, 2000));
                            return true;
                        }
                    }
                }
            }
            
        } catch (e) {
            console.error('[WHL] Erro ao abrir chat:', e.message);
        }
        
        console.warn('[WHL] Não foi possível abrir o chat do grupo');
        return false;
    }
    
    /**
     * MANTER FUNÇÃO ANTIGA PARA COMPATIBILIDADE
     */
    async function extractGroupMembers(groupId) {
        return await extractGroupMembersUltra(groupId);
    }
    
    /**
     * Extração instantânea unificada - retorna tudo de uma vez
     * Usa WAWebChatCollection e WAWebBlocklistCollection via require()
     */
    function extrairTudoInstantaneo() {
        console.log('[WHL] 🚀 Iniciando extração instantânea via API interna...');
        
        const normal = extrairContatos();
        const archived = extrairArquivados();
        const blocked = extrairBloqueados();

        console.log(`[WHL] ✅ Extração completa: ${normal.count} normais, ${archived.count} arquivados, ${blocked.count} bloqueados`);

        return {
            success: true,
            normal: normal.contacts || [],
            archived: archived.archived || [],
            blocked: blocked.blocked || [],
            stats: {
                normal: normal.count || 0,
                archived: archived.count || 0,
                blocked: blocked.count || 0,
                total: (normal.count || 0) + (archived.count || 0) + (blocked.count || 0)
            }
        };
    }
    
    // ===== LISTENERS PARA NOVAS EXTRAÇÕES =====
    window.addEventListener('message', (event) => {
        // Validate origin and source for security (prevent cross-frame attacks)
        if (event.origin !== window.location.origin || event.source !== window) return;
        if (!event.data || !event.data.type) return;
        
        const { type } = event.data;
        
        if (type === 'WHL_EXTRACT_CONTACTS') {
            const result = extrairContatos();
            window.postMessage({ type: 'WHL_EXTRACT_CONTACTS_RESULT', ...result }, window.location.origin);
        }
        
        if (type === 'WHL_LOAD_GROUPS') {
            const result = extrairGrupos();
            window.postMessage({ type: 'WHL_LOAD_GROUPS_RESULT', ...result }, window.location.origin);
        }
        
        if (type === 'WHL_LOAD_ARCHIVED_BLOCKED') {
            const arquivados = extrairArquivados();
            const bloqueados = extrairBloqueados();
            
            window.postMessage({ 
                type: 'WHL_ARCHIVED_BLOCKED_RESULT', 
                archived: arquivados.archived || [],
                blocked: bloqueados.blocked || [],
                stats: {
                    archived: arquivados.count || 0,
                    blocked: bloqueados.count || 0
                }
            }, window.location.origin);
        }
        
        // EXTRAIR MEMBROS DO GRUPO
        if (type === 'WHL_EXTRACT_GROUP_MEMBERS') {
            const { groupId } = event.data;
            try {
                const CC = require('WAWebChatCollection');
                const chats = CC?.ChatCollection?.getModelsArray?.() || [];
                const chat = chats.find(c => c?.id?._serialized === groupId);
                const members = (chat?.groupMetadata?.participants || [])
                    .map(p => p?.id?._serialized)
                    .filter(Boolean)
                    .filter(id => id.endsWith('@c.us'))
                    .map(id => id.replace('@c.us', ''));
                
                window.postMessage({
                    type: 'WHL_GROUP_MEMBERS_RESULT',
                    groupId,
                    members: [...new Set(members)]
                }, window.location.origin);
            } catch (e) {
                window.postMessage({ type: 'WHL_GROUP_MEMBERS_ERROR', error: e.message }, window.location.origin);
            }
        }
        
        // PR #71: Listener para extrair membros por ID com código testado e validado
        if (type === 'WHL_EXTRACT_GROUP_MEMBERS_BY_ID') {
            const { groupId, requestId } = event.data;
            console.log('[WHL] Recebido pedido de extração de membros:', groupId);
            
            (async () => {
                try {
                    const result = await extractGroupMembers(groupId);
                    console.log('[WHL] Enviando resultado:', result);
                    window.postMessage({
                        type: 'WHL_EXTRACT_GROUP_MEMBERS_RESULT',
                        requestId,
                        ...result
                    }, window.location.origin);
                } catch (error) {
                    console.error('[WHL] Erro no listener:', error);
                    window.postMessage({
                        type: 'WHL_EXTRACT_GROUP_MEMBERS_RESULT',
                        requestId,
                        success: false,
                        error: error.message,
                        members: [],
                        count: 0
                    }, window.location.origin);
                }
            })();
        }
        
        if (type === 'WHL_EXTRACT_ALL') {
            const result = extrairTudo();
            window.postMessage({ type: 'WHL_EXTRACT_ALL_RESULT', ...result }, window.location.origin);
        }
        
        // RECOVER MESSAGES - Since hooks are automatic, just acknowledge
        if (type === 'WHL_RECOVER_ENABLE') {
            console.log('[WHL Hooks] Recover is always enabled with hooks approach');
        }
        
        if (type === 'WHL_RECOVER_DISABLE') {
            console.log('[WHL Hooks] Note: Recover hooks cannot be disabled once loaded');
        }
        
        // GET RECOVER HISTORY
        if (type === 'WHL_GET_RECOVER_HISTORY') {
            // Carregar do localStorage se array vazio
            if (historicoRecover.length === 0) {
                try {
                    const saved = localStorage.getItem('whl_recover_history');
                    if (saved) {
                        const parsed = JSON.parse(saved);
                        historicoRecover.push(...parsed);
                    }
                } catch(e) {
                    console.warn('[WHL] Erro ao carregar histórico:', e);
                }
            }
            
            window.postMessage({
                type: 'WHL_RECOVER_HISTORY_RESULT',
                history: historicoRecover,
                total: historicoRecover.length
            }, window.location.origin);
        }
        
        // CLEAR RECOVER HISTORY
        if (type === 'WHL_CLEAR_RECOVER_HISTORY') {
            historicoRecover.length = 0;
            localStorage.removeItem('whl_recover_history');
            window.postMessage({ type: 'WHL_RECOVER_HISTORY_CLEARED' }, window.location.origin);
        }
    });
    
    // ===== LISTENERS FOR SEND FUNCTIONS =====
    window.addEventListener('message', async (event) => {
        // Validate origin and source for security (prevent cross-frame attacks)
        if (event.origin !== window.location.origin || event.source !== window) return;
        if (!event.data) return;
        
        // Enviar apenas TEXTO
        if (event.data.type === 'WHL_SEND_MESSAGE_API') {
            const { phone, message, requestId } = event.data;
            const result = await enviarMensagemAPI(phone, message);
            window.postMessage({ type: 'WHL_SEND_MESSAGE_API_RESULT', requestId, ...result }, window.location.origin);
        }
        
        // Enviar apenas IMAGEM
        if (event.data.type === 'WHL_SEND_IMAGE_DOM') {
            const { base64Image, caption, requestId } = event.data;
            const result = await enviarImagemDOM(base64Image, caption);
            window.postMessage({ type: 'WHL_SEND_IMAGE_DOM_RESULT', requestId, ...result }, window.location.origin);
        }
        
        // CORREÇÃO BUG 2: Enviar IMAGEM para número específico (abre o chat primeiro)
        if (event.data.type === 'WHL_SEND_IMAGE_TO_NUMBER') {
            const { phone, image, caption, requestId } = event.data;
            (async () => {
                try {
                    const result = await enviarImagemParaNumero(phone, image, caption);
                    window.postMessage({
                        type: 'WHL_SEND_IMAGE_TO_NUMBER_RESULT',
                        requestId,
                        ...result
                    }, window.location.origin);
                } catch (error) {
                    window.postMessage({
                        type: 'WHL_SEND_IMAGE_TO_NUMBER_ERROR',
                        requestId,
                        error: error.message
                    }, window.location.origin);
                }
            })();
        }
        
        // Enviar TEXTO + IMAGEM
        if (event.data.type === 'WHL_SEND_COMPLETE') {
            const { phone, texto, base64Image, caption, requestId } = event.data;
            const result = await enviarMensagemCompleta(phone, texto, base64Image, caption);
            window.postMessage({ type: 'WHL_SEND_COMPLETE_RESULT', requestId, ...result }, window.location.origin);
        }
        
        // EXTRAIR MEMBROS DE GRUPO VIA DOM
        if (event.data.type === 'WHL_EXTRACT_GROUP_CONTACTS_DOM') {
            const { requestId, groupId } = event.data;
            (async () => {
                try {
                    const result = await extractGroupContacts(groupId);
                    window.postMessage({ 
                        type: 'WHL_EXTRACT_GROUP_CONTACTS_DOM_RESULT', 
                        requestId, 
                        ...result 
                    }, window.location.origin);
                } catch (error) {
                    window.postMessage({ 
                        type: 'WHL_EXTRACT_GROUP_CONTACTS_DOM_ERROR', 
                        requestId, 
                        error: error.message 
                    }, window.location.origin);
                }
            })();
        }
        
        // EXTRAIR ARQUIVADOS E BLOQUEADOS
        if (event.data.type === 'WHL_EXTRACT_ARCHIVED_BLOCKED_DOM') {
            const { requestId } = event.data;
            (async () => {
                try {
                    const result = await extrairArquivadosBloqueadosDOM();
                    window.postMessage({ 
                        type: 'WHL_EXTRACT_ARCHIVED_BLOCKED_DOM_RESULT', 
                        requestId,
                        ...result,
                        success: true
                    }, window.location.origin);
                } catch (error) {
                    window.postMessage({ 
                        type: 'WHL_EXTRACT_ARCHIVED_BLOCKED_DOM_ERROR', 
                        requestId, 
                        error: error.message 
                    }, window.location.origin);
                }
            })();
        }
        
        // Listener para aguardar confirmação visual
        if (event.data.type === 'WHL_WAIT_VISUAL_CONFIRMATION') {
            const { message, timeout, requestId } = event.data;
            (async () => {
                try {
                    const result = await aguardarConfirmacaoVisual(message, timeout || 10000);
                    window.postMessage({ 
                        type: 'WHL_VISUAL_CONFIRMATION_RESULT', 
                        requestId,
                        ...result
                    }, window.location.origin);
                } catch (error) {
                    window.postMessage({ 
                        type: 'WHL_VISUAL_CONFIRMATION_ERROR', 
                        requestId, 
                        error: error.message 
                    }, window.location.origin);
                }
            })();
        }
    });
    
    // ===== MESSAGE LISTENERS PARA API DIRETA =====
    window.addEventListener('message', async (event) => {
        // Validate origin and source for security (prevent cross-frame attacks)
        if (event.origin !== window.location.origin || event.source !== window) return;
        if (!event.data || !event.data.type) return;
        
        const { type } = event.data;
        
        // ENVIAR MENSAGEM DE TEXTO DIRETAMENTE
        if (type === 'WHL_SEND_MESSAGE_DIRECT') {
            const { phone, message, useTyping } = event.data;
            try {
                let success;
                if (useTyping) {
                    success = await sendWithTypingIndicator(phone, message);
                } else {
                    success = await sendMessageDirect(phone, message);
                }
                
                window.postMessage({ 
                    type: 'WHL_SEND_MESSAGE_RESULT', 
                    success, 
                    phone 
                }, window.location.origin);
            } catch (error) {
                window.postMessage({ 
                    type: 'WHL_SEND_MESSAGE_RESULT', 
                    success: false, 
                    phone, 
                    error: error.message 
                }, window.location.origin);
            }
        }
        
        // ENVIAR IMAGEM DIRETAMENTE
        if (type === 'WHL_SEND_IMAGE_DIRECT') {
            const { phone, imageData, caption } = event.data;
            try {
                const success = await sendImageDirect(phone, imageData, caption);
                window.postMessage({ 
                    type: 'WHL_SEND_IMAGE_RESULT', 
                    success, 
                    phone 
                }, window.location.origin);
            } catch (error) {
                window.postMessage({ 
                    type: 'WHL_SEND_IMAGE_RESULT', 
                    success: false, 
                    phone, 
                    error: error.message 
                }, window.location.origin);
            }
        }
        

        // ENVIAR ÁUDIO DIRETAMENTE (como mensagem de voz)
        if (type === 'WHL_SEND_AUDIO_DIRECT') {
            // Compat: algumas versões usam audioDataUrl; manter suporte
            const { phone, audioData, audioDataUrl, filename, text } = event.data;
            try {
                const success = await sendAudioDirect(phone, audioData || audioDataUrl, filename, text);
                window.postMessage({ 
                    type: 'WHL_SEND_AUDIO_RESULT', 
                    success, 
                    phone 
                }, window.location.origin);
            } catch (error) {
                window.postMessage({ 
                    type: 'WHL_SEND_AUDIO_RESULT', 
                    success: false, 
                    phone, 
                    error: error.message 
                }, window.location.origin);
            }
        }
        
        // ENVIAR ARQUIVO/DOCUMENTO DIRETAMENTE
        if (type === 'WHL_SEND_FILE_DIRECT') {
            const { phone, fileData, filename, caption, text } = event.data;
            try {
                const success = await sendFileDirect(phone, fileData, filename, caption, text);
                window.postMessage({ 
                    type: 'WHL_SEND_FILE_RESULT', 
                    success, 
                    phone 
                }, window.location.origin);
            } catch (error) {
                window.postMessage({ 
                    type: 'WHL_SEND_FILE_RESULT', 
                    success: false, 
                    phone, 
                    error: error.message 
                }, window.location.origin);
            }
        }

                // EXTRAIR TODOS OS CONTATOS DIRETAMENTE
        if (type === 'WHL_EXTRACT_ALL_DIRECT') {
            try {
                const result = extractAllContactsDirect();
                window.postMessage({ 
                    type: 'WHL_EXTRACT_ALL_RESULT', 
                    ...result 
                }, window.location.origin);
            } catch (error) {
                window.postMessage({ 
                    type: 'WHL_EXTRACT_ALL_ERROR', 
                    error: error.message 
                }, window.location.origin);
            }
        }
        
        // EXTRAÇÃO INSTANTÂNEA (novo método alternativo)
        if (type === 'WHL_EXTRACT_INSTANT') {
            try {
                const result = extrairContatosInstantaneo();
                window.postMessage({ 
                    type: 'WHL_EXTRACT_INSTANT_RESULT', 
                    ...result 
                }, window.location.origin);
            } catch (error) {
                window.postMessage({ 
                    type: 'WHL_EXTRACT_INSTANT_ERROR', 
                    error: error.message 
                }, window.location.origin);
            }
        }
        
        // EXTRAÇÃO COMPLETA INSTANTÂNEA (contatos, arquivados, bloqueados)
        if (type === 'WHL_EXTRACT_ALL_INSTANT') {
            const { requestId } = event.data;
            (async () => {
                try {
                    const result = extrairTudoInstantaneo();
                    window.postMessage({
                        type: 'WHL_EXTRACT_ALL_INSTANT_RESULT',
                        requestId,
                        ...result
                    }, window.location.origin);
                } catch (error) {
                    window.postMessage({
                        type: 'WHL_EXTRACT_ALL_INSTANT_ERROR',
                        requestId,
                        error: error.message
                    }, window.location.origin);
                }
            })();
        }
    });

    // ===== GUARD GLOBAL PARA HANDLER DE MÍDIA =====
    if (!window.__WHL_SEND_MEDIA_HANDLER_REGISTERED__) {
        window.__WHL_SEND_MEDIA_HANDLER_REGISTERED__ = true;
        
        window.addEventListener('message', async (event) => {
            if (event.data?.type !== 'WHL_SEND_MEDIA') return;
            if (event.origin !== window.location.origin) return;
            
            const { messageId, chatId, media } = event.data;
            console.log('[WHL Hooks] 📤 WHL_SEND_MEDIA recebido:', media?.type, 'para:', chatId);
            
            let success = false;
            const phoneNumber = chatId.replace('@c.us', '').replace('@s.whatsapp.net', '');
            
            try {
                // Aguardar módulos
                await ensureModulesReady(3000);
                
                if (media.type === 'audio') {
                    success = await sendAudioDirect(phoneNumber, media.data, media.filename || 'audio.ogg');
                } else if (media.type === 'document' || media.type === 'file') {
                    success = await sendFileDirect(phoneNumber, media.data, media.filename || 'document', '');
                } else if (media.type === 'image') {
                    success = await sendImageDirect(phoneNumber, media.data, media.caption || '');
                } else {
                    // Fallback genérico
                    success = await sendFileDirect(phoneNumber, media.data, media.filename || 'file', '');
                }
            } catch (e) {
                console.error('[WHL Hooks] ❌ Erro no WHL_SEND_MEDIA:', e);
            }
            
            // Responder ao content script
            window.postMessage({
                type: 'WHL_MEDIA_SENT',
                messageId: messageId,
                success: success
            }, window.location.origin);
        });
        
        console.log('[WHL Hooks] ✅ WHL_SEND_MEDIA handler registrado');
    }

    // ===== EXTRAÇÃO INSTANTÂNEA =====
    window.addEventListener('message', (event) => {
        // Validate origin and source for security (prevent cross-frame attacks)
        if (event.origin !== window.location.origin || event.source !== window) return;
        if (event.data?.type !== 'WHL_EXTRACT_INSTANT') return;
        
        try {
            const CC = require('WAWebChatCollection');
            const ContactC = require('WAWebContactCollection');
            const chats = CC?.ChatCollection?.getModelsArray?.() || [];
            const contacts = ContactC?.ContactCollection?.getModelsArray?.() || [];

            const phoneFromId = (id) => (id?._serialized || '').replace('@c.us', '');
            const nums = new Set();

            chats.forEach(c => {
                const id = phoneFromId(c?.id);
                if (/^\d{8,15}$/.test(id)) nums.add(id);
            });
            
            contacts.forEach(ct => {
                const id = phoneFromId(ct?.id);
                if (/^\d{8,15}$/.test(id)) nums.add(id);
            });

            console.log(`[WHL Hooks] Extração instantânea: ${nums.size} números`);
            window.postMessage({ type: 'WHL_EXTRACT_INSTANT_RESULT', numbers: [...nums] }, window.location.origin);
        } catch (e) {
            console.error('[WHL Hooks] Erro na extração instantânea:', e);
            window.postMessage({ type: 'WHL_EXTRACT_INSTANT_ERROR', error: e.message }, window.location.origin);
        }
    });
    
    // ===== FASE 4: MESSAGE HANDLERS FOR SNAPSHOT AND DEEP SCAN =====
    window.addEventListener('message', async (event) => {
        if (event.origin !== window.location.origin || event.source !== window) return;
        
        if (event.data?.type === 'performSnapshot' || event.data?.action === 'performSnapshot') {
            try {
                const result = await performInitialSnapshot();
                window.postMessage({ type: 'WHL_SNAPSHOT_RESULT', ...result }, window.location.origin);
            } catch (e) {
                console.error('[WHL Hooks] Snapshot error:', e);
                window.postMessage({ type: 'WHL_SNAPSHOT_RESULT', success: false, error: e.message }, window.location.origin);
            }
        }
        
        if (event.data?.type === 'performDeepScan' || event.data?.action === 'performDeepScan') {
            try {
                const options = event.data?.options || {};
                const result = await performDeepScan(options);
                window.postMessage({ type: 'WHL_DEEP_SCAN_RESULT', ...result }, window.location.origin);
            } catch (e) {
                console.error('[WHL Hooks] Deep scan error:', e);
                window.postMessage({ type: 'WHL_DEEP_SCAN_RESULT', success: false, error: e.message }, window.location.origin);
            }
        }

        // ✅ Recover: abrir chat, localizar mensagem e baixar o item REAL do chat
        // (mídia em tamanho real; texto como .txt)
        if (event.data?.type === 'WHL_DOWNLOAD_DELETED_MEDIA') {
            console.log('[WHL Hooks] 📥 Recover download: iniciando navegação e download...');

            try {
                const { messageId, chatId } = event.data || {};
                if (!messageId || !chatId) {
                    throw new Error('messageId ou chatId não fornecido');
                }

                const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                const log = (...a) => console.log('[WHL Hooks][RecoverDownload]', ...a);
                const warn = (...a) => console.warn('[WHL Hooks][RecoverDownload]', ...a);

                const normalizeChatId = (raw) => {
                    const s = String(raw || '').trim();
                    if (!s) return '';
                    if (s.includes('@')) return s;
                    const clean = s.replace(/\D/g, '');
                    if (clean) return clean + '@c.us';
                    return s;
                };

                // 1) Abrir o chat alvo (robusto)
                const ChatCollection = tryRequireModule('WAWebChatCollection');
                const ChatModel = tryRequireModule('WAWebChatModel');
                const WidFactory = tryRequireModule('WAWebWidFactory');
                const Cmd = tryRequireModule('WAWebCmd');

                const chatIdStr = normalizeChatId(chatId);
                const phoneClean = (chatIdStr.split('@')[0] || '').replace(/\D/g, '');
                let targetChat = null;

                try {
                    if (ChatCollection?.ChatCollection && WidFactory?.createWid) {
                        const wid = WidFactory.createWid(chatIdStr);
                        targetChat = ChatCollection.ChatCollection.get(wid);
                        if (!targetChat && ChatModel?.Chat) {
                            targetChat = new ChatModel.Chat({ id: wid });
                            ChatCollection.ChatCollection.add(targetChat);
                        }
                    }
                } catch (e) {
                    warn('Falha ao resolver chat via ChatCollection/WidFactory:', e?.message);
                }

                // 1.1) Tentar abrir via API interna (preferido)
                let opened = false;

                // 1) Tentar API interna (preferido)
                try {
                    const NAV = window.require?.('WAWebNavigateToChat');
                    const CC = window.require?.('WAWebChatCollection');

                    if (Cmd?.openChatAt) {
                        log('Abrindo via API interna: Cmd.openChatAt(chat)');
                        await Cmd.openChatAt(targetChat);
                        await sleep(1200);
                        opened = true;
                    } else if (Cmd?.openChat) {
                        log('Abrindo via API interna: Cmd.openChat(chat)');
                        await Cmd.openChat(targetChat);
                        await sleep(1200);
                        opened = true;
                    } else if (Cmd?.openChatFromWid && targetChat?.id) {
                        log('Abrindo via API interna: Cmd.openChatFromWid(chat.id)');
                        await Cmd.openChatFromWid(targetChat.id);
                        await sleep(1200);
                        opened = true;
                    } else if (typeof targetChat?.open === 'function') {
                        log('Abrindo via targetChat.open()');
                        await targetChat.open();
                        await sleep(1200);
                        opened = true;
                    } else if (CC?.ChatCollection?.setActive) {
                        log('Abrindo via ChatCollection.setActive(chat)');
                        await CC.ChatCollection.setActive(targetChat);
                        await sleep(1200);
                        opened = true;
                    } else if (NAV?.navigateToChat && targetChat?.id) {
                        log('Abrindo via NavigateToChat.navigateToChat(chat.id)');
                        await NAV.navigateToChat(targetChat.id);
                        await sleep(1200);
                        opened = true;
                    } else {
                        warn('Nenhum método interno disponível para abrir chat nesta build.');
                    }
                } catch (e) {
                    warn('API interna não conseguiu abrir chat:', e?.message);
                }

                // 2) Fallback URL (contatos) — mesma estratégia do seu script de teste
                const canUrlFallback =
                    !opened &&
                    phoneClean &&
                    (chatIdStr.endsWith('@c.us') || chatIdStr.endsWith('@lid') || /^\d{8,15}$/.test(phoneClean));

                if (canUrlFallback) {
                    try {
                        const targetUrl = `https://web.whatsapp.com/send?phone=${phoneClean}`;
                        log('Fallback URL:', targetUrl);
                        const link = document.createElement('a');
                        link.href = targetUrl;
                        link.target = '_self';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        await sleep(3500);
                        opened = true;
                    } catch (e) {
                        warn('Fallback URL falhou:', e?.message);
                    }
                }

                if (!opened) {
                    warn('Não foi possível garantir abertura do chat. Prosseguindo mesmo assim...');
                }

                // Marcar como visto
                try { await targetChat?.sendSeen?.(); } catch (_) {}

                // 3) Tentar ir até a mensagem
                try {
                    if (window.Store?.Cmd?.scrollToMsg) {
                        await window.Store.Cmd.scrollToMsg(messageId);
                    }
                } catch (e) {
                    console.warn('[WHL Hooks] ⚠️ scrollToMsg falhou:', e?.message);
                }
                await new Promise(r => setTimeout(r, 700));

                // 3.1) ✅ MÉTODO UNIVERSAL (prioridade): download via UI do WhatsApp (não baixa miniatura)
                // Estratégia: localizar marcador de "mensagem apagada/editada" (ou o mais próximo do centro da viewport)
                // e baixar o item REAL imediatamente acima (imagem/vídeo via preview; áudio/doc via ícone/link; texto via .txt)
                const tryUniversalDownloadViaUI = async () => {
                    const logUI = (...a) => console.log('[WHL Hooks][RecoverDownload][UI]', ...a);

                    const markerSelectors = [
                        '[data-testid="recalled-msg"]',
                        'span[data-icon="recalled"]',
                        'span[data-icon="revoked"]',
                        'span[data-icon*="recalled"]',
                        'span[data-icon*="revoked"]',
                        'span[data-icon*="edited"]'
                    ];

                    // 1) Tenta localizar um marcador associado ao messageId (quando presente no DOM)
                    let marker = null;
                    try {
                        if (messageId) {
                            const rowById = document.querySelector(`[data-id*="${CSS.escape(String(messageId))}"]`);
                            if (rowById) {
                                for (const sel of markerSelectors) {
                                    const m = rowById.querySelector(sel);
                                    if (m) { marker = m; break; }
                                }
                            }
                        }
                    } catch (_) {}

                    // 2) Fallback: pega o marcador mais próximo do centro da tela (útil após scrollToMsg)
                    if (!marker) {
                        const allMarkers = markerSelectors
                            .map(sel => Array.from(document.querySelectorAll(sel)))
                            .flat()
                            .filter(Boolean);

                        if (!allMarkers.length) {
                            logUI('❌ Nenhum marcador (recalled/edited) encontrado no chat visível');
                            return { ok: false, reason: 'NO_MARKER' };
                        }

                        const centerY = window.innerHeight / 2;
                        marker = allMarkers.reduce((best, el) => {
                            const r = el.getBoundingClientRect();
                            const d = Math.abs((r.top + r.bottom) / 2 - centerY);
                            if (!best) return { el, d };
                            return d < best.d ? { el, d } : best;
                        }, null)?.el;
                    }

                    if (!marker) return { ok: false, reason: 'NO_MARKER_PICKED' };

                    const markerRect = marker.getBoundingClientRect();
                    const allRows = Array.from(document.querySelectorAll('[data-id^="true_"], [data-id^="false_"]'));
                    if (!allRows.length) {
                        logUI('❌ Nenhum row data-id true_/false_ encontrado');
                        return { ok: false, reason: 'NO_ROWS' };
                    }
                    allRows.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

                    let closestIdx = -1;
                    let closestDistance = Infinity;
                    allRows.forEach((row, idx) => {
                        const distance = Math.abs(markerRect.top - row.getBoundingClientRect().top);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestIdx = idx;
                        }
                    });

                    if (closestIdx < 0) return { ok: false, reason: 'NO_CLOSEST_IDX' };

                    let prevRow = null;
                    for (let i = closestIdx - 1; i >= 0; i--) {
                        const row = allRows[i];
                        const icons = row.querySelectorAll('span[data-icon]');
                        const hasContent = row.querySelector('img, video, [data-testid="selectable-text"], span[dir="ltr"], span[dir="auto"], a[download]');
                        if ((icons && icons.length > 0) || hasContent) {
                            prevRow = row;
                            break;
                        }
                    }

                    if (!prevRow) {
                        logUI('❌ Não encontrou row anterior com conteúdo');
                        return { ok: false, reason: 'NO_PREV_ROW' };
                    }

                    // UX: destacar
                    try {
                        prevRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        prevRow.style.border = '3px solid #fbbf24';
                        prevRow.style.background = 'rgba(251, 191, 36, 0.2)';
                        setTimeout(() => {
                            try { prevRow.style.border = ''; prevRow.style.background = ''; } catch (_) {}
                        }, 3500);
                    } catch (_) {}

                    const icons = Array.from(prevRow.querySelectorAll('span[data-icon]')).map(e => e.getAttribute('data-icon') || '');
                    const hasImg = prevRow.querySelector('img[src^="blob:"], img[src^="data:"]');
                    const hasVideoElement = prevRow.querySelector('video');
                    const hasVideoIcon = icons.some(i => i.includes('video') || i.includes('media-play'));
                    const hasTextEl = prevRow.querySelector('[data-testid="selectable-text"], span[dir="ltr"], span[dir="auto"]');
                    const hasAudioIcon = icons.some(i => i.includes('audio'));
                    const hasDocIcon = icons.some(i => i.includes('document') || i.includes('doc'));

                    let downloaded = false;
                    let tipo = '';

                    // Aux: baixar via preview (imagem/vídeo)
                    async function downloadViaPreview(clickTarget, tipoNome) {
                        tipo = tipoNome;
                        logUI(tipo, '- Abrindo preview...');
                        clickTarget.click();
                        await sleep(2800);

                        const downloadIcon = document.querySelector('span[data-icon="ic-download"], span[data-icon="download"], span[data-icon*="download"]');
                        if (downloadIcon) {
                            const btn = downloadIcon.closest('div[role="button"]') || downloadIcon.closest('button') || downloadIcon.parentElement;
                            if (btn) {
                                btn.click();
                                downloaded = true;
                                logUI('✅ Download iniciado:', tipoNome);
                            }
                        }

                        await sleep(1500);
                        const closeIcon = document.querySelector('span[data-icon="ic-close"], span[data-icon*="close"], span[data-icon="x-viewer"]');
                        if (closeIcon) {
                            const closeBtn = closeIcon.closest('div[role="button"]') || closeIcon.closest('button') || closeIcon.parentElement;
                            if (closeBtn) closeBtn.click();
                        }
                    }

                    // 1) VÍDEO
                    if ((hasVideoIcon || hasVideoElement) && !downloaded) {
                        const videoThumb =
                            prevRow.querySelector('img[src^="blob:"], img[src^="data:"]') ||
                            prevRow.querySelector('video') ||
                            prevRow.querySelector('span[data-icon="media-play"]')?.closest('div[role="button"], button') ||
                            prevRow.querySelector('span[data-icon="media-play"]')?.parentElement;
                        if (videoThumb) await downloadViaPreview(videoThumb, '🎬 VÍDEO');
                    }

                    // 2) IMAGEM
                    if (hasImg && !hasVideoIcon && !downloaded) {
                        await downloadViaPreview(hasImg, '🖼️ IMAGEM');
                    }

                    // 3) ÁUDIO / DOCUMENTO (tenta download direto)
                    if ((hasAudioIcon || hasDocIcon) && !downloaded) {
                        tipo = hasAudioIcon ? '🎤 ÁUDIO' : '📄 DOCUMENTO';
                        logUI(tipo, '- Procurando download direto...');

                        const directIcon =
                            prevRow.querySelector('span[data-icon="audio-download"], span[data-icon="document-download"], span[data-icon*="download"]');
                        if (directIcon) {
                            const clickable = directIcon.closest('button') || directIcon.closest('div[role="button"]') || directIcon.parentElement;
                            if (clickable) {
                                clickable.click();
                                downloaded = true;
                                logUI('✅ Download iniciado (direto):', tipo);
                            }
                        }

                        if (!downloaded) {
                            const link = prevRow.querySelector('a[download][href^="blob:"], a[download][href^="https:"], a[download][href^="http:"]');
                            if (link) {
                                const a = document.createElement('a');
                                a.href = link.href;
                                a.download = link.getAttribute('download') || (hasAudioIcon ? 'audio.ogg' : 'arquivo');
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                downloaded = true;
                                logUI('✅ Download via link:', tipo);
                            }
                        }
                    }

                    // 4) TEXTO
                    if (hasTextEl && !downloaded && !hasImg && !hasVideoIcon && !hasAudioIcon && !hasDocIcon) {
                        tipo = '📝 TEXTO';
                        const textContent = (hasTextEl.textContent || '').trim();
                        if (textContent) {
                            try {
                                const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
                                const a = document.createElement('a');
                                a.href = URL.createObjectURL(blob);
                                a.download = `mensagem_${Date.now()}.txt`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                downloaded = true;
                                logUI('✅ Texto baixado como arquivo');
                            } catch (e) {
                                warn('Falha ao baixar texto:', e?.message);
                            }
                        }
                    }

                    if (!downloaded) {
                        logUI('⚠️ Não foi possível baixar via UI. Ícones:', icons);
                        return { ok: false, reason: 'UI_DOWNLOAD_FAILED' };
                    }

                    logUI('🎉 Download via UI OK:', tipo);
                    return { ok: true, tipo };
                };

                const uiResult = await tryUniversalDownloadViaUI();
                if (uiResult?.ok) {
                    window.postMessage({
                        type: 'WHL_DOWNLOAD_DELETED_MEDIA_RESULT',
                        success: true,
                        method: 'ui',
                        kind: uiResult.tipo || 'unknown'
                    }, window.location.origin);
                    return;
                }
                warn('UI download não conseguiu (fallback para Store):', uiResult?.reason);

                // Helpers (resolver ID real do item para download)
                const extractHexId = (value) => {
                    if (!value) return null;
                    const m = String(value).match(/[A-F0-9]{16,}/i);
                    return m ? m[0] : null;
                };

                const resolveMsg = (id) => {
                    if (!id) return null;
                    const idStr = String(id);
                    const arr = targetChat?.msgs?.getModelsArray?.() || [];
                    const found = arr.find(m => {
                        const mid = m?.id?.id || m?.id?._serialized;
                        if (!mid) return false;
                        const midStr = String(mid);
                        return midStr === idStr || midStr.includes(idStr) || (m?.id?._serialized && String(m.id._serialized).includes(idStr));
                    }) || targetChat?.msgs?.get?.(idStr) || null;
                    return found || null;
                };

                const isRecoverProtocolBubble = (el) => {
                    const t = (el?.innerText || '').toString();
                    return t.includes('Esta mensagem foi excluída') ||
                           t.includes('Esta mensagem foi editada') ||
                           t.includes('🚫') ||
                           t.includes('✏️');
                };

                // 4) Encontrar a mensagem no modelo (e resolver o ID real da mídia)
                let chatMsg = resolveMsg(messageId) || findMessageById(messageId);
                let targetMessageId = messageId;
                let targetEl = null;

                // 4.1) Tentativa DOM: se for uma "mensagem de sistema" (revogada/editada), baixar o item imediatamente acima
                try {
                    let el = document.querySelector(`[data-id="${messageId}"]`) ||
                             document.querySelector(`[data-id*="${messageId}"]`);
                    if (el) {
                        const bubble = el.closest('[data-testid="msg-container"]') || el;
                        let targetBubble = bubble;

                        const findMsgContainer = (node) => {
                            if (!node) return null;
                            if (node.matches && node.matches('[data-testid="msg-container"]')) return node;
                            return node.querySelector ? node.querySelector('[data-testid="msg-container"]') : null;
                        };

                        if (isRecoverProtocolBubble(bubble)) {
                            let prev = bubble.previousElementSibling;
                            while (prev && !findMsgContainer(prev)) {
                                prev = prev.previousElementSibling;
                            }
                            const prevContainer = findMsgContainer(prev);
                            if (prevContainer) {
                                targetBubble = prevContainer;
                            }
                        }

                        const dataId = targetBubble.getAttribute('data-id') || targetBubble.closest('[data-id]')?.getAttribute('data-id');
                        const extracted = extractHexId(dataId) || (dataId ? dataId.split('_').pop() : null);
                        if (extracted) {
                            targetMessageId = extracted;
                        }
                        targetEl = targetBubble;
                    }
                } catch (e) {
                    console.warn('[WHL Hooks] ⚠️ Falha ao resolver mensagem via DOM:', e?.message);
                }

                // 4.2) Se a mensagem encontrada tiver quotedStanzaID, tentar usar como ID alvo (compat com histórico antigo)
                try {
                    const quoted = chatMsg?.quotedStanzaID || chatMsg?.__x_quotedStanzaID;
                    const qid = extractHexId(quoted) || (quoted ? String(quoted) : null);
                    if (qid && qid !== targetMessageId) {
                        if (targetMessageId === messageId) {
                            targetMessageId = qid;
                        }
                    }
                } catch (_) {}

                // 4.3) Resolver a mensagem alvo final
                const targetMsg = resolveMsg(targetMessageId) || findMessageById(targetMessageId) || chatMsg;
                if (!targetMsg) {
                    throw new Error('Mensagem não encontrada no chat');
                }
                chatMsg = targetMsg;

                // 5) Destacar no DOM (melhor UX) e garantir que está visível
                try {
                    if (window.Store?.Cmd?.scrollToMsg && targetMessageId && targetMessageId !== messageId) {
                        try { await window.Store.Cmd.scrollToMsg(targetMessageId); } catch (_) {}
                    }
                    if (targetEl) {
                        targetEl.scrollIntoView({ block: 'center' });
                        targetEl.style.outline = '2px solid rgba(16,185,129,0.85)';
                        setTimeout(() => { try { targetEl.style.outline = ''; } catch (_) {} }, 2000);
                    } else {
                        let el = document.querySelector(`[data-id*="${targetMessageId}"]`);
                        if (el) {
                            const bubble = el.closest('[data-testid="msg-container"]') || el;
                            bubble.scrollIntoView({ block: 'center' });
                            bubble.style.outline = '2px solid rgba(16,185,129,0.85)';
                            setTimeout(() => { try { bubble.style.outline = ''; } catch (_) {} }, 2000);
                        }
                    }
                } catch (_) {}

                // 6) Se não for mídia, baixar texto como .txt
                const msgType = (chatMsg.type || chatMsg.__x_type || '').toString();
                const textBody = (chatMsg.body || chatMsg.caption || chatMsg.__x_body || '').toString();
                const looksLikeMedia = !!(chatMsg.mediaData || chatMsg.isMedia || ['image','video','audio','ptt','sticker','document'].includes(msgType));

                if (!looksLikeMedia) {
                    if (!textBody) {
                        throw new Error('Mensagem sem mídia e sem texto');
                    }
                    const blobTxt = new Blob([textBody], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blobTxt);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `recover_${Date.now()}_mensagem.txt`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 2000);

                    window.postMessage({
                        type: 'WHL_DOWNLOAD_DELETED_MEDIA_RESULT',
                        success: true
                    }, window.location.origin);
                    return;
                }

                // 7) Baixar mídia REAL (tamanho real) usando DownloadManager quando disponível
                let blob = null;
                try {
                    if (window.Store?.DownloadManager?.downloadMedia) {
                        blob = await window.Store.DownloadManager.downloadMedia(chatMsg);
                    }
                } catch (e) {
                    console.warn('[WHL Hooks] ⚠️ DownloadManager.downloadMedia falhou:', e?.message);
                }
                if (!blob) {
                    try {
                        if (chatMsg.downloadMedia) {
                            blob = await chatMsg.downloadMedia();
                        }
                    } catch (e) {
                        console.warn('[WHL Hooks] ⚠️ chatMsg.downloadMedia falhou:', e?.message);
                    }
                }
                if (!blob && chatMsg.mediaData?.getBuffer) {
                    try {
                        const buffer = await chatMsg.mediaData.getBuffer();
                        if (buffer) {
                            const mt = chatMsg.mimetype || chatMsg.mediaData?.mimetype || 'application/octet-stream';
                            blob = new Blob([buffer], { type: mt });
                        }
                    } catch (e) {
                        console.warn('[WHL Hooks] ⚠️ mediaData.getBuffer falhou:', e?.message);
                    }
                }

                if (!blob) {
                    throw new Error('Não foi possível obter a mídia real desta mensagem');
                }

                const filename = chatMsg.filename || chatMsg.mediaData?.filename || `recover_${Date.now()}`;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);

                console.log('[WHL Hooks] ✅ Download disparado:', filename, blob?.type, blob?.size);
                window.postMessage({
                    type: 'WHL_DOWNLOAD_DELETED_MEDIA_RESULT',
                    success: true
                }, window.location.origin);

            } catch (e) {
                console.error('[WHL Hooks] Download error:', e);
                window.postMessage({
                    type: 'WHL_DOWNLOAD_DELETED_MEDIA_RESULT',
                    success: false,
                    error: e.message
                }, window.location.origin);
            }
        }

        // ✅ Re-download sob demanda usando directPath/Store quando base64 não está disponível
        if (event.data?.type === 'WHL_RECOVER_REDOWNLOAD') {
            (async () => {
                try {
                    const { messageId, chatId, directPath, mediaKey, mimetype, filename } = event.data || {};
                    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

                    // Tentar resolver a mensagem pelo modelo do Store
                    const normalizeChatId = (raw) => {
                        const s = String(raw || '').trim();
                        if (!s) return '';
                        if (s.includes('@')) return s;
                        const clean = s.replace(/\D/g, '');
                        return clean ? clean + '@c.us' : s;
                    };

                    const chatIdStr = normalizeChatId(chatId);
                    let blob = null;

                    // Estratégia 1: Resolver pelo modelo de chat e usar DownloadManager
                    try {
                        const ChatCollection = window.require?.('WAWebChatCollection')?.ChatCollection;
                        const WidFactory = window.require?.('WAWebWidFactory');
                        if (ChatCollection && WidFactory?.createWid) {
                            const wid = WidFactory.createWid(chatIdStr);
                            const chat = ChatCollection.get(wid);
                            if (chat) {
                                const msgs = chat.msgs?.getModelsArray?.() || [];
                                const targetMsg = msgs.find(m => {
                                    const mid = String(m?.id?.id || m?.id?._serialized || '');
                                    return mid === String(messageId) || mid.includes(String(messageId));
                                });
                                if (targetMsg && window.Store?.DownloadManager?.downloadMedia) {
                                    const media = await window.Store.DownloadManager.downloadMedia(targetMsg);
                                    if (media instanceof Blob) blob = media;
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('[WHL Hooks] Re-download via Store falhou:', e?.message);
                    }

                    if (!blob) {
                        window.postMessage({ type: 'WHL_RECOVER_REDOWNLOAD_RESULT', success: false, error: 'Mídia não disponível no Store' }, window.location.origin);
                        return;
                    }

                    // Converter Blob → base64 e notificar sidepanel
                    const reader = new FileReader();
                    const base64 = await new Promise((res, rej) => {
                        reader.onload = () => res(reader.result);
                        reader.onerror = rej;
                        reader.readAsDataURL(blob);
                    });

                    window.postMessage({
                        type: 'WHL_RECOVER_REDOWNLOAD_RESULT',
                        success: true,
                        base64,
                        messageId,
                        filename: filename || `recover_${Date.now()}`
                    }, window.location.origin);

                } catch (e) {
                    window.postMessage({ type: 'WHL_RECOVER_REDOWNLOAD_RESULT', success: false, error: e.message }, window.location.origin);
                }
            })();
        }
    });
    
    // Expose helper functions for use by sidepanel and other components
    window.WHL_MessageContentHelpers = {
        isBase64Image: isBase64Image,
        toDataUrl: toDataUrl,
        detectMessageType: detectMessageType
    };
    
    // Expose Phase 4 functions for Recover module
    window.WHL_RecoverHelpers = {
        performInitialSnapshot: performInitialSnapshot,
        performDeepScan: performDeepScan,
        findMessageById: findMessageById,
        notifyRecoverUI: notifyRecoverUI
    };
};

// Executar apenas uma vez
if (!window.whl_hooks_loaded) {
    window.whl_hooks_loaded = true;
    console.log('[WHL Hooks] Initializing WPP Hooks...');

    // ── v8.5.0: Graceful degradation ──
    // Se wpp-hooks.js falhar (mudança no WhatsApp), entra em "modo manual"
    // permitindo o usuário continuar atendendo mesmo sem automação.
    window.whl_hooks_status = { ready: false, error: null, mode: 'auto' };

    try {
        window.whl_hooks_main();
        window.whl_hooks_status.ready = true;
        window.dispatchEvent(new CustomEvent('whl:hooks:ready'));
        console.log('[WHL Hooks] ✅ Initialized successfully');
    } catch (e) {
        console.error('[WHL Hooks] ❌ FAILED to initialize:', e);
        window.whl_hooks_status = {
            ready: false,
            error: e.message,
            mode: 'manual',
            failedAt: Date.now(),
        };

        // Notificar componentes que entrou em modo manual
        window.dispatchEvent(new CustomEvent('whl:hooks:failed', { detail: e.message }));

        // Tentar reportar a falha pro backend (telemetria)
        try {
            window.postMessage({
                type: 'WHL_HOOKS_FAILED',
                error: e.message,
                stack: e.stack,
                userAgent: navigator.userAgent,
                whatsappVersion: window.Debug?.VERSION || 'unknown',
                timestamp: Date.now(),
            }, window.location.origin);
        } catch (_) {}

        // Mostrar warning visual após 3s (deixa WA carregar primeiro)
        setTimeout(() => {
            try {
                if (document.getElementById('whl-fallback-banner')) return;
                const banner = document.createElement('div');
                banner.id = 'whl-fallback-banner';
                banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#f59e0b;color:#1a1a1a;padding:12px 20px;text-align:center;font-family:sans-serif;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
                banner.textContent = '⚠️ WhatsHybrid: automação indisponível (WhatsApp atualizou). Modo manual ativo.';
                const close = document.createElement('button');
                close.textContent = '✕';
                close.style.cssText = 'background:none;border:0;font-size:18px;cursor:pointer;margin-left:16px;';
                close.onclick = () => banner.remove();
                banner.appendChild(close);
                document.body.appendChild(banner);
            } catch (_) {}
        }, 3000);
    }
}



// ─── END 04-recover-helpers.js ───
