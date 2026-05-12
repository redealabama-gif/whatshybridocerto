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
        try {
            if (!MODULES.WID_FACTORY || !MODULES.CHAT_COLLECTION) {
                console.warn('[WHL Hooks] Módulos necessários não disponíveis para sendImageDirect');
                return false;
            }
            
            const wid = MODULES.WID_FACTORY.createWid(phoneNumber + '@c.us');
            let chat = MODULES.CHAT_COLLECTION?.ChatCollection?.get?.(wid);
            
            if (!chat) {
                console.log('[WHL Hooks] Chat não encontrado para envio de imagem');
                return false;
            }
            
            // Converter data URL para blob
            const response = await fetch(imageDataUrl);
            const blob = await response.blob();
            const file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
            
            // Preparar mídia usando API interna
            if (MODULES.MEDIA_PREP && typeof MODULES.MEDIA_PREP.prepareMedia === 'function') {
                const mediaData = await MODULES.MEDIA_PREP.prepareMedia(file);
                
                // Validar que sendMessage aceita mídia
                if (!chat.sendMessage || typeof chat.sendMessage !== 'function') {
                    console.warn('[WHL Hooks] chat.sendMessage não disponível');
                    return false;
                }
                
                // Enviar com caption
                try {
                    await chat.sendMessage(mediaData, { caption });
                    console.log('[WHL Hooks] ✅ Imagem enviada via API para', phoneNumber);
                    return true;
                } catch (sendError) {
                    console.error('[WHL Hooks] Erro ao chamar sendMessage com mídia:', sendError);
                    return false;
                }
            } else {
                // Fallback: tentar envio simples se MEDIA_PREP não disponível
                console.log('[WHL Hooks] MEDIA_PREP não disponível, usando fallback');
                return false;
