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
        // v9.7.0: reescrita p/ garantir PTT NATIVO (ícone de áudio gravado, não de
        // arquivo anexado). Causa do bug anterior:
        //   1) Camada 2 (MediaPrep) resolvia o chat por `chats.find(c => c.active)`,
        //      retornando um chat com id `@lid` em WA 2.3000.x. Aí
        //      `sendMediaMsgToChat` quebrava com "Cannot read properties of
        //      undefined (reading 'id')".
        //   2) Quando MediaPrep falhava, caía para Camadas 2.5/3/4 que injetavam o
        //      arquivo via DOM (paste/file input) — WA Web trata mídia colada como
        //      DOCUMENTO, então o destinatário via "ícone de áudio anexado", não
        //      uma bolha de PTT.
        // Fix: resolver chat com WidFactory.createWid(`${phone}@c.us`) +
        // ChatCollection.get(wid) (cria/adiciona se ausente), forçar mimetype
        // `audio/ogg;codecs=opus` (sem espaço) e medir duração real via
        // AudioContext.decodeAudioData. Sem fallback DOM — se PTT nativo falhar,
        // falha visível em vez de mascarar como documento.
        console.log('[WHL Hooks] 🎤 ========== INICIANDO ENVIO DE ÁUDIO (PTT NATIVO) ==========');
        console.log('[WHL Hooks] 🎤 Telefone:', phoneNumber);
        console.log('[WHL Hooks] 🎤 Filename:', filename);
        if (extraText) console.log('[WHL Hooks] 🎤 Texto associado (len):', String(extraText).length);

        await ensureModulesReady(3000);

        const pickAny = (mod, ...names) => {
            if (!mod) return null;
            for (const n of names) {
                if (mod[n] != null) return mod[n];
                if (mod.default && mod.default[n] != null) return mod.default[n];
            }
            return null;
        };
        const safeReq = (n) => { try { return typeof require === 'function' ? require(n) : null; } catch (_) { return null; } };

        try {
            const textToSend = (extraText || '').trim();
            if (textToSend) {
                console.log('[WHL Hooks] 🎤 [TEXTO] Enviando texto associado ao áudio...');
                const textRes = await enviarMensagemAPI(phoneNumber, textToSend);
                if (!textRes?.success) {
                    console.warn('[WHL Hooks] ❌ [TEXTO] Falha:', textRes?.error);
                    return false;
                }
                await new Promise(r => setTimeout(r, 650));
                console.log('[WHL Hooks] 🎤 [TEXTO] ✅ Texto enviado');
            }
        } catch (e) {
            console.warn('[WHL Hooks] ❌ [TEXTO] Erro:', e?.message);
            return false;
        }

        let blob, delayMs;
        try {
            console.log('[WHL Hooks] 🎤 [CONVERSÃO] Convertendo DataURL para Blob...');
            const response = await fetch(audioDataUrl);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            blob = await response.blob();
            delayMs = calculatePostSendDelay(blob.size);
            console.log('[WHL Hooks] 🎤 [CONVERSÃO] ✅ Blob - Size:', blob.size, 'bytes, Type:', blob.type);
        } catch (e) {
            console.error('[WHL Hooks] ❌ [CONVERSÃO] Erro:', e.message);
            return false;
        }

        if (!blob || blob.size === 0) {
            console.error('[WHL Hooks] ❌ Áudio vazio');
            return false;
        }

        const PTT_MIMETYPE = 'audio/ogg;codecs=opus';

        let duration = 0;
        try {
            const ab = await blob.arrayBuffer();
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                const ctx = new AC();
                try {
                    const audio = await ctx.decodeAudioData(ab.slice(0));
                    duration = Math.max(1, Math.round(audio.duration));
                    console.log('[WHL Hooks] 🎤 [DURAÇÃO] Real (decodeAudioData):', duration, 's');
                } finally {
                    try { ctx.close?.(); } catch (_) {}
                }
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [DURAÇÃO] decodeAudioData falhou:', e?.message);
        }
        if (!duration) {
            duration = Math.max(1, Math.round(blob.size / 12000));
            console.log('[WHL Hooks] 🎤 [DURAÇÃO] Fallback por tamanho:', duration, 's');
        }

        if (window.WPP?.chat?.sendFileMessage) {
            try {
                console.log('[WHL Hooks] 🎤 [CAMADA 1/WPP] Tentando via WPP.js...');
                const chatId = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@c.us`;
                const pttFile = new File([blob], filename, { type: PTT_MIMETYPE });
                await window.WPP.chat.sendFileMessage(chatId, pttFile, {
                    type: 'audio',
                    isPtt: true,
                    mimetype: PTT_MIMETYPE,
                    filename: filename
                });
                console.log('[WHL Hooks] ✅ [CAMADA 1/WPP] PTT enviado via WPP.js');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            } catch (e) {
                console.warn('[WHL Hooks] ⚠️ [CAMADA 1/WPP] Falhou:', e?.message);
            }
        } else {
            console.log('[WHL Hooks] ⚠️ [CAMADA 1/WPP] WPP.js não disponível, pulando...');
        }

        try {
            console.log('[WHL Hooks] 🎤 [CAMADA 2/MediaPrep] Resolvendo módulos do WA...');
            const WFmod      = safeReq('WAWebWidFactory');
            const CCmod      = safeReq('WAWebChatCollection');
            const CMmod      = safeReq('WAWebChatModel');
            const MediaPrep  = safeReq('WAWebMediaPrep');
            const OpaqueData = safeReq('WAWebMediaOpaqueData');

            const WFns = pickAny(WFmod, 'WidFactory') || WFmod?.default || WFmod;
            const createWid =
                pickAny(WFmod, 'createWid')
                || (typeof WFns === 'function' ? WFns : null)
                || pickAny(WFns, 'createWid');
            const ChatCollection = pickAny(CCmod, 'ChatCollection') || CCmod?.default || CCmod;
            const ChatCtor = pickAny(CMmod, 'Chat', 'ChatModel');

            if (!createWid)       throw new Error('createWid indisponível');
            if (!ChatCollection)  throw new Error('ChatCollection indisponível');
            if (!MediaPrep)       throw new Error('WAWebMediaPrep indisponível');
            if (!OpaqueData)      throw new Error('WAWebMediaOpaqueData indisponível');

            const phoneClean = String(phoneNumber).replace(/\D/g, '');
            const wid = createWid(phoneClean + '@c.us');
            let chat = ChatCollection.get?.(wid);
            if (!chat && ChatCtor) {
                chat = new ChatCtor({ id: wid });
                ChatCollection.add?.(chat);
            }
            if (!chat && typeof ChatCollection.find === 'function') {
                chat = await ChatCollection.find(wid);
            }
            if (!chat) throw new Error('Chat não pôde ser criado para ' + phoneClean);
            console.log('[WHL Hooks] 🎤 [CAMADA 2/MediaPrep] Chat resolvido (@c.us):', chat.id?._serialized);

            console.log('[WHL Hooks] 🎤 [CAMADA 2/MediaPrep] Criando OpaqueData (mimetype forçado:', PTT_MIMETYPE + ')');
            let mediaBlob;
            if (typeof OpaqueData.createFromData === 'function') {
                mediaBlob = await OpaqueData.createFromData(blob, PTT_MIMETYPE);
            } else if (typeof OpaqueData.create === 'function') {
                mediaBlob = await OpaqueData.create(blob, PTT_MIMETYPE);
            } else {
                throw new Error('OpaqueData sem createFromData/create');
            }

            console.log('[WHL Hooks] 🎤 [CAMADA 2/MediaPrep] Criando MediaPrep PTT (duration:', duration + 's)');
            const mediaPropsPromise = Promise.resolve({
                mediaBlob: mediaBlob,
                mimetype: PTT_MIMETYPE,
                type: 'ptt',
                duration: duration,
                seconds: duration,
                isPtt: true,
                ptt: true
            });

            const prep = new MediaPrep.MediaPrep('ptt', mediaPropsPromise);
            await prep.waitForPrep();
            console.log('[WHL Hooks] 🎤 [CAMADA 2/MediaPrep] Prep pronto, chamando sendMediaMsgToChat...');

            // ⚠️ SHAPE crítica: a partir de WA 2.3000+ tanto prep.sendToChat
            // quanto MediaPrep.sendMediaMsgToChat recebem UM OBJETO de opções,
            // não args posicionais (prep, chat, opts). Passar (prep, chat, {})
            // como antes fazia o WA tentar ler chat.chat → undefined → crash
            // interno com "Cannot read properties of undefined (reading 'id')".
            // O source de sendToChat é:
            //   function(t){var e=t.chat,n=t.earlyUpload,r=t.options;
            //   return promiseCallSync(x,null,{chat:e,earlyUpload:n,options:r,prep:this})}
            // O método prep.sendToChat é o caminho oficial e equivalente.
            const result = await prep.sendToChat({ chat, options: {} });
            console.log('[WHL Hooks] 🎤 [CAMADA 2/MediaPrep] messageSendResult:', result?.messageSendResult);

            if (result?.messageSendResult === 'OK') {
                console.log('[WHL Hooks] ✅ [CAMADA 2/MediaPrep] PTT enviado com sucesso!');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            }
            throw new Error('messageSendResult inesperado: ' + JSON.stringify(result));
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [CAMADA 2/MediaPrep] Falhou:', e?.message);
            console.warn('[WHL Hooks] ⚠️ [CAMADA 2/MediaPrep] Stack:', e?.stack);
        }

        // Fallback de segurança: se as camadas PTT (WPP + MediaPrep) falharem,
        // tentamos enviar como arquivo via sendFileDirect. Isso degrada a UX
        // (chega como documento de áudio em vez de bolha de PTT), mas evita
        // perder a mensagem inteira em campanhas. Os logs warn acima deixam
        // claro no console quando a degradação aconteceu, para debug futuro
        // do PTT nativo.
        console.warn('[WHL Hooks] ⚠️ ⚠️ ⚠️  PTT NATIVO FALHOU — caindo para fallback de arquivo');
        console.warn('[WHL Hooks] ⚠️ ⚠️ ⚠️  (áudio chegará como documento; ver logs CAMADA 1/2 acima)');
        try {
            const fallbackResult = await sendFileDirect(phoneNumber, audioDataUrl, filename, '', '');
            if (fallbackResult) {
                console.log('[WHL Hooks] 🎤 [FALLBACK] Áudio enviado como arquivo (não-PTT)');
                return true;
            }
        } catch (e) {
            console.error('[WHL Hooks] ❌ [FALLBACK] sendFileDirect também falhou:', e?.message);
        }

        console.error('[WHL Hooks] ❌ ========== FALHA NO ENVIO PTT NATIVO ==========');
        console.error('[WHL Hooks] 💡 Verifique se WAWebMediaPrep/MediaOpaqueData estão expostos nesta versão do WA Web');
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
                // v9.6.0: antes só logava e seguia — o extractor falhava com erro
                // genérico porque #main header não existia. Agora falhamos com
                // mensagem clara que aparece na UI do painel.
                throw new Error('Não foi possível abrir o chat do grupo. Tente abrir o grupo manualmente uma vez e clicar em Extrair de novo.');
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
     * Abre o chat do grupo usando API interna do WhatsApp (com verificação).
     *
     * v9.6.0: a versão anterior retornava `true` em vários caminhos sem
     * verificar se o chat de fato abriu — o chamador (extractGroupMembersUltra)
     * tocava o WhatsAppExtractor sem o chat correto na tela e a extração
     * falhava. Agora a função:
     *   1) checa via `ChatCollection.get(groupId).active === true` (sinal
     *      autoritativo da WA) e via header como fallback;
     *   2) tenta cada método em ordem e SÓ retorna true após verificação;
     *   3) cai pra busca no `#pane-side` (com scroll p/ contornar a
     *      virtualização) como último recurso.
     *
     * @param {string} groupId - ID do grupo (_serialized)
     * @returns {Promise<boolean>} - true se chat foi aberto
     */
    async function abrirChatDoGrupo(groupId) {
        console.log('[WHL] Abrindo chat do grupo:', groupId);

        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const idCore = String(groupId).replace('@g.us', '').replace('@c.us', '');

        function getChat() {
            try { return require('WAWebChatCollection')?.ChatCollection?.get(groupId) || null; }
            catch (_) { return null; }
        }
        function getGroupName() {
            const chat = getChat();
            return (chat?.formattedTitle || chat?.name || chat?.groupMetadata?.subject ||
                    chat?.contact?.name || '').trim();
        }

        // v9.7.x: header é o único sinal confiável neste WA build (2.3000.x).
        // Múltiplos seletores + comparação por nome normalizado (sem acento/case/
        // espaço extra) — o usuário comprovou no console que o openChatAt mente
        // (joga erro mas em alguns casos o header muda).
        const norm = (s) => (s || '').toString()
            .toLowerCase()
            .normalize('NFD').replace(/\p{Diacritic}/gu, '')
            .replace(/\s+/g, ' ').trim();

        function headerMatches(name) {
            if (!name) return false;
            const target = norm(name);
            const sels = [
                '#main header span[title]',
                '#main header span[dir="auto"]',
                '#main header div[title]',
                '#main header span',
            ];
            for (const sel of sels) {
                for (const el of document.querySelectorAll(sel)) {
                    const t = norm(el.getAttribute('title') || el.textContent || '');
                    if (!t || t.length < 2) continue;
                    if (t === target) return true;
                    // Match parcial: header pode incluir "X membros" depois do nome.
                    if (target.length > 4 && t.startsWith(target)) return true;
                    if (target.length > 4 && target.includes(t) && t.length > 4) return true;
                }
            }
            return false;
        }

        async function waitHeaderMatches(name, timeoutMs = 4000) {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                if (headerMatches(name)) return true;
                await sleep(150);
            }
            return false;
        }

        // v9.6.4: handlers React do WA 2.3000.x ignoram .click() puro — só
        // reagem à sequência pointerover→pointerdown→pointerup→click com
        // coordenadas. Esse helper foi validado pelo usuário no console:
        // método "human-click-sidebar" retornou ok=true.
        function humanClick(el) {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            const opts = {
                bubbles: true, cancelable: true, view: window,
                clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 1,
            };
            const seq = [
                ['pointerover',  PointerEvent], ['mouseover',  MouseEvent],
                ['pointermove',  PointerEvent], ['mousemove',  MouseEvent],
                ['pointerdown',  PointerEvent], ['mousedown',  MouseEvent],
                ['pointerup',    PointerEvent], ['mouseup',    MouseEvent],
                ['click',        MouseEvent],
            ];
            try {
                el.focus?.();
                for (const [type, E] of seq) el.dispatchEvent(new E(type, opts));
                return true;
            } catch (_) {
                try { el.click(); return true; } catch { return false; }
            }
        }

        // Procura a linha do grupo no #pane-side. Prioridade:
        // 1) [data-id="<chatId>"] (mais preciso quando WA expõe)
        // 2) varredura por role=row + casamento de nome (norm)
        // Devolve o elemento mais clicável encontrado.
        function findSidebarRow(name) {
            const target = norm(name);
            try {
                const byId = document.querySelector(`[data-id="${CSS.escape(groupId)}"]`);
                if (byId) return byId.closest('[role="row"], [data-testid="cell-frame-container"]') || byId;
            } catch (_) {}
            const pane = document.querySelector('#pane-side');
            if (!pane) return null;
            const rows = pane.querySelectorAll('[role="row"], [data-testid="cell-frame-container"], [role="listitem"]');
            for (const row of rows) {
                const titleEl = row.querySelector('span[title]');
                const t = norm(titleEl?.getAttribute('title') || titleEl?.textContent || '');
                if (t === target) {
                    return row.querySelector('[data-testid="cell-frame-container"]') ||
                           row.querySelector('[role="gridcell"][tabindex="0"]') || row;
                }
            }
            return null;
        }

        // Tenta clicar na linha e esperar o header mudar. Devolve true se abriu.
        async function clickRowAndWait(row, name) {
            if (!row) return false;
            humanClick(row);
            return await waitHeaderMatches(name, 5000);
        }

        // Rola o pane até a linha aparecer (DEPOIS de já termos confirmado que
        // ela não está visível). Não mexe no scroll se já achou.
        async function scrollUntilFound(name, maxScrolls = 60) {
            const pane = document.querySelector('#pane-side');
            if (!pane) return null;
            // NOTA: NÃO resetamos scrollTop=0 aqui. Se o user já rolou pra um
            // ponto onde aparece, queremos achar lá. Só se nada aparecer, vamos
            // do topo (último recurso, no loop abaixo).
            for (let i = 0; i < maxScrolls; i++) {
                const hit = findSidebarRow(name);
                if (hit) { hit.scrollIntoView({ block: 'center' }); await sleep(150); return hit; }
                const prev = pane.scrollTop;
                pane.scrollTop += pane.clientHeight * 0.85;
                await sleep(180);
                if (pane.scrollTop === prev) break; // chegou no fim
            }
            // Tentativa final do topo.
            pane.scrollTop = 0;
            await sleep(250);
            for (let i = 0; i < maxScrolls; i++) {
                const hit = findSidebarRow(name);
                if (hit) { hit.scrollIntoView({ block: 'center' }); await sleep(150); return hit; }
                const prev = pane.scrollTop;
                pane.scrollTop += pane.clientHeight * 0.85;
                await sleep(180);
                if (pane.scrollTop === prev) break;
            }
            return null;
        }

        async function clickTab(labels) {
            const target = labels.map(norm);
            const matches = (el) => {
                const aria = norm(el.getAttribute('aria-label') || '');
                const txt  = norm(el.textContent || '');
                return target.some(L => {
                    if (!L) return false;
                    if (aria === L || aria.startsWith(L + ' ')) return true;
                    // textContent: tab pode ter número grudado ("grupos13") ou
                    // ícone como prefixo. startsWith(L) é tolerante a ambos.
                    if (txt === L || txt.startsWith(L + ' ') || txt.startsWith(L)) return true;
                    if (L.length >= 5 && txt.includes(L)) return true;
                    return false;
                });
            };
            // v9.7.x: 1ª passada é [role="tab"] (as abas REAIS — diagnóstico do
            // user confirmou: tab #0 Tudo, #1 Não lidas, #2 Favoritas, #3 Grupos).
            // 2ª passada cai pra <button> genérico só se nada casou — evita
            // pegar os botões "measurement-..." invisíveis que coincidem com
            // o texto e estão antes na ordem do DOM.
            for (const b of document.querySelectorAll('[role="tab"]')) {
                if (matches(b)) {
                    try { humanClick(b); await sleep(600); return true; } catch (_) {}
                }
            }
            for (const b of document.querySelectorAll('button, [role="button"]')) {
                if (matches(b)) {
                    try { humanClick(b); await sleep(600); return true; } catch (_) {}
                }
            }
            return false;
        }

        async function openArchived() {
            const pane = document.querySelector('#pane-side');
            if (!pane) return false;
            // v9.7.x: 1ª tentativa é aria-label limpo ("Arquivadas " no diagnóstico).
            // O textContent vem com prefixo "archive-refreshed" do span de ícone,
            // então startsWith('arquivad') falhava.
            const ariaBtn = pane.querySelector('[aria-label*="rquivad" i],[aria-label*="rchived" i]');
            if (ariaBtn) {
                try { humanClick(ariaBtn); await sleep(700); return true; } catch (_) {}
            }
            // 2ª tentativa: scan por textContent incluindo "arquivad" e usando
            // BUTTON nativo (que não casava com [role="button"]).
            const all = pane.querySelectorAll('button, [role="button"], [role="row"], [data-testid="cell-frame-container"]');
            for (const r of all) {
                const t = norm(r.textContent);
                if (t.includes('arquivad') || t.includes('archived')) {
                    try { humanClick(r); await sleep(700); return true; } catch (_) {}
                }
            }
            return false;
        }

        async function backToAllTab() {
            try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
            await sleep(300);
            await clickTab(['Tudo', 'All']);
        }

        async function maybeUnarchive() {
            const chat = getChat();
            if (!chat || chat.archive !== true) return false;
            if (typeof chat.setArchive !== 'function') return false;
            try {
                console.log('[WHL] Grupo arquivado — desarquivando temporariamente');
                await chat.setArchive(false);
                await sleep(800);
                return true;
            } catch (e) { console.warn('[WHL] setArchive(false) falhou:', e?.message); }
            return false;
        }

        // ===== Estratégia principal =====
        const groupName = getGroupName();
        if (!groupName) {
            console.warn('[WHL] Grupo não encontrado na ChatCollection:', groupId);
            return false;
        }
        if (headerMatches(groupName)) { console.log('[WHL] Chat já estava aberto'); return true; }

        const CC = (() => { try { return require('WAWebChatCollection'); } catch (_) { return null; } })();
        const CMD = (() => { try { return require('WAWebCmd'); } catch (_) { return null; } })();
        const chat = CC?.ChatCollection?.get(groupId);
        const isArchived = chat?.archive === true;

        // ── CASO ARQUIVADO: abre a view "Arquivadas" e clica lá DENTRO ───────
        // Caminho limpo — NÃO desarquiva o grupo (sem efeito colateral no estado
        // do usuário). Roda antes de tudo quando detectamos archive=true.
        if (isArchived) {
            console.log('[WHL] Grupo está arquivado — abrindo via view Arquivadas');
            if (await openArchived()) {
                await sleep(500);
                let aRow = await scrollUntilFound(groupName);
                if (aRow && await clickRowAndWait(aRow, groupName)) {
                    console.log('[WHL] ✅ Chat aberto via Arquivadas (sem desarquivar)');
                    // Volta a lista pro estado normal (sai da view Arquivadas).
                    try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
                    return true;
                }
                try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
                await sleep(300);
            }
            // Só se a view Arquivadas falhar: desarquiva como último recurso
            // (efeito colateral aceito — sem isso o grupo fica inacessível).
            if (await maybeUnarchive()) {
                const uRow = findSidebarRow(groupName);
                if (uRow && await clickRowAndWait(uRow, groupName)) {
                    console.log('[WHL] ✅ Chat aberto após desarquivar (fallback)');
                    return true;
                }
            }
        }

        // ── ESTRATÉGIA 1: clique direto na linha visível ────────────────────
        // No teste do usuário (`openChatRobust`), o método `human-click-sidebar`
        // foi o que abriu — sem precisar de API nem scroll. Estratégia principal
        // pra grupos não-arquivados (sempre aparecem na lista "Tudo").
        let row = findSidebarRow(groupName);
        if (row && await clickRowAndWait(row, groupName)) {
            console.log('[WHL] ✅ Chat aberto via clique direto na sidebar');
            return true;
        }

        // ── ESTRATÉGIA 2: APIs internas (rápido, raramente vinga em 2.3000.x)
        // Cmd.openChatAt no 2.3000.x explode lendo `.id` de undefined (espera
        // um message-key como 2º arg). Tentamos com lastReceivedKey quando
        // disponível; se falhar, ignoramos silenciosamente.
        const lastMsgKey = chat?.lastReceivedKey || chat?.lastMessageKey || null;
        const apiAttempts = [
            ['Cmd.openChatAt(chat,lastKey)', () => CMD?.openChatAt?.(chat, lastMsgKey)],
            ['sendSeen+open',                async () => { try { await chat?.sendSeen?.(); } catch (_) {} return chat?.open?.(); }],
            ['CC.setActive',                 () => CC?.ChatCollection?.setActive?.(chat)],
        ];
        for (const [label, fn] of apiAttempts) {
            try { await fn(); } catch (_) { /* erros aqui são esperados */ }
            if (await waitHeaderMatches(groupName, 1200)) {
                console.log('[WHL] ✅ Chat aberto via', label);
                return true;
            }
        }

        // ── ESTRATÉGIA 3: aba Tudo + scroll + clique humano ─────────────────
        // Pra grupos que estão na lista mas fora da viewport (precisa rolar).
        console.log('[WHL] DOM: aba Tudo + scroll + clique humano');
        await clickTab(['Tudo', 'All']);
        await sleep(400);
        row = await scrollUntilFound(groupName);
        if (row && await clickRowAndWait(row, groupName)) {
            console.log('[WHL] ✅ Chat aberto via DOM (aba Tudo + scroll)');
            return true;
        }

        // ── ESTRATÉGIA 4: aba Grupos + scroll ───────────────────────────────
        // O filtro "Grupos" mostra só grupos — útil se o nome colide com contato
        // ou a lista Tudo é gigante.
        console.log('[WHL] DOM: aba Grupos + scroll');
        if (await clickTab(['Grupos', 'Groups'])) {
            await sleep(400);
            row = await scrollUntilFound(groupName);
            if (row && await clickRowAndWait(row, groupName)) {
                console.log('[WHL] ✅ Chat aberto via DOM (aba Grupos)');
                await backToAllTab();
                return true;
            }
            await backToAllTab();
        }

        // ── ESTRATÉGIA 5: Arquivadas + scroll (rede de segurança — caso o
        // archive flag não estivesse setado mas o grupo esteja lá) ───────────
        if (!isArchived) {
            console.log('[WHL] DOM: Arquivadas + scroll (rede de segurança)');
            if (await openArchived()) {
                await sleep(400);
                row = await scrollUntilFound(groupName);
                if (row && await clickRowAndWait(row, groupName)) {
                    console.log('[WHL] ✅ Chat aberto via DOM (Arquivadas)');
                    try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
                    return true;
                }
                try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (_) {}
                await sleep(300);
            }
        }

        console.warn('[WHL] ❌ Não foi possível abrir o chat do grupo:', groupId, '(nome:', groupName, ')');
        return false;
    }
