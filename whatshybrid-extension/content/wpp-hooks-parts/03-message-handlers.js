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
     * Envia áudio como PTT (voice note nativo do WhatsApp).
     *
     * Estratégia em duas fases:
     *  - FASE 1 (PTT): tenta 3 caminhos via API interna do WA (MediaPrep,
     *    chat.sendMessage com File, prepareMedia+chat.sendMessage). Se qualquer
     *    um dos três funcionar, a mensagem chega como voice note nativo.
     *  - FASE 2 (FALLBACK): só executa se FASE 1 inteira falhar. Cai para
     *    sendFileDirect, garantindo que o áudio chegue (mesmo com aparência de
     *    documento) em vez de simplesmente não enviar. Logs deixam explícito que
     *    a UX foi degradada para o usuário acompanhar pelo console.
     *
     * Chat resolution: prioriza chat já existente em ChatCollection (c.us OU
     * @lid), e só cria sintético via ChatModel como último recurso. Chats
     * sintéticos quebram sendMediaMsgToChat internamente em WA 2.3000.x.
     *
     * Observação: WhatsApp não permite legenda em PTT; quando há texto junto,
     * enviamos o texto como mensagem separada antes do áudio.
     */
    async function sendAudioDirect(phoneNumber, audioDataUrl, filename = 'voice.ogg', extraText = '') {
        console.log('[WHL Hooks] 🎤 ========== INICIANDO ENVIO DE ÁUDIO ==========');
        console.log('[WHL Hooks] 🎤 Telefone:', phoneNumber);
        console.log('[WHL Hooks] 🎤 Filename:', filename);
        if (extraText) console.log('[WHL Hooks] 🎤 Texto associado (len):', String(extraText).length);
        console.log('[WHL Hooks] 🎤 DataURL prefix:', audioDataUrl?.substring(0, 50));

        await ensureModulesReady(3000);

        // Texto associado vai como mensagem separada (PTT não aceita legenda).
        try {
            const textToSend = (extraText || '').trim();
            if (textToSend) {
                console.log('[WHL Hooks] 🎤 [TEXTO] Enviando texto associado...');
                const textRes = await enviarMensagemAPI(phoneNumber, textToSend);
                if (!textRes?.success) {
                    console.warn('[WHL Hooks] ❌ [TEXTO] Falha:', textRes?.error);
                    return false;
                }
                await new Promise(r => setTimeout(r, 650));
                console.log('[WHL Hooks] 🎤 [TEXTO] ✅ Enviado, prosseguindo com áudio');
            }
        } catch (e) {
            console.warn('[WHL Hooks] ❌ [TEXTO] Erro:', e?.message);
            return false;
        }

        // Mimetype PTT é fixo: WhatsApp só aceita OGG/Opus como voice note.
        const PTT_MIME = 'audio/ogg; codecs=opus';
        let blob, delayMs;
        try {
            const response = await fetch(audioDataUrl);
            if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
            const originalBlob = await response.blob();
            // Re-empacota o buffer com o mimetype PTT (preserva os bytes OGG já
            // existentes mas garante que o tipo declarado é o que o WA espera).
            blob = new Blob([await originalBlob.arrayBuffer()], { type: PTT_MIME });
            delayMs = calculatePostSendDelay(blob.size);
            console.log('[WHL Hooks] 🎤 Blob preparado:', blob.size, 'bytes, mime:', PTT_MIME);
        } catch (e) {
            console.error('[WHL Hooks] ❌ Erro ao processar áudio:', e.message);
            return false;
        }

        // Duração real via <audio> metadata. Sem fallback para size/10000
        // porque essa heurística mostra "0:04" pra áudios de 30s em alguns codecs.
        let durationSec = await new Promise((resolve) => {
            let done = false;
            const finish = (d) => {
                if (done) return;
                done = true;
                try { URL.revokeObjectURL(url); } catch (_) {}
                resolve(d);
            };
            const url = URL.createObjectURL(blob);
            const audio = document.createElement('audio');
            audio.preload = 'metadata';
            audio.onloadedmetadata = () => {
                const d = Math.round(audio.duration);
                finish(Number.isFinite(d) && d > 0 ? d : null);
            };
            audio.onerror = () => finish(null);
            audio.src = url;
            setTimeout(() => finish(null), 2000);
        });
        if (!durationSec) durationSec = Math.max(1, Math.round(blob.size / 10000));
        console.log('[WHL Hooks] 🎤 Duração:', durationSec, 'seg');

        // Resolve chat. Prioridade: c.us via WID > chat existente por user >
        // chat ativo (qualquer server). NÃO cria sintético porque ChatCtor com
        // só { id: wid } produz objeto que quebra sendMediaMsgToChat internamente.
        const phoneClean = String(phoneNumber || '').replace(/\D/g, '');
        let chat = null;
        try {
            await abrirChatPorNumero(phoneClean);
            await new Promise(r => setTimeout(r, 600));

            const safeReq = (n) => { try { return require(n); } catch (_) { return null; } };
            const WFmod = safeReq('WAWebWidFactory');
            const CCmod = safeReq('WAWebChatCollection');

            const createWid = WFmod?.createWid
                || WFmod?.WidFactory?.createWid
                || WFmod?.default?.createWid
                || (typeof WFmod === 'function' ? WFmod : null);
            const ChatCollection = CCmod?.ChatCollection || CCmod?.default || CCmod;

            if (!ChatCollection) throw new Error('ChatCollection indisponível');

            // 1) Tenta WID c.us direto
            if (createWid) {
                try {
                    const widCus = createWid(phoneClean + '@c.us');
                    chat = ChatCollection.get?.(widCus);
                } catch (_) {}
            }

            // 2) Tenta find async (carrega do servidor)
            if (!chat && createWid && typeof ChatCollection.find === 'function') {
                try {
                    const widCus = createWid(phoneClean + '@c.us');
                    chat = await ChatCollection.find(widCus);
                } catch (_) {}
            }

            // 3) Busca por user em models existentes (cobre @lid e @c.us)
            if (!chat) {
                const models = ChatCollection.getModelsArray?.() || [];
                chat = models.find(c => c.id?.user === phoneClean && c.id?.server === 'c.us')
                    || models.find(c => c.id?.user === phoneClean)
                    || models.find(c => c.active);
            }

            if (!chat) throw new Error('Chat não pôde ser resolvido');
            console.log('[WHL Hooks] 🎤 Chat resolvido:', chat.id?._serialized, '(server:', chat.id?.server, ')');
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ Resolver chat falhou:', e.message, '— indo direto pra fallback de arquivo');
            return await sendFileDirect(phoneNumber, audioDataUrl, filename, '', '');
        }

        // ╔══════════════════════════════════════════════════════════════╗
        // ║ FASE 1 — Tentativas PTT (voice note nativo)                  ║
        // ╚══════════════════════════════════════════════════════════════╝

        // TENTATIVA A: MediaPrep + sendMediaMsgToChat
        // Caminho principal. Em chats c.us funciona; em @lid pode lançar
        // "Cannot read properties of undefined (reading 'id')" dependendo da
        // versão do WA — daí as tentativas B e C.
        try {
            const MediaPrep = require('WAWebMediaPrep');
            const OpaqueData = require('WAWebMediaOpaqueData');
            if (!MediaPrep || !OpaqueData) throw new Error('MediaPrep/OpaqueData indisponíveis');

            const mediaBlob = (typeof OpaqueData.createFromData === 'function')
                ? await OpaqueData.createFromData(blob, PTT_MIME)
                : (typeof OpaqueData.create === 'function'
                    ? await OpaqueData.create(blob, PTT_MIME)
                    : null);
            if (!mediaBlob) throw new Error('OpaqueData não produziu mediaBlob');

            const mediaPropsPromise = Promise.resolve({
                mediaBlob,
                mimetype: PTT_MIME,
                type: 'ptt',
                duration: durationSec,
                seconds: durationSec,
                isPtt: true,
                ptt: true,
                filename
            });
            const prep = new MediaPrep.MediaPrep('ptt', mediaPropsPromise);
            await prep.waitForPrep();

            const result = await MediaPrep.sendMediaMsgToChat(prep, chat, {});
            console.log('[WHL Hooks] 🎤 [PTT-A] sendMediaMsgToChat result:', result?.messageSendResult);
            if (result?.messageSendResult === 'OK') {
                console.log('[WHL Hooks] ✅ [PTT-A] Voice note nativo enviado!');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [PTT-A] sendMediaMsgToChat falhou:', e?.message);
        }

        // TENTATIVA B: chat.sendMessage(File, opções) — passa File direto
        try {
            if (typeof chat.sendMessage !== 'function') throw new Error('chat.sendMessage indisponível');
            const file = new File([blob], filename || 'voice.ogg', { type: PTT_MIME });
            const result = await chat.sendMessage(file, {
                type: 'audio',
                isPtt: true,
                ptt: true,
                mimetype: PTT_MIME,
                duration: durationSec,
                seconds: durationSec,
                filename
            });
            console.log('[WHL Hooks] 🎤 [PTT-B] chat.sendMessage result:', result?.messageSendResult ?? result);
            if (result?.messageSendResult === 'OK' || result === true || (result && !result.error)) {
                console.log('[WHL Hooks] ✅ [PTT-B] Voice note nativo enviado!');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [PTT-B] chat.sendMessage falhou:', e?.message);
        }

        // TENTATIVA C: prepareMedia + chat.sendMessage (padrão sendImageDirect)
        try {
            if (typeof chat.sendMessage !== 'function') throw new Error('chat.sendMessage indisponível');
            const MP = MODULES?.MEDIA_PREP || (() => { try { return require('WAWebMediaPrep'); } catch (_) { return null; } })();
            if (!MP || typeof MP.prepareMedia !== 'function') throw new Error('prepareMedia indisponível');

            const file = new File([blob], filename || 'voice.ogg', { type: PTT_MIME });
            const mediaData = await MP.prepareMedia(file);
            if (mediaData && typeof mediaData === 'object') {
                mediaData.isPtt = true;
                mediaData.ptt = true;
                mediaData.type = 'ptt';
                mediaData.mimetype = PTT_MIME;
                mediaData.duration = durationSec;
                mediaData.seconds = durationSec;
            }
            const result = await chat.sendMessage(mediaData, {
                isPtt: true, ptt: true, type: 'ptt',
                duration: durationSec, seconds: durationSec
            });
            console.log('[WHL Hooks] 🎤 [PTT-C] prepareMedia+sendMessage result:', result?.messageSendResult ?? result);
            if (result?.messageSendResult === 'OK' || result === true || (result && !result.error)) {
                console.log('[WHL Hooks] ✅ [PTT-C] Voice note nativo enviado!');
                await new Promise(r => setTimeout(r, delayMs));
                return true;
            }
        } catch (e) {
            console.warn('[WHL Hooks] ⚠️ [PTT-C] prepareMedia falhou:', e?.message);
        }

        // ╔══════════════════════════════════════════════════════════════╗
        // ║ FASE 2 — Fallback de arquivo (UX degradada, mas envia)       ║
        // ╚══════════════════════════════════════════════════════════════╝
        // Chegamos aqui só se TODAS as 3 tentativas PTT falharam. Em vez de
        // perder a mensagem completamente, manda como documento — fica com
        // visual de "arquivo de áudio" no WhatsApp, mas o destinatário recebe
        // e consegue ouvir. Próxima sessão de debug deve focar em descobrir
        // por que PTT-A/B/C falham nesta build do WA.
        console.warn('[WHL Hooks] ⚠️ ⚠️ ⚠️  TODAS AS TENTATIVAS PTT FALHARAM');
        console.warn('[WHL Hooks] ⚠️ ⚠️ ⚠️  Caindo para FALLBACK DE ARQUIVO — áudio vai chegar como documento.');
        console.warn('[WHL Hooks] ⚠️ ⚠️ ⚠️  (UX degradada vs. voice note nativo; ver logs PTT-A/B/C acima.)');
        try {
            const fallbackResult = await sendFileDirect(phoneNumber, audioDataUrl, filename, '', '');
            if (fallbackResult) {
                console.log('[WHL Hooks] 🎤 [FALLBACK] Áudio enviado como arquivo (não-PTT)');
                return true;
            }
        } catch (e) {
            console.error('[WHL Hooks] ❌ [FALLBACK] sendFileDirect também falhou:', e?.message);
        }

        console.error('[WHL Hooks] ❌ ========== TODOS OS CAMINHOS FALHARAM ==========');
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
