/**
 * @file content/wpp-hooks-parts/01-init-debug.js
 * @description Slice 1-1500 do wpp-hooks.js (refactor v9)
 * @lines 1500
 */

/**
 * Vórtex Lite - WPP Hooks (WPP Boladão tested approach)
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
    // Cada mensagem ocupa até 3 chaves (id, _serialized, remote_id): 3000
    // chaves ≈ 1000 mensagens — cabe a conversa aberta + as recentes.
    const MAX_CACHE_SIZE = 3000;
    // Pré-carga: quantas mensagens já abertas entram no cache ao iniciar
    // (cada uma ocupa até 3 chaves — cabe folgado nas 1000).
    const MESSAGE_CACHE_SEED_LIMIT = 300;
    
    // Array para armazenar histórico de mensagens recuperadas
    let historicoRecover = [];
    
    // Constants for recover history limits
    const MAX_STORAGE_MB = 5;
    const MAX_STORAGE_BYTES = MAX_STORAGE_MB * 1024 * 1024;
    const MAX_RECOVER_MESSAGES = 100; // Maximum number of messages to keep
    const FALLBACK_RECOVER_MESSAGES = 50; // Fallback when storage is full
    
    // ── Mídia (imagem, vídeo, áudio, figurinha, documento) ──────────────
    // O WhatsApp Web atual não expõe window.Store.DownloadManager (nada na
    // extensão o cria), então os downloads antigos nunca rodavam e a mídia
    // apagada ficava sem o arquivo. O download real é feito pelo módulo
    // WAWebDownloadManager com os campos da mensagem (directPath, mediaKey,
    // hashes) — guardados no cache ANTES de a mensagem ser apagada, porque
    // depois da revogação o modelo perde esses campos.
    const MEDIA_MSG_TYPES = ['image', 'sticker', 'video', 'ptt', 'audio', 'document'];
    // Download antecipado (mensagem nova, ainda não apagada): só arquivos até
    // este tamanho, e no máximo este total em memória. Maiores são baixados
    // na hora em que a mensagem é apagada, pelos mesmos campos.
    const PROACTIVE_MEDIA_MAX_BYTES = 4 * 1024 * 1024;
    const PROACTIVE_MEDIA_BUDGET_BYTES = 60 * 1024 * 1024;
    let proactiveMediaBytes = 0;
    const proactiveMediaOrder = []; // [{ ids, bytes }] — mais antigo primeiro

    // Em mensagens de mídia o WhatsApp Web guarda a MINIATURA (base64) em
    // msg.body; o texto digitado fica em msg.caption.
    function pareceBase64(str) {
        if (typeof str !== 'string' || !str) return false;
        if (/^data:[^;,]+;base64,/.test(str)) return true;
        return str.length >= 80 && /^[A-Za-z0-9+/]+={0,2}$/.test(str);
    }

    function camposDeMidia(msg) {
        if (!msg) return null;
        const md = msg.mediaData && typeof msg.mediaData === 'object' ? msg.mediaData : {};
        return {
            type: msg.type || null,
            mimetype: msg.mimetype || md.mimetype || null,
            filename: msg.filename || md.filename || null,
            size: typeof msg.size === 'number' ? msg.size : (typeof md.size === 'number' ? md.size : null),
            directPath: msg.directPath || null,
            mediaKey: msg.mediaKey || null,
            mediaKeyTimestamp: msg.mediaKeyTimestamp || null,
            filehash: msg.filehash || null,
            encFilehash: msg.encFilehash || null,
            mediaUrl: msg.deprecatedMms3Url || msg.url || null
        };
    }

    function bufferParaDataUrl(buf, mime) {
        const bytes = ArrayBuffer.isView(buf)
            ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
            : new Uint8Array(buf);
        if (!bytes.length) return null;
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return `data:${mime || 'application/octet-stream'};base64,${btoa(bin)}`;
    }

    async function midiaParaDataUrl(media, mime) {
        if (!media) return null;
        if (typeof media === 'string') {
            if (media.startsWith('data:')) return media;
            return pareceBase64(media) ? `data:${mime || 'application/octet-stream'};base64,${media}` : null;
        }
        if (typeof media.arrayBuffer === 'function' && typeof media.size === 'number') { // Blob/File
            return bufferParaDataUrl(await media.arrayBuffer(), media.type || mime);
        }
        // ArrayBuffer ou typed array (comparação por tag: funciona entre realms)
        if (Object.prototype.toString.call(media) === '[object ArrayBuffer]' || ArrayBuffer.isView(media)) {
            return bufferParaDataUrl(media, mime);
        }
        return null;
    }

    /**
     * Baixa a mídia ORIGINAL. `msgModel` é o modelo vivo (pode ser null depois
     * da revogação); `fields` são os campos guardados no cache.
     * Retorna data URL ou null.
     */
    async function baixarMidiaWA(msgModel, fields) {
        const f = fields || camposDeMidia(msgModel) || {};
        const mime = f.mimetype || null;

        // 1) Arquivo já decriptado em memória (mídia que o WhatsApp exibiu).
        try {
            const blobRef = msgModel && msgModel.mediaData && msgModel.mediaData.mediaBlob;
            if (blobRef) {
                const blob = typeof blobRef.forceToBlob === 'function' ? blobRef.forceToBlob() : blobRef;
                const url = await midiaParaDataUrl(blob, mime);
                if (url) return url;
            }
        } catch (_) { /* tenta o próximo */ }

        // 2) Download + decriptação pelo módulo do WhatsApp.
        if (f.directPath && f.mediaKey) {
            try {
                const mod = tryRequireModule('WAWebDownloadManager');
                const dm = mod && (mod.downloadManager || (mod.default && mod.default.downloadManager));
                if (dm && typeof dm.downloadAndMaybeDecrypt === 'function') {
                    const noopQpl = { addAnnotations() { return this; }, addPoint() { return this; } };
                    const buf = await dm.downloadAndMaybeDecrypt({
                        directPath: f.directPath,
                        encFilehash: f.encFilehash,
                        filehash: f.filehash,
                        mediaKey: f.mediaKey,
                        mediaKeyTimestamp: f.mediaKeyTimestamp,
                        type: f.type,
                        signal: typeof AbortController === 'function' ? new AbortController().signal : undefined,
                        downloadQpl: noopQpl
                    });
                    const url = await midiaParaDataUrl(buf, mime);
                    if (url) return url;
                }
            } catch (e) {
                console.warn('[WHL Media] downloadAndMaybeDecrypt falhou:', e && (e.status || e.message));
            }
        }

        // 3) Caminho antigo (versões do WhatsApp que expunham window.Store).
        try {
            if (msgModel && window.Store?.DownloadManager?.downloadMedia) {
                const url = await midiaParaDataUrl(await window.Store.DownloadManager.downloadMedia(msgModel), mime);
                if (url) return url;
            }
        } catch (_) { /* sem mais opções */ }

        return null;
    }

    /**
     * Grava a mídia baixada no cache e nos registros do Recover que ainda
     * estavam sem o arquivo (ou só com a miniatura), e avisa a extensão.
     * opts.budget: conta no limite de memória do download antecipado.
     */
    function aplicarMidiaBaixada(ids, dataUrl, meta, opts) {
        if (!dataUrl || !Array.isArray(ids) || !ids.length) return 0;
        const idsSet = new Set(ids.filter(Boolean).map(String));
        const mimetype = (meta && meta.mimetype) || (dataUrl.match(/^data:([^;,]+)/) || [])[1] || null;

        idsSet.forEach(id => {
            const existing = messageCache.get(id);
            if (existing) {
                messageCache.set(id, { ...existing, mediaData: dataUrl, mediaIsThumbnail: false, mediaDownloadTime: Date.now() });
            }
        });

        if (opts && opts.budget) {
            proactiveMediaBytes += dataUrl.length;
            proactiveMediaOrder.push({ ids: [...idsSet], bytes: dataUrl.length });
            while (proactiveMediaBytes > PROACTIVE_MEDIA_BUDGET_BYTES && proactiveMediaOrder.length > 1) {
                const old = proactiveMediaOrder.shift();
                proactiveMediaBytes -= old.bytes;
                old.ids.forEach(id => {
                    const c = messageCache.get(id);
                    if (c && c.mediaDownloadTime && !c.mediaIsThumbnail) {
                        // Libera a memória; os campos continuam para baixar de novo se for apagada.
                        messageCache.set(id, { ...c, mediaData: c.thumbnail || '__HAS_MEDIA__', mediaIsThumbnail: !!c.thumbnail });
                    }
                });
            }
        }

        let updated = 0;
        for (let i = 0; i < historicoRecover.length; i++) {
            const h = historicoRecover[i];
            if (!h || !(idsSet.has(String(h.id || '')) || idsSet.has(String(h.protocolId || '')))) continue;
            const current = h.mediaData;
            const needsUpdate = h.mediaIsThumbnail || !current || current === '__HAS_MEDIA__' ||
                typeof current !== 'string' || current.length < 50;
            if (!needsUpdate) continue;
            const body = typeof h.body === 'string' && /^\[[^\]]* apagad[oa] — arquivo não disponível\]$/.test(h.body) ? '' : h.body;
            historicoRecover[i] = { ...h, body, mediaData: dataUrl, mediaIsThumbnail: false, mimetype: h.mimetype || mimetype, contentCaptured: true };
            updated++;
            window.postMessage({
                type: 'WHL_RECOVER_MEDIA_READY',
                payload: {
                    id: h.id,
                    protocolId: h.protocolId || null,
                    action: h.action,
                    mediaData: dataUrl,
                    mimetype: h.mimetype || mimetype,
                    filename: h.filename || (meta && meta.filename) || null
                }
            }, window.location.origin);
        }

        if (updated) {
            try {
                localStorage.setItem('whl_recover_history', JSON.stringify(historicoRecover));
            } catch (_) { /* limite do localStorage: a extensão guarda a cópia completa */ }
            try { syncRecoverToExtension(historicoRecover); } catch (_) {}
            console.log('[WHL Media] ✅ Mídia original anexada a', updated, 'registro(s) do Recover');
        }
        return updated;
    }

    /**
     * Baixa (em segundo plano) a mídia de um registro recém-criado que ficou
     * sem o arquivo ou só com a miniatura.
     */
    function completarMidiaDoRegistro(ids, msgModel, fields) {
        // Pelos campos (directPath/mediaKey) ou pelo arquivo que o modelo ainda
        // tem em memória (mediaBlob — sobrevive à revogação em alguns casos).
        const canFields = !!(fields && fields.directPath && fields.mediaKey);
        let canBlob = false;
        try { canBlob = !!(msgModel && msgModel.mediaData && msgModel.mediaData.mediaBlob); } catch (_) { canBlob = false; }
        if (!canFields && !canBlob) return;
        setTimeout(() => {
            baixarMidiaWA(msgModel, fields || {})
                .then(dataUrl => { if (dataUrl) aplicarMidiaBaixada(ids, dataUrl, fields); })
                .catch(e => console.warn('[WHL Media] Falha ao completar mídia apagada:', e && e.message));
        }, 0);
    }

    /**
     * O balão da mensagem como está NA TELA (data-id = id serializado): texto,
     * tipo de mídia, cópia da imagem (foto/vídeo/figurinha) e nome do arquivo.
     * Usado no instante da revogação: o evento do modelo chega antes de o
     * WhatsApp redesenhar o balão como "Mensagem apagada", então o conteúdo
     * ainda está no DOM. Emojis viram o texto alternativo da imagem.
     */
    function lerBalaoDoDom(serializedId) {
        try {
            if (!serializedId || typeof document === 'undefined' || !document.querySelector) return null;
            const id = String(serializedId).replace(/["\\]/g, '');
            const el = document.querySelector(`[data-id="${id}"]`);
            if (!el) return null;
            if (el.querySelector('[data-icon="recalled"], [data-icon="recalled-in"], [data-icon="recalled-out"]')) return null;

            let text = '';
            const t = el.querySelector('[data-pre-plain-text] span.selectable-text, .copyable-text span.selectable-text, [data-testid="msg-text"]');
            if (t) {
                const walk = (node) => {
                    for (const c of node.childNodes || []) {
                        if (c.nodeType === 3) text += c.nodeValue;
                        else if (c.nodeName === 'IMG') text += c.getAttribute('alt') || '';
                        else if (c.nodeName === 'BR') text += '\n';
                        else walk(c);
                    }
                };
                if (t.childNodes && t.childNodes.length) walk(t);
                else text = t.textContent || '';
                text = stripEditMarker(text.trim());
            }

            // Mídia: a maior imagem do próprio balão (blob:/data: — mesmo domínio)
            let img = null;
            let area = 0;
            for (const im of el.querySelectorAll('img')) {
                const src = im.currentSrc || im.src || '';
                if (!(src.startsWith('blob:') || src.startsWith('data:image'))) continue;
                if (/emoji/i.test(im.className || '')) continue;
                const w = im.naturalWidth || 0;
                const h = im.naturalHeight || 0;
                if (w < 48 || h < 48) continue;
                if (w * h > area) { img = im; area = w * h; }
            }
            let kind = null;
            if (el.querySelector('video, [data-icon*="video" i], [data-icon="media-play"], [data-icon*="gif" i]')) kind = 'video';
            else if (el.querySelector('[data-icon*="ptt" i], [data-icon*="audio" i], [data-icon*="mic" i]')) kind = 'audio';
            else if (el.querySelector('[data-icon*="document" i], [data-icon*="doc-" i], [data-icon*="pdf" i], [data-icon*="xls" i], [data-icon*="ppt" i]')) kind = 'document';
            else if (img) kind = 'image';

            let imageDataUrl = null;
            if (img && (kind === 'image' || kind === 'video') && img.complete && img.naturalWidth) {
                try {
                    const max = 960;
                    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
                    const c = document.createElement('canvas');
                    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
                    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
                    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                    imageDataUrl = c.toDataURL('image/jpeg', 0.85);
                } catch (_) { imageDataUrl = null; }
            }

            let filename = null;
            const looksLikeFile = (v) => typeof v === 'string' && /\.[A-Za-z0-9]{2,5}$/.test(v.trim()) && v.trim().length <= 200;
            if (kind === 'document') {
                for (const n of el.querySelectorAll('[title]')) {
                    const v = n.getAttribute('title');
                    if (looksLikeFile(v)) { filename = v.trim(); break; }
                }
            }

            if (!text && !kind) return null;
            return { text: text || '', kind, imageDataUrl, filename };
        } catch (_) {
            return null;
        }
    }

    function lerTextoDoBalao(serializedId) {
        const b = lerBalaoDoDom(serializedId);
        return b && b.text ? b.text : null;
    }

    // Diagnóstico (no console do WhatsApp Web: WHL_RecoverDiag()).
    const recoverDiag = { adds: 0, revokes: [], sweeps: 0, sweepAdded: 0 };
    function diagRevoke(info) {
        recoverDiag.revokes.push({ em: new Date().toLocaleTimeString('pt-BR'), ...info });
        if (recoverDiag.revokes.length > 20) recoverDiag.revokes.shift();
    }

    /**
     * CORREÇÃO BUG 4: Cachear mensagem recebida para poder recuperá-la se for apagada
     * ATUALIZADO: Agora também captura dados de mídia (stickers, imagens, etc)
     */
    // opts.seed = true: pré-carga em massa das mensagens já abertas (ver
    // MessageCreatedHook). Não loga e não dispara o download proativo de
    // mídia — senão abrir o WhatsApp baixaria todas as mídias carregadas.
    function cachearMensagem(msg, opts) {
        if (!msg) return;
        const seed = !!(opts && opts.seed);
        // Mensagem já revogada não tem mais conteúdo: não sobrescreve o que
        // o cache guardou antes da revogação (é dali que o Recover lê).
        if (msg.type === 'revoked') return;
        
        // Múltiplos IDs para cache
        const ids = [
            msg.id?.id,
            msg.id?._serialized,
            msg.id?.remote?._serialized + '_' + msg.id?.id
        ].filter(Boolean);

        // Mídia original já baixada para esta mensagem: não troca pela miniatura
        // quando a mesma mensagem passa por aqui de novo.
        const prevCached = ids.length ? messageCache.get(ids[0]) : null;
        const prevFullMedia = prevCached && prevCached.mediaDownloadTime && !prevCached.mediaIsThumbnail
            ? prevCached.mediaData : null;
        
        let mediaType = msg.type || 'chat';
        const isMediaMsg = MEDIA_MSG_TYPES.includes(mediaType);
        const rawBody = typeof msg.body === 'string' ? msg.body : '';
        // Mídia: o texto é a legenda; msg.body é a miniatura em base64.
        const body = isMediaMsg
            ? (msg.caption || (rawBody && !pareceBase64(rawBody) ? rawBody : '') || '')
            : (rawBody || msg.caption || msg.text || '');
        const thumbnail = isMediaMsg && pareceBase64(rawBody) ? rawBody : null;
        const from = msg.from?._serialized || msg.from?.user || msg.author?._serialized || msg.id?.remote?._serialized || '';
        
        // Capturar dados de mídia se disponível
        let mediaData = null;
        const mediaFields = isMediaMsg ? camposDeMidia(msg) : null;
        let mimetype = (mediaFields && mediaFields.mimetype) || msg.mimetype || null;
        let filename = (mediaFields && mediaFields.filename) || msg.filename || null;
        
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
                } else if (typeof source.preview === 'string' || typeof source.data === 'string') {
                    // Só strings: objetos internos do WhatsApp não são serializáveis
                    mediaData = typeof source.preview === 'string' ? source.preview : source.data;
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
        const canDownload = !!(mediaFields && mediaFields.directPath && mediaFields.mediaKey);
        // O que veio embutido na mensagem é a miniatura quando dá para baixar o original.
        const mediaIsThumbnail = !prevFullMedia && !!(mediaData && isMediaMsg && canDownload);
        const needsDownload = !prevFullMedia && isMediaMsg && (canDownload || hasMediaUrl) && (!mediaData || mediaIsThumbnail);
        if (prevFullMedia) mediaData = prevFullMedia;

        if (!mediaData && hasMediaUrl) {
            // Marcar que tem mídia mas dados não disponíveis localmente
            mediaData = '__HAS_MEDIA__';
        }

        if (!body && !from && !mediaData) return;

        const cacheData = {
            body: body,
            from: from,
            timestamp: Date.now(),
            // Horário real de envio (msg.t vem em segundos no WhatsApp Web).
            t: typeof msg.t === 'number' && msg.t > 0 ? msg.t * 1000 : null,
            fromMe: !!(msg.id && msg.id.fromMe),
            type: mediaType,
            mimetype: mimetype,
            filename: filename,
            mediaData: mediaData, // NOVO: dados de mídia
            mediaIsThumbnail: mediaIsThumbnail,
            mediaDownloadTime: prevFullMedia ? prevCached.mediaDownloadTime : null,
            thumbnail: thumbnail,
            isMedia: isMediaMsg,
            // Dados extras para debug
            hasUrl: hasMediaUrl,
            // 🔧 FIX: Guardar dados de URL para re-download futuro (fallback quando __HAS_MEDIA__)
            directPath: msg.directPath || null,
            mediaKey: msg.mediaKey || null,
            mediaUrl: msg.deprecatedMms3Url || msg.url || null,
            // Campos para baixar/decriptar o original depois da revogação
            mediaKeyTimestamp: (mediaFields && mediaFields.mediaKeyTimestamp) || null,
            filehash: (mediaFields && mediaFields.filehash) || null,
            encFilehash: (mediaFields && mediaFields.encFilehash) || null,
            size: (mediaFields && mediaFields.size) || null,
        };

        // Cachear com TODOS os IDs possíveis
        ids.forEach(id => {
            messageCache.set(id, cacheData);
        });

        // FIX PEND-MED-005: download antecipado da mídia original (mensagens
        // novas). A pré-carga (seed) não baixa nada: centenas de mensagens
        // antigas — se uma delas for apagada, o original é baixado na hora.
        if (needsDownload && !seed && (!mediaFields || !mediaFields.size || mediaFields.size <= PROACTIVE_MEDIA_MAX_BYTES)) {
            setTimeout(() => {
                baixarMidiaWA(msg, mediaFields)
                    .then(dataUrl => {
                        if (!dataUrl || dataUrl.length < 50) return;
                        // Atualiza o cache e, se a mensagem já foi apagada nesse meio
                        // tempo, o registro do Recover (antes ficava '__HAS_MEDIA__').
                        aplicarMidiaBaixada(ids, dataUrl, mediaFields, { budget: true });
                        console.log('[WHL Cache] ✅ Mídia original em cache:', ids[0]?.substring(0, 8), `(${Math.round(dataUrl.length / 1024)}KB)`);
                    })
                    .catch(e => console.warn('[WHL Cache] Proactive media download failed:', e?.message));
            }, 100); // Small delay to not block message rendering
        }
        
        // Limitar tamanho do cache: remove as mais antigas até caber (antes
        // tirava UMA chave por mensagem nova, que entra com até três).
        while (messageCache.size > MAX_CACHE_SIZE) {
            const firstKey = messageCache.keys().next().value;
            messageCache.delete(firstKey);
        }

        // Pré-carga: só alimenta o cache. Sem log e, principalmente, sem o
        // WHL_MESSAGE_RECEIVED abaixo — ele aciona o autopilot, que não pode
        // responder mensagens antigas só porque o cache foi pré-carregado.
        if (seed) return;

        const logInfo = mediaData && mediaData !== '__HAS_MEDIA__'
            ? `[MÍDIA:${mediaType} - ${String(mediaData).substring(0,10)}...]` 
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
