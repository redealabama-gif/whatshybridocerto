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
    
    // ===== COLEÇÃO GLOBAL DE MENSAGENS DO WHATSAPP WEB =====
    // O WhatsApp Web atual expõe a coleção como require('WAWebCollections').Msg
    // (o mesmo caminho usado pelo whatsapp-web.js) e/ou como
    // require('WAWebMsgCollection').MsgCollection. O código antigo só testava
    // `.Msg` em WAWebMsgCollection/WAWebMsgModel; sem esse export, os hooks de
    // add/remove/ack não se registravam — o cache nunca recebia as mensagens
    // enviadas por você e as exclusões delas não eram registradas no Recover.
    function getMsgCollection() {
        const isColl = (c) => !!(c && typeof c.on === 'function' && typeof c.get === 'function');
        const candidates = [];
        for (const name of ['WAWebCollections', 'WAWebMsgCollection', 'WAWebMsgModel']) {
            try {
                const m = tryRequireModule(name);
                if (m) candidates.push(m.Msg, m.MsgCollection, m.default && m.default.MsgCollection, m);
            } catch (_) {}
        }
        try { if (window.Store) candidates.push(window.Store.Msg); } catch (_) {}
        for (const c of candidates) {
            if (isColl(c)) return c;
        }
        return null;
    }

    /**
     * Texto atual de uma mensagem no Store do WhatsApp. Chamado ANTES de a
     * edição ser aplicada, devolve o texto ANTIGO — último recurso quando o
     * cache não tem o conteúdo anterior (ex.: mensagem carregada antes de a
     * extensão iniciar).
     */
    function lookupStoreBody(key) {
        if (!key) return '';
        const keys = [key];
        if (typeof key === 'object' && key._serialized) keys.push(key._serialized);
        const readBody = (m) => {
            if (!m || m.type === 'revoked') return '';
            const b = m.body || m.caption;
            return typeof b === 'string' && b ? stripEditMarker(b) : '';
        };
        try {
            const coll = getMsgCollection();
            if (coll) {
                for (const k of keys) {
                    const b = readBody(coll.get(k));
                    if (b) return b;
                }
            }
        } catch (_) {}
        try {
            for (const k of keys) {
                const b = readBody(findMessageById(k));
                if (b) return b;
            }
        } catch (_) {}
        return '';
    }

    /**
     * Revogação vista direto no Store (msg.type virou 'revoked'). Cobre o que o
     * revoke_handler (protocolo recebido em processRenderableMessages) não
     * cobre — principalmente as mensagens que VOCÊ apagou para todos, aqui ou
     * no celular. O conteúdo original vem do messageCache, preenchido quando a
     * mensagem foi enviada/recebida/carregada (antes da revogação).
     *
     * opts.requireCached: só registra se o cache tinha o conteúdo. Usado no
     * Msg.on('add'), que também dispara para revogações ANTIGAS ao abrir um
     * chat — sem o cache, seriam registros falsos com o horário de agora.
     */
    function registrarRevogacaoDoStore(msg, opts) {
        if (!msg || msg.type !== 'revoked' || !msg.id || !msg.id.id) return false;
        const shortId = msg.id.id;
        // Já registrada (pelo revoke_handler ou por outro evento do Store)?
        if (historicoRecover.some(h => h && h.id === shortId && h.action === 'revoked')) return false;
        let cached = messageCache.get(shortId) || messageCache.get(msg.id._serialized);
        const cacheHasContent = !!(cached && (cached.body || (cached.mediaData && cached.mediaData !== '__HAS_MEDIA__') || cached.isMedia));
        if (opts && opts.requireCached && !cacheHasContent) return false;
        const cacheEstado = !cached ? 'ausente' : (cacheHasContent ? 'com conteúdo' : 'vazio');

        const fontes = cacheHasContent ? ['cache'] : [];
        if (!(opts && opts.requireCached)) {
            // Completa o que o cache não tem (texto, tipo, mídia, dados para
            // baixar) com o que ainda existe no instante da revogação.
            const extra = conteudoNaRevogacao(msg, cached);
            if (extra) {
                fontes.push(...extra.fontes);
                cached = extra.entry;
                messageCache.set(shortId, cached);
                if (msg.id._serialized) messageCache.set(msg.id._serialized, cached);
            }
        }

        diagRevoke({
            id: shortId.slice(-8),
            cache: cacheEstado,
            tipo: (cached && cached.type) || '?',
            fontes: fontes.length ? fontes.join('+') : 'nenhuma',
            texto: !!(cached && cached.body),
            previa: !!(cached && typeof cached.mediaData === 'string' && cached.mediaData.length > 50),
            camposDownload: !!(cached && cached.directPath && cached.mediaKey)
        });

        salvarMensagemRecuperada({
            id: msg.id,
            // salvarMensagemRecuperada procura o original no cache por esta chave
            protocolMessageKey: msg.id,
            from: msg.from,
            to: msg.to,
            author: msg.author,
            chatId: msg.id.remote,
            t: msg.t,
            // tipo real vem do cache; 'revoked' não é um tipo de conteúdo
            type: (cached && cached.type) || undefined
        }, msg);
        return true;
    }

    /**
     * Conteúdo da mensagem no instante em que ela é revogada, para quando o
     * cache não tem tudo. Fontes, nesta ordem:
     *   1. atributos anteriores do modelo (antes da troca para 'revoked');
     *   2. o próprio modelo — campos de mídia que o WhatsApp mantém;
     *   3. o balão na tela (texto, tipo, cópia da imagem, nome do arquivo).
     * Retorna { entry, fontes } — entry no formato do messageCache — ou null.
     */
    function conteudoNaRevogacao(msg, cached) {
        const fontes = [];
        let pa = null;
        try {
            pa = typeof msg.previousAttributes === 'function' ? msg.previousAttributes() : (msg._previousAttributes || null);
            if (!pa || !pa.type || pa.type === 'revoked') pa = null;
        } catch (_) { pa = null; }
        const prevFields = pa ? camposDeMidia(pa) : null;
        const liveFields = camposDeMidia(msg);
        const dom = lerBalaoDoDom(msg.id && msg.id._serialized, msg.id && msg.id.id);

        const paType = pa && pa.type;
        // O modelo revogado já tem type 'revoked'; o tipo vem do mimetype, se ficou.
        const mimeOf = (m) => String(m || '').toLowerCase();
        const liveMime = mimeOf(liveFields && liveFields.mimetype);
        const liveType = !liveMime ? null
            : liveMime.startsWith('image/webp') ? 'sticker'
            : liveMime.startsWith('image/') ? 'image'
            : liveMime.startsWith('video/') ? 'video'
            : liveMime.startsWith('audio/') ? 'audio'
            : 'document';
        const type = (cached && cached.isMedia && cached.type) ||
            (MEDIA_MSG_TYPES.includes(paType) ? paType : null) ||
            (dom && dom.kind) || liveType ||
            (cached && cached.type) || paType || 'chat';
        const isMedia = MEDIA_MSG_TYPES.includes(type);

        const paBody = pa && typeof pa.body === 'string' ? pa.body : '';
        const paText = pa ? stripEditMarker(String(pa.caption || (pareceBase64(paBody) ? '' : paBody) || '')).trim() : '';
        const text = (cached && cached.body) || paText || (dom && dom.text) || '';
        const thumb = (cached && cached.thumbnail) || (pa && pareceBase64(paBody) ? paBody : null);
        const cachedMedia = cached && typeof cached.mediaData === 'string' && cached.mediaData.length > 50 && cached.mediaData !== '__HAS_MEDIA__'
            ? cached.mediaData : null;
        const preview = cachedMedia || (dom && dom.imageDataUrl) || thumb || null;

        const pick = (k) => (cached && cached[k]) || (prevFields && prevFields[k]) || (liveFields && liveFields[k]) || null;
        const fields = {
            mimetype: pick('mimetype'),
            filename: pick('filename') || (dom && dom.filename) || null,
            size: pick('size'),
            directPath: pick('directPath'),
            mediaKey: pick('mediaKey'),
            mediaKeyTimestamp: pick('mediaKeyTimestamp'),
            filehash: pick('filehash'),
            encFilehash: pick('encFilehash'),
            mediaUrl: pick('mediaUrl')
        };

        if (pa && (paText || MEDIA_MSG_TYPES.includes(paType))) fontes.push('anteriores');
        if (liveFields && (liveFields.directPath || liveFields.mediaKey)) fontes.push('modelo');
        if (dom && (dom.text || dom.kind)) fontes.push('tela');
        if (!text && !isMedia) return null;
        if (!fontes.length && cached && cached.body === text && (!isMedia || cached.isMedia)) return null;

        const entry = {
            ...(cached || {}),
            body: text,
            from: (cached && cached.from) || msg.from?._serialized || msg.author?._serialized || '',
            timestamp: Date.now(),
            t: (cached && cached.t) || (typeof msg.t === 'number' && msg.t > 0 ? msg.t * 1000 : null),
            fromMe: !!(msg.id && msg.id.fromMe),
            type,
            isMedia,
            thumbnail: thumb,
            mediaData: preview || (isMedia && fields.directPath ? '__HAS_MEDIA__' : (cached && cached.mediaData) || null),
            // cópia da tela / miniatura: o original ainda é baixado se der
            mediaIsThumbnail: !!(preview && preview !== cachedMedia) || !!(cached && cached.mediaIsThumbnail),
            ...fields
        };
        return { entry, fontes };
    }

    /**
     * CORREÇÃO 1.2 + BUG 2 + BUG 3: Salvar mensagem apagada com notificação persistente e tipo de deleção
     */
    function salvarMensagemApagada(msg) {
        let from = extractPhoneNumber(msg);
        const to = extractPhoneNumber({ to: msg.to || msg.chatId || msg.id?.remote });
        const chatId = (msg.id?.remote?._serialized || msg.chatId?._serialized || msg.chatId || msg.id?.remote || null);

        // Conteúdo: texto, ou legenda + mídia. Em mídia, msg.body é a miniatura.
        const isMediaMsg = MEDIA_MSG_TYPES.includes(msg.type);
        const rawBody = typeof msg.body === 'string' ? msg.body : '';
        const cachedDel = (msg.id && (messageCache.get(msg.id.id) || messageCache.get(msg.id._serialized))) || null;
        const textBody = isMediaMsg
            ? (msg.caption || (rawBody && !pareceBase64(rawBody) ? rawBody : '') || (cachedDel && cachedDel.body) || '')
            : (rawBody || (cachedDel && cachedDel.body) || '');
        let delMedia = null;
        let delMediaIsThumb = false;
        if (cachedDel && typeof cachedDel.mediaData === 'string' && cachedDel.mediaData !== '__HAS_MEDIA__' && cachedDel.mediaData.length > 50) {
            delMedia = cachedDel.mediaData;
            delMediaIsThumb = !!cachedDel.mediaIsThumbnail;
        } else if (isMediaMsg && pareceBase64(rawBody)) {
            delMedia = rawBody;
            delMediaIsThumb = true;
        }
        const delFields = isMediaMsg ? camposDeMidia(msg) : null;
        const body = textBody || (isMediaMsg ? '' : '[mensagem sem texto]');
        
        // BUG 3: Detect deletion type
        const deletionType = detectDeletionType(msg);
        
        // PrivacyShield+: Detectar tipo de dispositivo remetente
        const _participant = msg.author?._serialized || msg.from?._serialized || msg.id?.remote?._serialized || '';
        const _senderIsPhone = _participant.includes(':0@') || !_participant.includes(':');
        const _deviceType = _senderIsPhone ? 'phone' : 'computer';

        // FIX v9.6.4: classifica action e MESSAGE_STATE conforme deletionType real.
        // Antes: action='deleted' fixo e estado hardcoded em DELETED_LOCAL —
        // resultado: revoke global (contato apagou pra todos) caía no filtro
        // "Apagada" em vez de "Revogada". detectDeletionType já calcula
        // corretamente; só faltava propagar.
        const isRevoke = deletionType === 'revoked_by_sender' || deletionType === 'deleted_by_admin';
        const messageState = isRevoke
            ? window.RecoverAdvanced?.MESSAGE_STATES?.REVOKED_GLOBAL
            : window.RecoverAdvanced?.MESSAGE_STATES?.DELETED_LOCAL;

        // Declutter (adendo do usuário): NÃO registra revogado quando não há
        // nada recuperável (sem texto E sem mídia) — são as entradas inúteis
        // "desconhecido → desconhecido / [sem texto]" que só poluem o Recover.
        // Apagado (isRevoke=false) e editado seguem 100% inalterados.
        const _revokeHasText = msg.body && String(msg.body).trim().length > 0;
        const _revokeHasMedia = msg.type && msg.type !== 'chat' && msg.type !== 'text';
        if (isRevoke && !_revokeHasText && !_revokeHasMedia) {
            return;
        }

        const entrada = {
            id: msg.id?.id || Date.now().toString(),
            chatId: chatId,
            from,
            to,
            body,
            type: detectMessageType(body, msg.type),
            action: isRevoke ? 'revoked' : 'deleted',
            mediaType: msg.type,
            mediaData: delMedia,
            mediaIsThumbnail: !!(delMedia && delMediaIsThumb),
            mimetype: (delFields && delFields.mimetype) || null,
            filename: (delFields && delFields.filename) || null,
            directPath: (delFields && delFields.directPath) || null,
            mediaKey: (delFields && delFields.mediaKey) || null,
            mediaKeyTimestamp: (delFields && delFields.mediaKeyTimestamp) || null,
            filehash: (delFields && delFields.filehash) || null,
            encFilehash: (delFields && delFields.encFilehash) || null,
            size: (delFields && delFields.size) || null,
            deviceType: _deviceType,
            deviceIcon: _senderIsPhone ? '📱' : '💻',
            timestamp: Date.now(),
            // Horário em que a mensagem foi enviada (o timestamp acima é o da exclusão)
            originalTimestamp: typeof msg.t === 'number' && msg.t > 0 ? msg.t * 1000 : null,
            fromMe: !!(msg.id && msg.id.fromMe),
            contentCaptured: !!(textBody || delMedia || isMediaMsg),
            // BUG 3: Add deletion type info
            deletionType: deletionType,
            deletionInfo: {
                type: deletionType,
                actor: getDeleteActor(msg),
                timestamp: Date.now()
            },
            // BUG 2: Add persistent notification
            notification: {
                type: isRevoke ? 'revoked' : 'deleted',
                text: getNotificationText(deletionType),
                timestamp: Date.now(),
                persistent: true  // BUG 2: Flag to keep visible always
            }
        };

        // PHASE 2: Usar novo sistema de versões via RecoverAdvanced
        if (window.RecoverAdvanced?.registerMessageEvent && messageState) {
            window.RecoverAdvanced.registerMessageEvent(
                entrada,
                messageState,
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
        
        // Notificar UI — com a ação real. Antes ia sempre `action: 'deleted'`,
        // e uma revogação detectada aqui era contada como "Apagada" no painel.
        window.postMessage({
            type: 'WHL_RECOVER_NEW_MESSAGE',
            payload: {
                ...entrada,
                action: entrada.action
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

        // Mídia: o modelo ainda está inteiro (apagada só para mim) — baixa o
        // original e completa o registro.
        if (isMediaMsg && (!delMedia || delMediaIsThumb)) {
            completarMidiaDoRegistro([entrada.id, msg.id?._serialized], msg, delFields);
        }
        
        console.log(`[WHL Recover] 🗑️ Mensagem apagada (${deletionType}) de ${entrada.from}: ${entrada.body.substring(0, 50)}...`);
    }

    /**
     * v9.6.5: Constrói o marcador visual de edição que vai pro body da
     * mensagem. Espelha o padrão "🚫 Apagada: [original]" que é usado
     * para mensagens apagadas, mas estendido pra incluir antes + depois.
     *
     * Casos:
     *  - oldBody e newBody diferentes e ambos não vazios:
     *      "📝 Antes: <old>\n✏️ Editada para: <new>"
     *  - apenas newBody (cache não tinha o body anterior):
     *      "✏️ Esta mensagem foi editada para: <new>"
     *  - newBody vazio: retorna null (caller decide o que fazer).
     *
     * Idempotência: se newBody já vier com marcador (chamadas duplicadas
     * em ticks subsequentes), strip antes de re-marcar pra evitar
     * "📝 Antes: <old>\n✏️ Editada para: 📝 Antes: <old>\n✏️ Editada para: ...".
     */
    function stripEditMarker(text) {
        if (typeof text !== 'string' || !text) return '';
        // Combo: "📝 Antes: ... \n✏️ Editada para: <real>" — separado
        // do simples porque captura uma posição diferente.
        let m = text.match(/^📝 Antes: [\s\S]*?\n✏️ Editada para: ([\s\S]*)$/);
        if (m) return m[1];
        // Simples: "✏️ Esta mensagem foi editada para: <real>" ou
        // "✏️ Editada para: <real>" — colapsados em uma alternation
        // (FIX v9.6.6: era duas chamadas .match separadas).
        m = text.match(/^✏️ (?:Esta mensagem foi editada para|Editada para): ([\s\S]*)$/);
        if (m) return m[1];
        return text;
    }

    function composeEditMarker(oldBody, newBody) {
        const o = stripEditMarker(String(oldBody || '').trim());
        const n = stripEditMarker(String(newBody || '').trim());
        if (!n) return null; // sem novo conteúdo: nada a marcar
        if (o && o !== n) {
            return `📝 Antes: ${o}\n✏️ Editada para: ${n}`;
        }
        return `✏️ Esta mensagem foi editada para: ${n}`;
    }

    /**
     * Tenta achar o body anterior do msg no messageCache (populado pelo
     * MessageCreatedHook em Msg.on('add')). Testa todos os IDs possíveis
     * porque WA usa shapes diferentes em pontos diferentes do pipeline.
     */
    function getCachedPreviousBody(msg) {
        if (!msg) return '';
        const ids = [
            msg.protocolMessageKey?.id,
            msg.id?.id,
            msg.id?._serialized,
            msg.quotedStanzaID
        ].filter(Boolean);
        for (const id of ids) {
            const cached = messageCache.get(id);
            if (cached?.body) return stripEditMarker(String(cached.body));
        }
        // Último recurso: o Store ainda tem o texto antigo (a edição só é
        // aplicada depois do nosso hook). Só pela chave da mensagem ORIGINAL —
        // msg.id aqui é o id da mensagem de protocolo da edição.
        return lookupStoreBody(msg.protocolMessageKey);
    }

    /**
     * Bug fix + BUG 2: Save edited message to history with persistent notification
     */
    function salvarMensagemEditada(message, previousOverride) {
        // FIX v9.6.6: strip do marker no body lido — em edits subsequentes
        // a msg pode chegar com .body já marcado de um tick anterior (ou de
        // re-render via processRenderableMessages que jogou marker no cache).
        // Sem strip, o history record gravava o marker text como "body" novo.
        const messageContent = stripEditMarker(message?.body || message?.caption || '') || '[sem conteúdo]';
        let from = extractPhoneNumber(message);

        if (!from || from === 'Desconhecido') from = 'Número desconhecido';

        // CORREÇÃO 3: Recuperar previousContent do cache (usar ID original quando existir)
        const originalId = message.protocolMessageKey?.id || message.quotedStanzaID || message.id?.id || Date.now().toString();
        const protocolId = message.id?.id || message.id?._serialized || null;
        const chatId = (message.id?.remote?._serialized || message.chatId?._serialized || message.chatId || message.id?.remote || null);

        const originalCached = messageCache.get(originalId) || messageCache.get(message.id?.id);
        // FIX v9.6.6: strip do marker no body cacheado — handle_edited_message
        // re-renderiza via processRenderableMessages que repõe o marker em
        // messageCache via cachearMensagem. Sem strip aqui, o previousContent
        // gravado em re-edits virava o marker da edição anterior (nested).
        // Ordem: o que o hook já leu (parentMsg/Store antes de aplicar) → cache
        // → Store. Antes só olhava o cache, que ficava vazio para as mensagens
        // enviadas por você — o painel mostrava só o texto novo.
        const rawPrevious = previousOverride || message.previousBody || originalCached?.body ||
            getCachedPreviousBody(message) || null;
        const previousContent = rawPrevious ? (stripEditMarker(String(rawPrevious)) || null) : null;
        
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
            // Horário de envio da mensagem original (o timestamp acima é o da edição)
            originalTimestamp: originalCached?.t || null,
            fromMe: !!(message.id && message.id.fromMe) || !!originalCached?.fromMe,
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

    function salvarMensagemRecuperada(msg, liveModel) {
        // CORREÇÃO BUG 4: Tentar múltiplas fontes para o body
        let body = msg.body || msg.caption || msg.text || '';
        let from = extractPhoneNumber(msg);
        let mediaData = null;
        let mediaIsThumbnail = false;
        let mediaType = msg.type || 'chat';
        let mimetype = msg.mimetype || null;
        let filename = msg.filename || null;
        // Em mídia, msg.body é a miniatura — não é o texto da mensagem.
        if (MEDIA_MSG_TYPES.includes(msg.type) && pareceBase64(body)) {
            mediaData = body;
            mediaIsThumbnail = true;
            body = msg.caption || '';
        }
        const liveFields = MEDIA_MSG_TYPES.includes(msg.type) ? camposDeMidia(msg) : null;
        
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
        let cachedT = null;
        let cachedFromMe = false;
        let cachedIsMedia = false;
        let cachedFields = null;

        for (const id of possibleIds) {
            const cached = messageCache.get(id);
            if (cached) {
                if (cached.t && !cachedT) cachedT = cached.t;
                if (cached.fromMe) cachedFromMe = true;
                if (cached.isMedia) cachedIsMedia = true;
                // Recuperar body se vazio
                if (!body && cached.body) {
                    body = cached.body;
                }
                // Se from não foi encontrado, tentar recuperar do cache
                if ((!from || from === 'Desconhecido') && cached.from) {
                    from = extractPhoneNumber({ from: { _serialized: cached.from } });
                }
                // NOVO: Recuperar dados de mídia — validar que é uma string base64 real
                // (o original baixado tem prioridade sobre a miniatura)
                if (cached.mediaData &&
                    cached.mediaData !== '__HAS_MEDIA__' &&
                    typeof cached.mediaData === 'string' &&
                    cached.mediaData.length > 50 &&
                    (!mediaData || (mediaIsThumbnail && !cached.mediaIsThumbnail))) {
                    mediaData = cached.mediaData;
                    mediaIsThumbnail = !!cached.mediaIsThumbnail;
                } else if (!mediaData && cached.thumbnail) {
                    mediaData = cached.thumbnail;
                    mediaIsThumbnail = true;
                }
                if (cached.isMedia && !cachedFields) {
                    cachedFields = {
                        type: cached.type || null,
                        mimetype: cached.mimetype || null,
                        filename: cached.filename || null,
                        size: cached.size || null,
                        directPath: cached.directPath || null,
                        mediaKey: cached.mediaKey || null,
                        mediaKeyTimestamp: cached.mediaKeyTimestamp || null,
                        filehash: cached.filehash || null,
                        encFilehash: cached.encFilehash || null,
                        mediaUrl: cached.mediaUrl || null
                    };
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
        
        // Validar resultados. O rótulo antigo "[Mensagem sem texto - mídia ou
        // sticker]" afirmava que era mídia sem saber disso (e o contador de
        // mídias, que olha o tipo real, mostrava 0). Agora: se o cache sabia
        // que era mídia, o tipo vem dele; senão, o texto diz a verdade.
        const contentCaptured = !!(body || mediaData || cachedIsMedia);
        if (!body && !mediaData) {
            body = cachedIsMedia
                ? `[${mediaType} apagado — arquivo não disponível]`
                : '[Conteúdo não capturado — a mensagem foi apagada antes de ser carregada pela extensão]';
        }
        if (!from || from === 'Desconhecido') from = 'Número desconhecido';
        
        const mediaFieldsFinal = cachedFields || liveFields;

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
            mediaKeyTimestamp: (mediaFieldsFinal && mediaFieldsFinal.mediaKeyTimestamp) || null,
            filehash: (mediaFieldsFinal && mediaFieldsFinal.filehash) || null,
            encFilehash: (mediaFieldsFinal && mediaFieldsFinal.encFilehash) || null,
            size: (mediaFieldsFinal && mediaFieldsFinal.size) || null,
            // true = só a miniatura por enquanto (o original está sendo baixado)
            mediaIsThumbnail: !!(mediaData && mediaIsThumbnail),
            timestamp: Date.now(),
            // Horário em que a mensagem foi enviada (o timestamp acima é o da revogação)
            originalTimestamp: cachedT || (typeof msg.t === 'number' && msg.t > 0 ? msg.t * 1000 : null),
            fromMe: cachedFromMe || !!(msg.id && msg.id.fromMe) || !!(msg.protocolMessageKey && msg.protocolMessageKey.fromMe),
            contentCaptured: contentCaptured,
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
            // Como nos registros de apagada/editada (antes só sincronizava no
            // caminho de erro).
            syncRecoverToExtension(historicoRecover);
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

        // Mídia sem o arquivo original (ou só com a miniatura): baixa agora,
        // pelos campos guardados antes da revogação, e completa o registro.
        // (liveModel: o modelo revogado ainda pode ter o arquivo em memória.)
        if (MEDIA_MSG_TYPES.includes(mediaType) && (!mediaData || mediaIsThumbnail) && (mediaFieldsFinal || liveModel)) {
            completarMidiaDoRegistro([originalId, ...possibleIds], liveModel || null, mediaFieldsFinal);
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
    //
    // FIX v9.6.1: edits do CONTATO não disparavam o hook em WA Web 2.3000+.
    //
    // Bug anterior:
    //   `processEditProtocolMsg = processEditProtocolMsgs` aliased o hook
    //   plural (que espera array e chama .filter) em cima do singular,
    //   onde o WA Web às vezes chama com UM objeto. Resultado: TypeError
    //   silencioso e edits incoming passavam direto. Outgoing funcionava
    //   porque o caminho do "você editou" vai pelo plural mesmo.
    //
    // Correção: instalar handlers separados para plural (array) e singular
    // (objeto) preservando assinaturas originais. Falhas no patch nunca
    // bloqueiam a função nativa — sempre delegam ao original.
    class EditMessageHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();

            if (!MODULES.PROCESS_EDIT_MESSAGE) {
                console.warn('[WHL Hooks] PROCESS_EDIT_MESSAGE module not available');
                return;
            }

            const mod = MODULES.PROCESS_EDIT_MESSAGE;

            // Guarda referências separadas ANTES de qualquer patch.
            EditMessageHook.originalMsgs = mod.processEditProtocolMsgs;
            EditMessageHook.originalMsg  = mod.processEditProtocolMsg;

            // ── Hook PLURAL (batch). args[0] é array de edits. ─────────────
            if (typeof EditMessageHook.originalMsgs === 'function') {
                mod.processEditProtocolMsgs = function (...args) {
                    try {
                        if (Array.isArray(args[0])) {
                            args[0] = args[0].filter((message) => {
                                try {
                                    return !EditMessageHook.handle_edited_message(message, ...args);
                                } catch (innerErr) {
                                    console.warn('[WHL Hooks] handle_edited_message error (plural):', innerErr);
                                    return false; // não filtra em caso de erro → não perde a msg
                                }
                            });
                        }
                    } catch (e) {
                        console.warn('[WHL Hooks] processEditProtocolMsgs wrapper error:', e);
                    }
                    return EditMessageHook.originalMsgs.apply(this, args);
                };
                console.log('[WHL Hooks] EditMessageHook plural registered');
            }

            // ── Hook updateMessageEditsLocally ─────────────────────────────
            // FIX v9.6.7: diagnóstico real do console do usuário (script
            // injetado em DevTools) mostrou a estrutura ATUAL que WA Web
            // 2.3300+ passa pra updateMessageEditsLocally:
            //
            //   args[0] = [ { editedMsgData, parentMsg, protocolMsg,
            //                 isLatest, mentionOfMe } ]
            //   args[1] = [ { ...mesma estrutura } ]
            //
            // Ambos args são ARRAYS de "envelopes" — não objetos soltos.
            // Cada envelope tem:
            //   - parentMsg.body  = body ANTIGO (msg ainda não atualizada no store)
            //   - editedMsgData.body = body NOVO (vai ser aplicado pelo original)
            //
            // O wrapper anterior (v9.6.2 a v9.6.6) procurava "primeiro objeto
            // com body/caption/id/protocolMessageKey", mas FILTRAVA arrays
            // com `!Array.isArray(a)`. Resultado: msg ficava null, nenhum
            // log "🔔 updateMessageEditsLocally edit detectado" disparava,
            // e a mutação nunca acontecia. 4 PRs anteriores tentaram fixar
            // sem dados — só sabíamos com o diagnóstico que NADA do wrapper
            // rodava na vida real.
            //
            // Novo wrapper: itera arrays nos args, identifica envelopes pelo
            // shape (tem editedMsgData OU parentMsg), e muta editedMsgData.body
            // pra incluir o marcador combo "📝 Antes: <antigo>\n✏️ Editada
            // para: <novo>". O original pega editedMsgData.body e aplica em
            // parentMsg.body — o body marcado vai pro store e o WA renderiza
            // sem precisar de DOM hack.
            //
            // Bônus: parentMsg.body JÁ tem o "antes" — não precisamos mais
            // do messageCache pra isso (cache fica como fallback se shape
            // mudar de novo).
            //
            // SEMPRE delega ao original — falha de processamento não bloqueia.
            EditMessageHook.originalUpdate = mod.updateMessageEditsLocally;
            if (typeof EditMessageHook.originalUpdate === 'function') {
                mod.updateMessageEditsLocally = function (...args) {
                    try {
                        // Coleta envelopes de qualquer arg (array ou objeto solto).
                        // Defensivo contra mudança de signature: itera tudo.
                        const envelopes = [];
                        const seen = new Set();
                        const pushIfEnvelope = (e) => {
                            if (!e || typeof e !== 'object' || seen.has(e)) return;
                            if (e.editedMsgData || e.parentMsg) {
                                seen.add(e);
                                envelopes.push(e);
                            }
                        };
                        for (const a of args) {
                            if (Array.isArray(a)) {
                                for (const item of a) pushIfEnvelope(item);
                            } else {
                                pushIfEnvelope(a);
                            }
                        }

                        if (envelopes.length === 0) {
                            // Fallback pro shape antigo (objeto solto com .body
                            // direto) — mantém compatibilidade caso WA volte.
                            for (const a of args) {
                                if (a && typeof a === 'object' && !Array.isArray(a) &&
                                    (a.body !== undefined || a.caption !== undefined)) {
                                    envelopes.push({ legacyMsg: a });
                                    break;
                                }
                            }
                        }

                        for (const env of envelopes) {
                            try {
                                // Legacy: shape antigo onde msg é o próprio objeto
                                if (env.legacyMsg) {
                                    const msg = env.legacyMsg;
                                    const prev = getCachedPreviousBody(msg);
                                    try { salvarMensagemEditada(msg, prev); } catch (e) {}
                                    const target = typeof msg.body === 'string' && msg.body.length > 0 ? 'body' : 'caption';
                                    const composed = composeEditMarker(prev, msg[target] || '');
                                    if (composed) msg[target] = composed;
                                    continue;
                                }

                                // Shape novo (WA 2.3300+)
                                const parent = env.parentMsg || {};
                                const edit = env.editedMsgData || {};
                                const proto = env.protocolMsg || {};

                                // Body anterior: vem direto no parentMsg (limpo do marker
                                // se já estava marcado de uma edição anterior).
                                const rawOld = parent.body || parent.caption || '';
                                const oldBody = stripEditMarker(String(rawOld).trim());

                                // Body novo: vem em editedMsgData
                                const rawNew = edit.body || edit.caption || '';
                                const newBody = stripEditMarker(String(rawNew).trim());

                                if (!newBody) continue; // nada a marcar

                                console.log('[WHL Hooks] 🔔 Edit incoming detectado:',
                                    'antes=', oldBody?.slice(0, 60), '→ depois=', newBody?.slice(0, 60),
                                    'msgId=', parent.id?._serialized || parent.id?.id || '?');

                                // Salva no histórico ANTES de mutar editedMsgData
                                // (salvarMensagemEditada lê message.body — passa o
                                // body novo limpo pra registrar, e previousBody pra
                                // virar previousContent).
                                try {
                                    salvarMensagemEditada({
                                        id: parent.id,
                                        from: parent.from,
                                        to: parent.to,
                                        chatId: parent.id?.remote,
                                        body: newBody,
                                        previousBody: oldBody,
                                        protocolMessageKey: proto.id || parent.id,
                                        type: parent.type || 'chat'
                                    });
                                } catch (saveErr) {
                                    console.warn('[WHL Hooks] salvarMensagemEditada error:', saveErr);
                                }

                                // Compõe e injeta o marcador em editedMsgData
                                // (que é o que o original vai aplicar no parentMsg).
                                const composed = composeEditMarker(oldBody, newBody);
                                if (composed) {
                                    // Detecta se o body novo veio em .body ou .caption
                                    if (typeof edit.body === 'string' && edit.body.length > 0) {
                                        edit.body = composed;
                                    } else if (typeof edit.caption === 'string' && edit.caption.length > 0) {
                                        edit.caption = composed;
                                    } else if (edit.body !== undefined) {
                                        edit.body = composed;
                                    } else {
                                        edit.caption = composed;
                                    }
                                }
                            } catch (envErr) {
                                console.warn('[WHL Hooks] envelope processing error:', envErr);
                            }
                        }
                    } catch (e) {
                        console.warn('[WHL Hooks] updateMessageEditsLocally wrapper error:', e);
                    }
                    return EditMessageHook.originalUpdate.apply(this, args);
                };
                console.log('[WHL Hooks] EditMessageHook updateMessageEditsLocally registered (v9.6.7)');
            }

            // Alias mantido para callers antigos que liam EditMessageHook.originalEdit.
            EditMessageHook.originalEdit = EditMessageHook.originalMsgs;
            this.original_function = EditMessageHook.originalMsgs;

            console.log('[WHL Hooks] EditMessageHook registered (plural:%s, updateLocal:%s)',
                typeof EditMessageHook.originalMsgs === 'function',
                typeof EditMessageHook.originalUpdate === 'function');
        }

        static handle_edited_message(message, arg1, arg2) {
            try {
                if (!message || typeof message !== 'object') return false;

                // Diagnóstico — útil pra confirmar se incoming dispara o hook.
                try {
                    const isOut = !!(message.isMe || message.from?.isMe || message.id?.fromMe);
                    console.log('[WHL Hooks] 🔔 Edit detectado (' + (isOut ? 'OUTGOING' : 'INCOMING') + ')',
                                message.id?._serialized || message.id?.id || '?');
                } catch (_) {}

                // Pega o body anterior do cache ANTES de salvar/mutar
                // (precisa do estado pré-edit pra mostrar "Antes: ...").
                const previousBody = getCachedPreviousBody(message);

                // Salva no histórico ANTES de mutar o objeto (com o texto
                // anterior já lido — cache ou Store, antes da edição aplicar).
                salvarMensagemEditada(message, previousBody);

                // Igual às edições do contato (updateMessageEditsLocally): o texto
                // novo vai com o marcador "Antes/Editada para" e a edição segue
                // o caminho normal — o WhatsApp aplica e GRAVA. Antes ela era
                // descartada e trocada por uma mensagem desenhada pelo hook: o
                // texto novo nunca era gravado e, ao recarregar, voltava o antigo
                // (só nas suas edições; as do contato já funcionavam).
                const target = typeof message.body === 'string' && message.body.length > 0 ? 'body'
                    : (typeof message.caption === 'string' && message.caption.length > 0 ? 'caption' : 'body');
                const messageContent = stripEditMarker(message[target] || '');
                const composed = composeEditMarker(previousBody, messageContent);
                if (composed) message[target] = composed;
                return false; // não filtra: o WhatsApp processa a edição
            } catch (e) {
                console.error('[WHL Hooks] handle_edited_message fatal:', e);
                return false; // não filtra em caso de erro
            }
        }
    }

    // ===== CORREÇÃO 1.1: HOOK PARA MENSAGENS DELETADAS LOCALMENTE =====
    class DeletedMessageHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();
            
            const msgCollection = getMsgCollection();
            if (!msgCollection) {
                console.warn('[WHL Hooks] Msg store not available for delete hook');
                return;
            }

            try {
                // Hook no evento 'remove' da coleção de mensagens. A coleção
                // também remove mensagens antigas para liberar memória — por isso
                // só conta como "apagada para mim" a mensagem nova (isNewMsg),
                // o mesmo critério do whatsapp-web.js. Revogadas vão pelo
                // RevokeChangeHook.
                msgCollection.on('remove', (msg) => {
                    if (!msg || !msg.isNewMsg || msg.type === 'revoked') return;
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
    // Fora do cache — ou no cache SEM conteúdo, mas o modelo agora tem: a
    // mensagem que você envia entra na coleção antes de o texto ser preenchido
    // e o cache guardava a versão vazia para sempre (a varredura via o id e
    // pulava). Sem isso, ao apagar, não havia o que recuperar.
    function precisaRecachear(m, id) {
        const c = messageCache.get(id);
        if (!c) return true;
        if (c.body || c.isMedia) return false;
        const temTexto = typeof m.body === 'string' && m.body.trim() !== '' && !pareceBase64(m.body);
        const temMidia = MEDIA_MSG_TYPES.includes(m.type);
        if (temTexto || temMidia || (typeof m.caption === 'string' && m.caption.trim())) {
            recoverDiag.sweepRefreshed++;
            return true;
        }
        return false;
    }

    // Intervalo da varredura da conversa aberta (ver cachearConversaAberta).
    const ACTIVE_CHAT_SWEEP_MS = 3000;
    // Quantas mensagens da coleção geral entram por varredura (cabe no cache).
    const GLOBAL_SWEEP_LIMIT = 600;

    class MessageCreatedHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();
            
            const msgCollection = getMsgCollection();
            if (!msgCollection) {
                console.warn('[WHL Hooks] Msg store not available for add hook');
                return;
            }

            try {
                msgCollection.on('add', (msg) => {
                    MessageCreatedHook.handle_created_message(msg);
                });

                console.log('[WHL Hooks] MessageCreatedHook registered on Msg.on("add")');
            } catch (e) {
                console.warn('[WHL Hooks] Failed to register add hook:', e);
            }

            // Pré-carga do cache com as mensagens que já estavam abertas antes
            // de a extensão iniciar. Sem isso, apagar/editar uma delas não tinha
            // de onde recuperar o conteúdo original.
            try {
                const models = typeof msgCollection.getModelsArray === 'function'
                    ? msgCollection.getModelsArray() || []
                    : [];
                const recent = models.slice(-MESSAGE_CACHE_SEED_LIMIT);
                for (const m of recent) cachearMensagem(m, { seed: true });
                console.log(`[WHL Hooks] Cache pré-carregado com ${recent.length} mensagens já abertas`);
            } catch (e) {
                console.warn('[WHL Hooks] Falha na pré-carga do cache:', e);
            }

            // A pré-carga acima roda quando a extensão inicia — em geral ANTES de
            // o WhatsApp carregar as conversas — e o WhatsApp pode carregar as
            // mensagens antigas de um chat sem emitir 'add'. Então, a cada
            // poucos segundos, as mensagens da conversa aberta que ainda não
            // estão no cache entram nele (só as que faltam: é barato).
            if (!MessageCreatedHook._sweepTimer) {
                MessageCreatedHook._sweepTimer = setInterval(() => {
                    let added = 0;
                    try { added += MessageCreatedHook.cachearConversaAberta(); } catch (_) { /* ignore */ }
                    try { added += MessageCreatedHook.cachearColecaoGlobal(); } catch (_) { /* ignore */ }
                    recoverDiag.sweeps++;
                    recoverDiag.sweepAdded += added;
                }, ACTIVE_CHAT_SWEEP_MS);
            }
        }

        // Mensagens carregadas em qualquer conversa (a coleção geral), as mais
        // recentes primeiro — cobre o que entrou sem 'add' fora do chat aberto.
        static cachearColecaoGlobal() {
            const coll = getMsgCollection();
            if (!coll || typeof coll.getModelsArray !== 'function') return 0;
            const models = coll.getModelsArray() || [];
            const recent = models.length > GLOBAL_SWEEP_LIMIT
                ? [...models].sort((a, b) => (Number(b && b.t) || 0) - (Number(a && a.t) || 0)).slice(0, GLOBAL_SWEEP_LIMIT)
                : models;
            let added = 0;
            for (const m of recent) {
                const id = m && m.id && m.id.id;
                if (!id || m.type === 'revoked' || !precisaRecachear(m, id)) continue;
                cachearMensagem(m, { seed: true });
                added++;
            }
            return added;
        }

        static cachearConversaAberta() {
            const mod = tryRequireModule('WAWebChatCollection');
            const chats = mod && (mod.ChatCollection || (mod.default && mod.default.ChatCollection));
            if (!chats) return 0;
            let active = null;
            try {
                active = typeof chats.getActive === 'function' ? chats.getActive() : null;
                if (!active && typeof chats.getModelsArray === 'function') {
                    active = chats.getModelsArray().find(c => c && c.active) || null;
                }
            } catch (_) { active = null; }
            const msgs = active && active.msgs && typeof active.msgs.getModelsArray === 'function'
                ? active.msgs.getModelsArray() : [];
            let added = 0;
            for (const m of msgs.slice(-MESSAGE_CACHE_SEED_LIMIT)) {
                const id = m && m.id && m.id.id;
                if (!id || m.type === 'revoked' || !precisaRecachear(m, id)) continue;
                cachearMensagem(m, { seed: true });
                added++;
            }
            return added;
        }

        static handle_created_message(message) {
            if (!message) return;
            recoverDiag.adds++;

            // Modelo que já chega revogado (alguns fluxos trocam o modelo em
            // vez de mudar o tipo). Registra só se o cache tinha o conteúdo —
            // abrir um chat também "adiciona" revogações antigas.
            if (message.type === 'revoked') {
                registrarRevogacaoDoStore(message, { requireCached: true });
                return;
            }

            // FIX v9.6.5: era `cacheMessage(message)` — função inexistente neste
            // escopo (cacheMessage existe só em recover-dom.js, módulo separado).
            // Resultado do bug: o handler do Msg.on('add') jogava ReferenceError
            // silencioso a cada mensagem nova do contato, o messageCache local
            // do wpp-hooks nunca era populado, e quando o contato editava a
            // mensagem o `salvarMensagemEditada` não conseguia recuperar o
            // body anterior do cache pra mostrar "antes/depois". A função
            // correta é `cachearMensagem` (definida em 01-init-debug.js).
            //
            // isNewMsg === false: mensagem ANTIGA carregada ao abrir um chat.
            // Só entra no cache — sem o aviso de "mensagem recebida" (que aciona
            // o Copiloto/piloto automático) e sem download antecipado.
            const isOld = message.isNewMsg === false;
            cachearMensagem(message, { seed: isOld });
            if (isOld) return;

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
            
            const msgCollection = getMsgCollection();
            if (!msgCollection) {
                console.warn('[WHL Hooks] Msg store not available for ack hook');
                return;
            }

            try {
                msgCollection.on('change:ack', (msg, ack) => {
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

    // ===== HOOK: REVOGAÇÃO VISTA NO STORE (change:type → 'revoked') =====
    // Mensagem apagada "para todos" vira type === 'revoked' no modelo — tanto
    // as do contato quanto as SUAS (apagadas aqui ou no celular). O
    // revoke_handler só via o protocolo recebido em processRenderableMessages,
    // então as suas nunca entravam no Recover. Mesmo evento usado pelo
    // whatsapp-web.js (message_revoke_everyone). Duplicatas com o
    // revoke_handler são barradas pelo id em registrarRevogacaoDoStore.
    class RevokeChangeHook extends Hook {
        register() {
            if (this.is_registered) return;
            super.register();

            const msgCollection = getMsgCollection();
            if (!msgCollection) {
                console.warn('[WHL Hooks] Msg store not available for revoke hook');
                return;
            }
            try {
                msgCollection.on('change:type', (msg) => {
                    try {
                        if (msg && msg.type === 'revoked') registrarRevogacaoDoStore(msg);
                    } catch (e) {
                        console.warn('[WHL Hooks] revoke (change:type) error:', e);
                    }
                });
                console.log('[WHL Hooks] RevokeChangeHook registered on Msg.on("change:type")');
            } catch (e) {
                console.warn('[WHL Hooks] Failed to register revoke hook:', e);
            }
        }
    }

    /**
     * Diagnóstico do Recover — rode no console do WhatsApp Web:
     *   WHL_RecoverDiag()
     * Mostra se os ganchos estão ativos, o que está no cache e, para cada
     * exclusão recente, de onde veio o conteúdo (cache, anteriores, modelo,
     * tela) ou "nenhuma".
     */
    window.WHL_RecoverDiag = function () {
        const coll = getMsgCollection();
        let models = 0;
        try { models = coll && typeof coll.getModelsArray === 'function' ? coll.getModelsArray().length : 0; } catch (_) { models = -1; }
        const ids = new Set();
        let midias = 0;
        messageCache.forEach((v) => {
            if (!v || ids.has(v)) return;
            ids.add(v);
            if (v.isMedia) midias++;
        });
        let dm = false;
        try {
            const mod = tryRequireModule('WAWebDownloadManager');
            const d = mod && (mod.downloadManager || (mod.default && mod.default.downloadManager));
            dm = !!(d && typeof d.downloadAndMaybeDecrypt === 'function');
        } catch (_) { dm = false; }
        const out = {
            colecaoDeMensagens: !!coll,
            ouvintes: coll && coll.handlers ? Object.keys(coll.handlers) : undefined,
            mensagensNaColecao: models,
            eventosAdd: recoverDiag.adds,
            mensagensNoCache: ids.size,
            midiasNoCache: midias,
            varreduras: recoverDiag.sweeps,
            adicionadasPelaVarredura: recoverDiag.sweepAdded,
            atualizadasPelaVarredura: recoverDiag.sweepRefreshed,
            downloadDeMidia: dm,
            ultimasExclusoes: recoverDiag.revokes.slice(-10),
            ultimosDownloads: recoverDiag.downloads.slice(-10)
        };
        try { console.log('[WHL Recover] Diagnóstico:', JSON.stringify(out, null, 2)); } catch (_) { /* ignore */ }
        return out;
    };

    const hooks = {
        keep_revoked_messages: new RenderableMessageHook(),
        keep_store_revokes: new RevokeChangeHook(),
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
