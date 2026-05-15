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
            const { phone, audioData, audioDataUrl, filename, text, requestId } = event.data;
            try {
                const success = await sendAudioDirect(phone, audioData || audioDataUrl, filename, text);
                window.postMessage({
                    type: 'WHL_SEND_AUDIO_RESULT',
                    success,
                    phone,
                    requestId
                }, window.location.origin);
            } catch (error) {
                window.postMessage({
                    type: 'WHL_SEND_AUDIO_RESULT',
                    success: false,
                    phone,
                    requestId,
                    error: error.message
                }, window.location.origin);
            }
        }
        
        // ABRIR CHAT (sem enviar) — usado pelo botão "Mensagem" do CRM.
        // Reusa abrirChatPorNumero (mesmo caminho do Disparo), que roda no
        // page-world e enxerga WPP/Store — diferente do content script.
        if (type === 'WHL_OPEN_CHAT_DIRECT') {
            const { phone, requestId } = event.data;
            (async () => {
                let success = false;
                try {
                    success = await abrirChatPorNumero(String(phone || '').replace(/\D/g, ''));
                } catch (error) {
                    console.warn('[WHL Hooks] WHL_OPEN_CHAT_DIRECT falhou:', error?.message);
                }
                window.postMessage({
                    type: 'WHL_OPEN_CHAT_DIRECT_RESULT',
                    requestId,
                    success: !!success
                }, window.location.origin);
            })();
        }

        // ENVIAR ARQUIVO/DOCUMENTO DIRETAMENTE
        if (type === 'WHL_SEND_FILE_DIRECT') {
            const { phone, fileData, filename, caption, text, requestId } = event.data;
            try {
                const success = await sendFileDirect(phone, fileData, filename, caption, text);
                window.postMessage({
                    type: 'WHL_SEND_FILE_RESULT',
                    success,
                    phone,
                    requestId
                }, window.location.origin);
            } catch (error) {
                window.postMessage({
                    type: 'WHL_SEND_FILE_RESULT',
                    success: false,
                    phone,
                    requestId,
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


