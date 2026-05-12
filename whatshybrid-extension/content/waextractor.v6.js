// content.js - WhatsApp Group Extractor v6.0.7 (CORREÇÃO COMPLETA + CLEANUP)
console.log('[WA Extractor] Content script v6.0.7 carregado');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ========================================
// CONSTANTS
// ========================================
const RETRY_TIMEOUT_MS = 15000; // 15 seconds timeout for retry attempts
const RETRY_ATTEMPTS = 3; // Number of retry attempts for API calls
const RETRY_DELAY_MS = 500; // Delay between retry attempts

// ========================================
// INJETA SCRIPT EXTERNO
// ========================================
function injectPageScript() {
    if (window.__waExtractorInjected) return Promise.resolve();
    
    return new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('content/inject.js');
        script.onload = () => {
            console.log('[WA Extractor] inject.js carregado');
            window.__waExtractorInjected = true;
            resolve();
        };
        script.onerror = () => {
            console.log('[WA Extractor] Falha ao carregar inject.js');
            resolve();
        };
        (document.head || document.documentElement).appendChild(script);
    });
}

injectPageScript();

// ========================================
// DYNAMIC TIMEOUT CALCULATION
// ========================================
function calculateTimeout(estimatedMembers = 100) {
    const baseTimeout = 30000; // 30 seconds base
    const extraPerMember = 100; // 100ms per estimated member
    const maxTimeout = 180000; // maximum 3 minutes
    
    const calculated = baseTimeout + (estimatedMembers * extraPerMember);
    return Math.min(calculated, maxTimeout);
}

// ========================================
// COMUNICAÇÃO COM API INJETADA
// ========================================
function callPageAPI(type, data = {}, customTimeout = null) {
    // Calculate dynamic timeout based on estimated members or use custom timeout
    const estimatedMembers = data.estimatedMembers || 100;
    const timeoutDuration = customTimeout || calculateTimeout(estimatedMembers);
    
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            window.removeEventListener('message', handler);
            console.log('[WA Extractor] ⏱️ Timeout:', type);
            resolve({ success: false, error: '⏱️ Timeout. Tente novamente.' });
        }, timeoutDuration);

        function handler(event) {
            if (event.source !== window) return;
            if (!event.data || !event.data.type) return;

            const expectedType = type + '_RESULT';
            if (event.data.type !== expectedType) return;

            console.log('[WA Extractor] ✅ Resposta recebida:', event.data.type);
            clearTimeout(timeout);
            window.removeEventListener('message', handler);
            resolve(event.data);
        }

        window.addEventListener('message', handler);
        console.log('[WA Extractor] 📤 Enviando:', type, data);
        window.postMessage({ type, ...data }, window.location.origin);
    });
}

// ========================================
// LISTENER DE MENSAGENS (ISOLADO)
// ========================================
// IMPORTANTE:
// Este content script convive com outros content scripts do Fusion.
// Portanto, NÃO podemos responder (sendResponse/return true) para mensagens
// que não são destinadas ao Group Extractor v6, senão quebramos outras
// funcionalidades (ex: WHL_SIDE_PANEL do WhatsHybrid).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
        // Ignore bridge messages used by WhatsHybrid side panel router
        if (message?.type === 'WHL_SIDE_PANEL') {
            return false;
        }

        const action = message?.action;

        // Only handle actions that belong to the v6 extractor
        const allowedActions = new Set([
            'checkPage',
            'getGroups',
            'navigateToGroup',
            'extractMembers',
            'pauseExtraction',
            'resumeExtraction',
            'stopExtraction',
            'cleanupAfterExtraction',
            'getGroupName',
            'showTopPanel',
            'hideTopPanel'
        ]);

        if (!allowedActions.has(action)) {
            // Not for us → let other content scripts respond
            return false;
        }

        console.log('[WA Extractor] Mensagem recebida:', message);

        handleMessage(message).then(sendResponse).catch(error => {
            console.error('[WA Extractor] Erro:', error);
            sendResponse({ success: false, error: error?.message || String(error) });
        });

        return true;
    } catch (e) {
        // Never block other scripts
        return false;
    }
});

async function handleMessage(message) {
    switch (message.action) {
        case 'checkPage':
            return { 
                success: true, 
                isWhatsApp: window.location.href.includes('web.whatsapp.com') 
            };
            
        case 'getGroups':
            return await getGroups(message.includeArchived);
            
        case 'navigateToGroup':
            return await navigateToGroupWithRetry(
                message.groupId, 
                message.groupName, 
                message.isArchived
            );
            
        case 'extractMembers':
            return await extractMembers();

        case 'pauseExtraction':
            if (typeof WhatsAppExtractor !== 'undefined') {
                WhatsAppExtractor.pauseExtraction();
                return { success: true };
            }
            return { success: false, error: '🔄 Por favor, recarregue a página do WhatsApp Web e tente novamente.' };

        case 'resumeExtraction':
            if (typeof WhatsAppExtractor !== 'undefined') {
                WhatsAppExtractor.resumeExtraction();
                return { success: true };
            }
            return { success: false, error: '🔄 Por favor, recarregue a página do WhatsApp Web e tente novamente.' };

        case 'stopExtraction':
            if (typeof WhatsAppExtractor !== 'undefined') {
                WhatsAppExtractor.stopExtraction();
                return { success: true };
            }
            return { success: false, error: '🔄 Por favor, recarregue a página do WhatsApp Web e tente novamente.' };
            
        case 'cleanupAfterExtraction':
            return await cleanupAfterExtraction();
            
        case 'getGroupName':
            return { 
                success: true, 
                name: WhatsAppExtractor?.getGroupName() || 'Grupo' 
            };
        
        case 'showTopPanel':
            // Show top panel (handled by top-panel-injector.js via custom event)
            window.dispatchEvent(new CustomEvent('wa-extractor-show-top-panel'));
            return { success: true };
        
        case 'hideTopPanel':
            // Hide top panel (handled by top-panel-injector.js via custom event)
            window.dispatchEvent(new CustomEvent('wa-extractor-hide-top-panel'));
            return { success: true };
            
        default:
            return { success: false, error: '⚠️ Operação não reconhecida. Recarregue a extensão.' };
    }
}

// ========================================
// OBTER LISTA DE GRUPOS
// ========================================
async function getGroups(includeArchived = true) {
    try {
        console.log('[WA Extractor] Buscando grupos...', { includeArchived });

        await injectPageScript();
        await sleep(300);

        // Tentar até RETRY_ATTEMPTS vezes com timeout de RETRY_TIMEOUT_MS
        let lastError = null;
        for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
            try {
                console.log(`[WA Extractor] Tentativa ${attempt}/${RETRY_ATTEMPTS} de carregar grupos...`);
                
                const apiResult = await callPageAPI('WA_GET_GROUPS', { 
                    includeArchived: includeArchived 
                }, RETRY_TIMEOUT_MS);

                if (apiResult?.success && apiResult?.groups) {
                    console.log(`[WA Extractor] ✅ Grupos carregados na tentativa ${attempt}:`, apiResult.groups.length);
                    
                    const archived = apiResult.groups.filter(g => g.isArchived);
                    const active = apiResult.groups.filter(g => !g.isArchived);

                    console.log(`[WA Extractor] 📊 ${active.length} ativos, ${archived.length} arquivados`);

                    return {
                        success: true,
                        groups: apiResult.groups,
                        stats: apiResult.stats || {
                            total: apiResult.groups.length,
                            archived: archived.length,
                            active: active.length
                        }
                    };
                }
                
                lastError = apiResult?.error || 'Resposta inválida da API';
                console.log(`[WA Extractor] Tentativa ${attempt} falhou:`, lastError);
                
            } catch (e) {
                lastError = e.message || String(e);
                console.log(`[WA Extractor] Tentativa ${attempt} com erro:`, lastError);
            }
            
            // Aguardar antes de tentar novamente (não aguarda após a última tentativa)
            if (attempt < RETRY_ATTEMPTS) {
                await sleep(RETRY_DELAY_MS);
            }
        }

        // Se todas as tentativas falharam, tentar fallback DOM
        console.log(`[WA Extractor] ⚠️ API falhou após ${RETRY_ATTEMPTS} tentativas, usando DOM...`);
        return await getGroupsFromDOM(includeArchived);

    } catch (error) {
        console.error('[WA Extractor] Erro ao buscar grupos:', error);
        return {
            success: false,
            error: error.message || 'Erro ao carregar grupos'
        };
    }
}

async function getGroupsFromDOM(includeArchived = true) {
    const groups = [];
    const seenIds = new Set();

    const chatList = document.querySelector('#pane-side');
    if (!chatList) {
        return { success: false, error: '📱 Lista de chats não encontrada. Verifique se o WhatsApp Web está carregado.' };
    }

    const chatElements = chatList.querySelectorAll('[data-id]');

    // Lista expandida de indicadores de grupos inválidos
    const invalidIndicators = [
        // Português
        'você foi removido', 'você saiu', 'grupo excluído', 
        'não é mais participante', 'este grupo foi excluído',
        'grupo desativado', 'você não faz mais parte',
        'este grupo não existe mais', 'grupo foi desativado',
        // English
        'you were removed', 'you left', 'group deleted',
        'no longer a participant', 'this group was deleted',
        'group deactivated', 'you are no longer a member',
        'this group no longer exists'
    ];

    for (const element of chatElements) {
        const dataId = element.getAttribute('data-id') || '';
        if (!dataId.includes('@g.us')) continue;
        if (seenIds.has(dataId)) continue;
        seenIds.add(dataId);

        const titleSpan = element.querySelector('span[title]');
        const name = titleSpan?.getAttribute('title') || titleSpan?.textContent || 'Grupo';

        if (!name || name.length < 2 || name.length > 100) continue;
        if (/^(ontem|hoje|yesterday|today|\d{1,2}:\d{2})/i.test(name)) continue;

        // Verificar TANTO no elemento quanto na metadata do grupo
        const elementText = element.textContent?.toLowerCase() || '';
        const nameToCheck = (name || '').toLowerCase();
        let isInvalidGroup = false;
        
        for (const indicator of invalidIndicators) {
            if (elementText.includes(indicator) || nameToCheck.includes(indicator)) {
                console.log(`[WA Extractor] ⚠️ Grupo filtrado: "${name}" - motivo: "${indicator}"`);
                isInvalidGroup = true;
                break;
            }
        }
        
        if (isInvalidGroup) continue;

        groups.push({
            id: dataId,
            name: name,
            memberCount: '',
            isGroup: true,
            isArchived: false
        });
    }

    groups.sort((a, b) => a.name.localeCompare(b.name));

    return {
        success: true,
        groups: groups,
        stats: { total: groups.length, archived: 0, active: groups.length }
    };
}

// ========================================
// NAVEGAR COM RETRY
// ========================================
async function navigateToGroupWithRetry(groupId, groupName, isArchived, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[WA Extractor] Tentativa ${attempt}/${maxRetries}`);
            
            const result = await navigateToGroup(groupId, groupName, isArchived);
            
            if (result.success) {
                return result;
            }
            
            console.log(`[WA Extractor] Tentativa ${attempt} falhou:`, result.error);
            
            if (attempt < maxRetries) {
                await sleep(1000 * attempt); // Backoff exponencial
            }
        } catch (error) {
            console.error(`[WA Extractor] Erro na tentativa ${attempt}:`, error);
            
            if (attempt === maxRetries) {
                return { success: false, error: error.message };
            }
            
            await sleep(1000 * attempt);
        }
    }
    
    return { success: false, error: '❌ Não foi possível abrir o grupo após várias tentativas. Tente novamente.' };
}

// ========================================
// NAVEGAR ATÉ UM GRUPO
// ========================================
async function navigateToGroup(groupId, groupName, isArchived = false) {
    try {
        console.log(`[WA Extractor] ========================================`);
        console.log(`[WA Extractor] Navegando até: "${groupName}"`);
        console.log(`[WA Extractor] ID: ${groupId}`);
        console.log(`[WA Extractor] Arquivado: ${isArchived}`);
        console.log(`[WA Extractor] ========================================`);

        await injectPageScript();
        await sleep(300);

        // Para grupos arquivados, tentar desarquivar primeiro
        if (isArchived && groupId && groupId.includes('@g.us')) {
            console.log('[WA Extractor] 📤 Tentando desarquivar via API...');
            const unarchiveResult = await callPageAPI('WA_UNARCHIVE_CHAT', { groupId });
            
            if (unarchiveResult.success) {
                console.log('[WA Extractor] ✅ Grupo desarquivado com sucesso!');
                await sleep(1000);
                isArchived = false;
            } else {
                console.log('[WA Extractor] ⚠️ Não foi possível desarquivar:', unarchiveResult.error);
            }
        }

        // MÉTODO 1: Via API interna
        if (groupId && groupId.includes('@g.us')) {
            console.log('[WA Extractor] 📡 Método 1: Tentando API interna...');
            
            const apiResult = await callPageAPI('WA_OPEN_CHAT', { groupId, isArchived });

            if (apiResult.success) {
                console.log(`[WA Extractor] API retornou: ${apiResult.method}`);
                await sleep(3000);

                if (await verifyChatOpened(groupName)) {
                    console.log('[WA Extractor] ✅ Chat aberto via API!');
                    return { success: true };
                }
                console.log('[WA Extractor] ⚠️ API retornou sucesso mas chat não abriu');
            }
        }

        // MÉTODO 2: Navegação via arquivados
        if (isArchived) {
            console.log('[WA Extractor] 📦 Método 2: Navegando via seção de arquivados...');
            
            const archivedResult = await openArchivedAndFindGroupImproved(groupName);
            
            if (archivedResult) {
                await sleep(2500);
                if (await verifyChatOpened(groupName)) {
                    console.log('[WA Extractor] ✅ Chat arquivado aberto!');
                    return { success: true };
                }
            }
        }

        // MÉTODO 3: Busca na lista principal
        console.log('[WA Extractor] 📋 Método 3: Buscando na lista principal...');
        
        if (await clickGroupInMainList(groupName)) {
            await sleep(2000);
            if (await verifyChatOpened(groupName)) {
                console.log('[WA Extractor] ✅ Chat aberto via lista principal!');
                return { success: true };
            }
        }

        // MÉTODO 4: Pesquisa global
        console.log('[WA Extractor] 🔍 Método 4: Usando pesquisa global...');
        
        if (await searchAndOpenGroup(groupName)) {
            await sleep(2500);
            if (await verifyChatOpened(groupName)) {
                await clearSearch();
                console.log('[WA Extractor] ✅ Chat aberto via pesquisa!');
                return { success: true };
            }
        }

        throw new Error(`📱 Não foi possível abrir as informações do grupo "${groupName}". Tente clicar manualmente no grupo e depois extrair.`);

    } catch (error) {
        console.error('[WA Extractor] ❌ Erro:', error);
        return { success: false, error: error.message };
    }
}

// ========================================
// VERIFICAR SE CHAT ABRIU
// ========================================
async function verifyChatOpened(expectedGroupName) {
    await sleep(800);

    const mainHeader = document.querySelector('#main header');
    if (!mainHeader) {
        console.log('[WA Extractor] ❌ Header #main não encontrado');
        return false;
    }

    const headerTitle = mainHeader.querySelector('span[title]');
    const currentName = headerTitle?.getAttribute('title') || headerTitle?.textContent || '';

    const normalizedExpected = normalizeText(expectedGroupName);
    const normalizedCurrent = normalizeText(currentName);

    // Validação flexível
    if (normalizedCurrent.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedCurrent) ||
        levenshteinDistance(normalizedCurrent, normalizedExpected) <= 3) {
        console.log(`[WA Extractor] ✅ Chat verificado: "${currentName}"`);
        return true;
    }

    if (currentName.length > 0) {
        console.log(`[WA Extractor] ⚠️ Chat aberto mas nome diferente: "${currentName}" vs "${expectedGroupName}"`);
        return currentName.length > 2;
    }

    return false;
}

// ========================================
// ABRIR ARQUIVADOS MELHORADO
// ========================================
async function openArchivedAndFindGroupImproved(groupName) {
    try {
        console.log('[WA Extractor] 📦 Abrindo seção de arquivados (método melhorado)...');

        await goToMainChatList();
        await sleep(800);

        // Scroll para o topo
        const paneLeft = document.querySelector('#pane-side');
        if (paneLeft) {
            paneLeft.scrollTop = 0;
            await sleep(500);
        }

        let archivedButton = await findArchivedButtonImproved();

        if (!archivedButton && paneLeft) {
            paneLeft.scrollTop = 100;
            await sleep(500);
            archivedButton = await findArchivedButtonImproved();
        }

        if (!archivedButton) {
            console.log('[WA Extractor] ❌ Botão de arquivados não encontrado');
            return false;
        }

        console.log('[WA Extractor] 🖱️ Clicando em Arquivados...');
        simulateClick(archivedButton);
        await sleep(2500);

        const isInArchivedView = await verifyArchivedViewOpened();
        if (!isInArchivedView) {
            console.log('[WA Extractor] ⚠️ View de arquivados não abriu');
            return false;
        }

        console.log('[WA Extractor] 🔍 Procurando grupo nos arquivados...');
        
        const found = await findAndClickGroupInCurrentView(groupName);
        if (found) return true;

        console.log('[WA Extractor] 📜 Fazendo scroll na lista de arquivados...');
        
        const foundAfterScroll = await scrollAndFindGroup(groupName);
        if (foundAfterScroll) return true;

        console.log('[WA Extractor] ↩️ Voltando para lista principal...');
        await goBackFromArchived();
        return false;

    } catch (error) {
        console.error('[WA Extractor] Erro ao abrir arquivados:', error);
        return false;
    }
}

// ========================================
// ENCONTRAR BOTÃO DE ARQUIVADOS
// ========================================
async function findArchivedButtonImproved() {
    const selectors = [
        '[data-testid="archived"]',
        '[data-testid="chat-list-archived"]',
        '[aria-label*="rquivad"]',
        '[aria-label*="rchived"]',
        '[aria-label*="Archived"]',
        '[aria-label*="Arquivadas"]',
        '[title*="rquivad"]',
        '[title*="rchived"]'
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            console.log(`[WA Extractor] ✅ Botão encontrado: ${selector}`);
            return element.closest('[role="listitem"]') || 
                   element.closest('[role="row"]') || 
                   element.closest('[tabindex]') || 
                   element;
        }
    }

    // Procurar por texto
    const allElements = document.querySelectorAll('#pane-side *');
    for (const el of allElements) {
        const text = el.textContent?.trim().toLowerCase() || '';
        const ariaLabel = el.getAttribute('aria-label')?.toLowerCase() || '';
        const title = el.getAttribute('title')?.toLowerCase() || '';

        if (text === 'arquivadas' || text === 'archived' ||
            ariaLabel.includes('arquivad') || ariaLabel.includes('archived') ||
            title.includes('arquivad') || title.includes('archived')) {

            console.log('[WA Extractor] ✅ Elemento com texto "Arquivadas" encontrado');
            
            let parent = el;
            for (let i = 0; i < 10 && parent; i++) {
                if (parent.getAttribute('role') === 'listitem' ||
                    parent.getAttribute('role') === 'row' ||
                    parent.hasAttribute('tabindex')) {
                    return parent;
                }
                parent = parent.parentElement;
            }
            return el;
        }
    }

    return null;
}

// ========================================
// VERIFICAR VIEW DE ARQUIVADOS
// ========================================
async function verifyArchivedViewOpened() {
    await sleep(500);

    // Verificar header com "Arquivadas"
    const headers = document.querySelectorAll('header');
    for (const header of headers) {
        const text = header.textContent?.toLowerCase() || '';
        if (text.includes('arquivad') || text.includes('archived')) {
            console.log('[WA Extractor] ✅ View de arquivados confirmada');
            return true;
        }
    }

    // Verificar botão de voltar
    const backBtn = document.querySelector('[data-testid="back"]') || 
                   document.querySelector('[data-icon="back"]');
    if (backBtn) {
        return true;
    }

    return false;
}

// ========================================
// ENCONTRAR E CLICAR NO GRUPO
// ========================================
async function findAndClickGroupInCurrentView(groupName) {
    const normalizedTarget = normalizeText(groupName);
    const allSpans = document.querySelectorAll('span[title]');

    for (const span of allSpans) {
        const title = span.getAttribute('title') || '';
        const normalizedTitle = normalizeText(title);

        if (normalizedTitle === normalizedTarget ||
            title === groupName ||
            normalizedTitle.includes(normalizedTarget) ||
            normalizedTarget.includes(normalizedTitle) ||
            levenshteinDistance(normalizedTitle, normalizedTarget) <= 2) {

            console.log(`[WA Extractor] ✅ Grupo encontrado: "${title}"`);
            const clickTarget = findClickableParent(span);
            simulateClick(clickTarget);
            return true;
        }
    }

    return false;
}

// ========================================
// SCROLL E ENCONTRAR GRUPO
// ========================================
async function scrollAndFindGroup(groupName) {
    const scrollContainers = [
        document.querySelector('#pane-side'),
        document.querySelector('[data-testid="chat-list"]'),
        document.querySelector('[role="application"] > div > div')
    ].filter(Boolean);

    const scrollContainer = scrollContainers[0];
    if (!scrollContainer) {
        console.log('[WA Extractor] ❌ Container de scroll não encontrado');
        return false;
    }

    const normalizedTarget = normalizeText(groupName);
    let attempts = 0;
    const maxAttempts = 40;

    while (attempts < maxAttempts) {
        const allSpans = document.querySelectorAll('span[title]');
        
        for (const span of allSpans) {
            const title = span.getAttribute('title') || '';
            
            if (normalizeText(title) === normalizedTarget ||
                title === groupName ||
                levenshteinDistance(normalizeText(title), normalizedTarget) <= 2) {

                console.log(`[WA Extractor] ✅ Grupo encontrado após scroll: "${title}"`);
                const clickTarget = findClickableParent(span);
                simulateClick(clickTarget);
                return true;
            }
        }

        scrollContainer.scrollTop += 300;
        await sleep(400);
        attempts++;

        if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 50) {
            console.log('[WA Extractor] Chegou ao fim da lista');
            break;
        }
    }

    return false;
}

// ========================================
// VOLTAR DA SEÇÃO DE ARQUIVADOS
// ========================================
async function goBackFromArchived() {
    const backButtons = [
        document.querySelector('[data-testid="back"]'),
        document.querySelector('[data-icon="back"]'),
        document.querySelector('[aria-label*="Voltar"]'),
        document.querySelector('[aria-label*="Back"]'),
        document.querySelector('header button[aria-label]')
    ].filter(Boolean);

    if (backButtons.length > 0) {
        backButtons[0].click();
        await sleep(800);
        return;
    }

    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 27,
        bubbles: true
    }));
    await sleep(500);
}

// ========================================
// IR PARA LISTA PRINCIPAL
// ========================================
async function goToMainChatList() {
    const closeButtons = document.querySelectorAll('[data-icon="x"], [data-testid="x"]');
    for (const btn of closeButtons) {
        const parent = btn.closest('[role="dialog"]');
        if (parent) {
            btn.click();
            await sleep(300);
        }
    }

    for (let i = 0; i < 3; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            keyCode: 27,
            bubbles: true
        }));
        await sleep(200);
    }
}

// ========================================
// CLICAR EM GRUPO NA LISTA PRINCIPAL
// ========================================
async function clickGroupInMainList(groupName) {
    const chatList = document.querySelector('#pane-side');
    if (!chatList) return false;

    const normalizedTarget = normalizeText(groupName);

    chatList.scrollTop = 0;
    await sleep(300);

    const spans = chatList.querySelectorAll('span[title]');
    
    for (const span of spans) {
        const title = span.getAttribute('title') || '';
        
        if (normalizeText(title) === normalizedTarget ||
            title === groupName ||
            levenshteinDistance(normalizeText(title), normalizedTarget) <= 2) {

            console.log(`[WA Extractor] ✅ Grupo encontrado na lista: "${title}"`);
            const clickTarget = findClickableParent(span);
            simulateClick(clickTarget);
            return true;
        }
    }

    return await scrollAndFindGroup(groupName);
}

// ========================================
// PESQUISAR E ABRIR GRUPO
// ========================================
async function searchAndOpenGroup(groupName) {
    try {
        console.log('[WA Extractor] 🔍 Iniciando pesquisa...');

        const searchBox = await getSearchBox();
        if (!searchBox) {
            console.log('[WA Extractor] ❌ Campo de pesquisa não encontrado');
            return false;
        }

        searchBox.focus();
        await sleep(300);

        // 1. Clicar na aba Grupos primeiro
        const gruposTab = document.querySelector('button#group-filter') ||
                          Array.from(document.querySelectorAll('button[role="tab"]'))
                              .find(btn => btn.textContent?.trim() === 'Grupos');
        if (gruposTab) {
            gruposTab.click();
            await sleep(800);
        }

        // 2. Preparar campo Lexical (limpar COMPLETAMENTE primeiro)
        searchBox.focus();
        await sleep(200);
        
        // LIMPAR COMPLETAMENTE todos os filhos ANTES de digitar
        console.log('[WA Extractor] Limpando campo de busca completamente...');
        searchBox.innerHTML = ''; // Limpar completamente
        // ou alternativa:
        while (searchBox.firstChild) {
            searchBox.removeChild(searchBox.firstChild);
        }
        await sleep(200);
        
        // Criar estrutura Lexical correta
        const p = document.createElement('p');
        p.className = '_aupe copyable-text x15bjb6t x1n2onr6';
        p.setAttribute('dir', 'auto');
        searchBox.appendChild(p);

        // 3. Posicionar cursor dentro do parágrafo
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(p, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        await sleep(200);

        // 4. Digitar caractere por caractere (simula digitação humana)
        for (const char of groupName) {
            document.execCommand('insertText', false, char);
            await sleep(80);
        }
        await sleep(2500);

        const normalizedTarget = normalizeText(groupName);
        const results = document.querySelectorAll(
            '#pane-side span[title], [data-testid="cell-frame-container"] span[title]'
        );

        for (const span of results) {
            const title = span.getAttribute('title') || '';
            
            if (normalizeText(title) === normalizedTarget ||
                title === groupName ||
                normalizeText(title).includes(normalizedTarget) ||
                levenshteinDistance(normalizeText(title), normalizedTarget) <= 2) {

                console.log(`[WA Extractor] ✅ Grupo encontrado na pesquisa: "${title}"`);
                const clickTarget = findClickableParent(span);
                simulateClick(clickTarget);
                
                // Delay maior após clique (3000ms)
                await sleep(3000);

                // Aguardar #main carregar com retry
                let mainLoaded = false;
                for (let i = 0; i < 10; i++) {
                    if (document.querySelector('#main header')) {
                        mainLoaded = true;
                        console.log(`[WA Extractor] ✅ Chat carregou na tentativa ${i + 1}`);
                        break;
                    }
                    console.log(`[WA Extractor] ⏳ Aguardando chat... ${i + 1}/10`);
                    await sleep(500);
                }

                // Retry se #main não carregar
                if (!mainLoaded) {
                    console.log('[WA Extractor] ⚠️ Chat não carregou, tentando clicar novamente...');
                    simulateClick(clickTarget);
                    await sleep(2000);
                    
                    for (let i = 0; i < 5; i++) {
                        if (document.querySelector('#main header')) {
                            mainLoaded = true;
                            console.log(`[WA Extractor] ✅ Chat carregou no retry ${i + 1}`);
                            break;
                        }
                        await sleep(500);
                    }
                }

                if (!mainLoaded) {
                    console.log('[WA Extractor] ❌ Chat não carregou após múltiplas tentativas');
                    return false;
                }

                return true;
            }
        }

        return false;
    } catch (error) {
        console.error('[WA Extractor] Erro na pesquisa:', error);
        return false;
    }
}

// ========================================
// OBTER CAMPO DE PESQUISA
// ========================================
async function getSearchBox() {
    const selectors = [
        '[data-testid="chat-list-search"]',
        'div[contenteditable="true"][data-tab="3"]',
        '#side div[contenteditable="true"]',
        'div[role="textbox"][title*="Pesquisar"]',
        'div[role="textbox"][title*="Search"]'
    ];

    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element;
    }

    const searchIcon = document.querySelector('[data-testid="search"]') ||
                      document.querySelector('[data-icon="search"]');
    if (searchIcon) {
        searchIcon.click();
        await sleep(800);

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) return element;
        }
    }

    return null;
}

// ========================================
// LIMPAR PESQUISA
// ========================================
async function clearSearch() {
    try {
        const clearBtn = document.querySelector('[data-testid="search-clear-btn"]') ||
                        document.querySelector('[data-icon="x-alt"]') ||
                        document.querySelector('[aria-label*="Limpar"]');

        if (clearBtn) {
            clearBtn.click();
            await sleep(300);
        }

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            keyCode: 27,
            bubbles: true
        }));
        await sleep(200);
    } catch (error) {
        console.error('[WA Extractor] Erro ao limpar pesquisa:', error);
    }
}

// ========================================
// FUNÇÕES UTILITÁRIAS
// ========================================
function normalizeText(text) {
    if (!text) return '';
    return text
        .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '')
        .replace(/[®™©]/g, '')
        .trim()
        .toLowerCase();
}

function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

function findClickableParent(element) {
    let clickTarget = element;
    let parent = element.parentElement;

    for (let i = 0; i < 15 && parent; i++) {
        if (parent.getAttribute('data-id') ||
            parent.getAttribute('role') === 'listitem' ||
            parent.getAttribute('role') === 'row' ||
            parent.getAttribute('tabindex') === '-1' ||
            parent.classList.contains('_ak8l') ||
            parent.getAttribute('data-testid')?.includes('cell') ||
            parent.getAttribute('data-testid')?.includes('list-item')) {
            clickTarget = parent;
            break;
        }
        parent = parent.parentElement;
    }

    return clickTarget;
}

function simulateClick(element) {
    if (!element) return;

    console.log('[WA Extractor] 🖱️ Simulando clique em:', element.tagName);

    element.scrollIntoView({ behavior: 'instant', block: 'center' });

    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y
    };

    element.dispatchEvent(new MouseEvent('mouseenter', eventOptions));
    element.dispatchEvent(new MouseEvent('mouseover', eventOptions));
    element.dispatchEvent(new MouseEvent('mousedown', { ...eventOptions, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { ...eventOptions, button: 0 }));
    element.dispatchEvent(new MouseEvent('click', { ...eventOptions, button: 0 }));
}

// ========================================
// EXTRAIR MEMBROS
// ========================================
async function extractMembers() {
    try {
        console.log('[WA Extractor] Iniciando extração...');

        if (typeof WhatsAppExtractor === 'undefined') {
            throw new Error('🔄 Módulo de extração não carregado. Recarregue a página do WhatsApp Web.');
        }

        // Obter estimativa de membros do grupo (se disponível no selectedGroup)
        let estimatedMembers = 100; // default fallback
        
        return new Promise((resolve, reject) => {
            let lastReportedProgress = 40; // Inicia em 40%
            
            WhatsAppExtractor.extractMembers(
                (progress) => {
                    try {
                        // Calcular progresso proporcional baseado no memberCount estimado
                        const extractionRange = 55; // 40% até 95% = 55 pontos
                        const baseProgress = 40;
                        const membersFound = progress.count || 0;
                        
                        // Cálculo proporcional
                        const memberProgress = (membersFound / estimatedMembers) * extractionRange;
                        const totalProgress = Math.min(95, baseProgress + memberProgress);
                        
                        // REGRA ABSOLUTA: progresso NUNCA regride
                        const currentProgress = Math.max(lastReportedProgress, totalProgress);
                        lastReportedProgress = currentProgress;
                        
                        chrome.runtime.sendMessage({
                            type: 'extractionProgress',
                            status: progress.status,
                            count: membersFound,
                            progress: currentProgress,
                            members: progress.members || []
                        });
                    } catch (e) {
                        console.error('[WA Extractor] Erro ao enviar progresso:', e);
                    }
                },
                async (data) => {
                    console.log('[WA Extractor] Extração concluída:', data);
                    
                    // NOVO: Cleanup após extração
                    await cleanupAfterExtraction();
                    
                    resolve({ success: true, data: data });
                },
                (error) => {
                    reject(new Error(error));
                }
            );
        });

    } catch (error) {
        console.error('[WA Extractor] Erro:', error);
        return { success: false, error: error.message };
    }
}

// ========================================
// CLEANUP APÓS EXTRAÇÃO
// ========================================
async function cleanupAfterExtraction() {
    try {
        console.log('[WA Extractor] 🧹 Iniciando cleanup após extração...');
        
        // 1. Fechar painel de informações do grupo (drawer/modal)
        await closeGroupInfoPanel();
        
        // 2. Limpar campo de pesquisa
        await clearSearchField();
        
        // 3. Voltar para aba "Tudo"
        await switchToAllTab();
        
        console.log('[WA Extractor] ✅ Cleanup concluído!');
        return { success: true };
    } catch (error) {
        console.error('[WA Extractor] ⚠️ Erro no cleanup:', error);
        return { success: false, error: error.message };
    }
}

async function closeGroupInfoPanel() {
    // Fechar modal de membros (se aberto)
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
        const closeBtn = dialog.querySelector('[data-icon="x"]') || 
                        dialog.querySelector('[data-testid="x"]') ||
                        dialog.querySelector('[aria-label*="Fechar"]') ||
                        dialog.querySelector('[aria-label*="Close"]');
        if (closeBtn) {
            closeBtn.click();
            await sleep(300);
        }
    }
    
    // Fechar drawer de informações do grupo
    const infoDrawerCloseBtn = document.querySelector('div._aig- [data-icon="x"]') ||
                               document.querySelector('[data-testid="contact-info-drawer"] [data-icon="x"]') ||
                               document.querySelector('header [data-icon="x"]');
    if (infoDrawerCloseBtn) {
        infoDrawerCloseBtn.click();
        await sleep(300);
    }
    
    // Fallback: pressionar Escape múltiplas vezes
    for (let i = 0; i < 3; i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            bubbles: true
        }));
        await sleep(200);
    }
}

async function clearSearchField() {
    // Tentar limpar via botão
    const clearBtn = document.querySelector('[data-testid="search-clear-btn"]') ||
                    document.querySelector('[data-icon="x-alt"]') ||
                    document.querySelector('[aria-label*="Limpar"]') ||
                    document.querySelector('[aria-label*="Clear"]');
    
    if (clearBtn) {
        clearBtn.click();
        await sleep(300);
    }
    
    // Limpar campo de pesquisa diretamente
    const searchBox = document.querySelector('[data-testid="chat-list-search"]') ||
                     document.querySelector('div[contenteditable="true"][data-tab="3"]');
    
    if (searchBox) {
        searchBox.innerHTML = '';
        searchBox.blur();
        await sleep(200);
    }
}

async function switchToAllTab() {
    // Encontrar e clicar na aba "Tudo" ou "All"
    const tabs = document.querySelectorAll('button[role="tab"]');
    
    for (const tab of tabs) {
        const text = tab.textContent?.trim().toLowerCase() || '';
        const ariaLabel = tab.getAttribute('aria-label')?.toLowerCase() || '';
        
        if (text === 'tudo' || text === 'all' || text === 'todos' ||
            ariaLabel.includes('tudo') || ariaLabel.includes('all')) {
            tab.click();
            console.log('[WA Extractor] ✅ Voltou para aba "Tudo"');
            await sleep(300);
            return;
        }
    }
    
    // Fallback: clicar no primeiro tab (geralmente é "Tudo")
    if (tabs.length > 0) {
        tabs[0].click();
        await sleep(300);
    }
}