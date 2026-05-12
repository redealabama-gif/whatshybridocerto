// extractor-v6-optimized.js - WhatsApp Group Extractor v6.0.7 MEGA OTIMIZADO
const WhatsAppExtractor = {
    version: '6.0.7',
    
    state: {
        isExtracting: false,
        isPaused: false,
        shouldStop: false,
        members: new Map(),
        groupName: '',
        debug: true,
        modalInfo: null,
        memberCache: new Set(),
        observer: null,
        lastScrollPosition: 0,
        estimatedMembers: 100, // Estimativa de membros para cálculo de progresso
        lastReportedProgress: 30 // Track para garantir que progresso nunca regride (começa em 30%)
    },

    // ========================================
    // CONFIGURAÇÕES OTIMIZADAS
    // ========================================
    CONFIG: {
        SCROLL: {
            MIN_STEP_PERCENT: 0.15,
            MAX_STEP_PERCENT: 0.35,
            ADAPTIVE_THRESHOLD: 0.7,
            DELAY_FAST: 200,
            DELAY_NORMAL: 300,
            DELAY_SLOW: 400,
            MAX_ATTEMPTS: 500,
            NO_NEW_LIMIT: 8,
            VELOCITY_CHECK_INTERVAL: 5
        },
        EXTRACTION: {
            BATCH_SIZE: 20,
            VIEWPORT_BUFFER: 1.5,
            INTERSECTION_THRESHOLD: 0.1,
            MAX_MEMBERS: 10000  // Limite de segurança
        },
        CACHE: {
            ELEMENT_DATA_TTL: 30000,
            DOM_QUERY_CACHE_SIZE: 100
        },
        PERFORMANCE: {
            USE_INTERSECTION_OBSERVER: true,
            USE_REQUEST_IDLE_CALLBACK: true,
            DEBOUNCE_PROGRESS: 150
        }
    },

    // ========================================
    // CACHE OTIMIZADO COM LRU
    // ========================================
    createLRUCache(maxSize = 100) {
        const cache = new Map();
        return {
            get(key) {
                if (!cache.has(key)) return null;
                const value = cache.get(key);
                cache.delete(key);
                cache.set(key, value);
                return value;
            },
            set(key, value) {
                if (cache.has(key)) {
                    cache.delete(key);
                } else if (cache.size >= maxSize) {
                    const firstKey = cache.keys().next().value;
                    cache.delete(firstKey);
                }
                cache.set(key, value);
            },
            has(key) {
                return cache.has(key);
            },
            clear() {
                cache.clear();
            }
        };
    },

    // Inicializa caches
    domCache: null,
    
    initCaches() {
        this.domCache = this.createLRUCache(this.CONFIG.CACHE.DOM_QUERY_CACHE_SIZE);
    },

    // ========================================
    // UTILITÁRIOS OTIMIZADOS
    // ========================================
    log(...args) {
        if (this.state.debug) {
            console.log('[WA Extractor]', ...args);
        }
    },

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    // Debounce otimizado
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    },

    // RequestIdleCallback wrapper
    async runWhenIdle(callback) {
        if (this.CONFIG.PERFORMANCE.USE_REQUEST_IDLE_CALLBACK && 'requestIdleCallback' in window) {
            return new Promise(resolve => {
                requestIdleCallback(() => resolve(callback()), { timeout: 100 });
            });
        }
        return callback();
    },

    // Batch processing para não bloquear UI
    async processInBatches(items, processor, batchSize = 20) {
        const results = [];
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await this.runWhenIdle(() => {
                return batch.map(processor);
            });
            results.push(...batchResults);
            if (i + batchSize < items.length) {
                await this.delay(0);
            }
        }
        return results;
    },

    // ========================================
    // HASH E NORMALIZAÇÃO OTIMIZADOS
    // ========================================
    generateMemberHash(name, phone) {
        const normalized = this.normalizeName(name);
        const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
        const key = cleanPhone || normalized;
        return key.toLowerCase();
    },

    normalizeName(name) {
        if (!name) return '';
        return name
            .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '')
            .replace(/[®™©]/g, '')
            .trim();
    },

    // Set de textos de UI (verificação O(1))
    UI_TEXTS: new Set([
        'admin', 'admin do grupo', 'você', 'you', 'online', 'offline',
        'visto por último', 'last seen', 'pesquisar', 'search',
        'membros', 'members', 'participantes', 'adicionar', 'add',
        'sair', 'exit', 'ver tudo', 'see all'
    ]),

    isUIText(text) {
        const lower = text.toLowerCase().trim();
        if (this.UI_TEXTS.has(lower)) return true;
        for (const uiText of this.UI_TEXTS) {
            if (lower.startsWith(uiText + ' ')) return true;
        }
        return false;
    },

    isValidMember(name) {
        if (!name || name.length < 2 || name.length > 200) return false;
        if (!this._invalidMemberPattern) {
            this._invalidMemberPattern = /^(\d+\s*(membros|members)|ic-close|search-refreshed|default-contact)$/i;
        }
        return !this._invalidMemberPattern.test(name.trim());
    },

    // ========================================
    // EXTRAÇÃO DE DADOS MEGA OTIMIZADA
    // ========================================
    extractMemberDataOptimized(element) {
        try {
            // Cache no elemento
            if (element.__memberData && element.__cacheTime) {
                const age = Date.now() - element.__cacheTime;
                if (age < this.CONFIG.CACHE.ELEMENT_DATA_TTL) {
                    return element.__memberData;
                }
            }

            let name = '';
            let phone = '';
            let isAdmin = false;

            // Detecta admin
            const fullText = element.textContent?.toLowerCase() || '';
            isAdmin = fullText.includes('admin');

            // Buscar spans com title ou dir="auto"
            const spans = element.querySelectorAll('span[title], span[dir="auto"]');

            // Cache de regex para telefone
            if (!this._phoneRegex) {
                this._phoneRegex = /^\+?\d{10,}$/;
            }

            for (const span of spans) {
                const title = span.getAttribute('title');
                const text = (title || span.textContent || '').trim();

                if (!text || text.length < 2) continue;
                if (this.isUIText(text)) continue;

                // Detecta telefone
                const cleanText = text.replace(/[\s\-()]/g, '');
                if (!phone && this._phoneRegex.test(cleanText)) {
                    phone = text;
                    if (!name) name = text;
                    continue;
                }

                // Nome válido
                if (!name && text.length >= 2 && text.length < 100) {
                    name = text;
                }

                // Early exit
                if (name && phone) break;
            }

            if (!name) return null;

            const hash = this.generateMemberHash(name, phone);
            const memberData = {
                key: hash,
                name: this.normalizeName(name),
                phone: phone || '',
                isAdmin: isAdmin,
                extractedAt: new Date().toISOString()
            };

            // Cache no elemento
            element.__memberData = memberData;
            element.__cacheTime = Date.now();

            return memberData;
        } catch (error) {
            return null;
        }
    },

    // ========================================
    // INTERSECTION OBSERVER
    // ========================================
    setupIntersectionObserver(container, callback) {
        if (!this.CONFIG.PERFORMANCE.USE_INTERSECTION_OBSERVER) {
            return null;
        }

        const options = {
            root: container,
            rootMargin: '50px',
            threshold: this.CONFIG.EXTRACTION.INTERSECTION_THRESHOLD
        };

        const observer = new IntersectionObserver((entries) => {
            const visibleElements = entries
                .filter(entry => entry.isIntersecting)
                .map(entry => entry.target);

            if (visibleElements.length > 0) {
                callback(visibleElements);
            }
        }, options);

        return observer;
    },

    // ========================================
    // EXTRAÇÃO VISÍVEL MEGA OTIMIZADA
    // ========================================
    extractVisibleMembersOptimized(container) {
        const selectors = [
            '[role="listitem"]',
            '[role="row"]',
            '[data-testid="cell-frame-container"]'
        ];

        const cacheKey = `elements_${container.scrollTop}`;
        let memberElements;

        if (this.domCache && this.domCache.has(cacheKey)) {
            memberElements = this.domCache.get(cacheKey);
        } else {
            memberElements = [];
            for (const selector of selectors) {
                const elements = Array.from(container.querySelectorAll(selector));
                if (elements.length > memberElements.length) {
                    memberElements = elements;
                    break;
                }
            }
            if (this.domCache) {
                this.domCache.set(cacheKey, memberElements);
            }
        }

        const visibleElements = this.getVisibleElements(container, memberElements);
        let newMembersCount = 0;

        for (const element of visibleElements) {
            // Verificar limite máximo
            if (this.state.members.size >= this.CONFIG.EXTRACTION.MAX_MEMBERS) {
                this.log('⚠️ Limite máximo de membros atingido:', this.CONFIG.EXTRACTION.MAX_MEMBERS);
                break;
            }

            const memberData = this.extractMemberDataOptimized(element);

            if (memberData && memberData.name && this.isValidMember(memberData.name)) {
                const hash = memberData.key;

                if (!this.state.memberCache.has(hash)) {
                    this.state.members.set(hash, {
                        name: memberData.name,
                        phone: memberData.phone,
                        isAdmin: memberData.isAdmin,
                        extractedAt: memberData.extractedAt
                    });
                    this.state.memberCache.add(hash);
                    newMembersCount++;
                }
            }
        }

        return newMembersCount;
    },

    // Get visible elements otimizado
    getVisibleElements(container, elements) {
        const containerRect = container.getBoundingClientRect();
        const viewportHeight = containerRect.height;
        const buffer = viewportHeight * this.CONFIG.EXTRACTION.VIEWPORT_BUFFER;
        const visible = [];

        for (const el of elements) {
            const rect = el.getBoundingClientRect();
            const relativeTop = rect.top - containerRect.top;
            const relativeBottom = rect.bottom - containerRect.top;

            if (relativeBottom >= -buffer && relativeTop <= viewportHeight + buffer) {
                visible.push(el);
            }
        }

        return visible;
    },

    // ========================================
    // SCROLL MEGA OTIMIZADO
    // ========================================
    async scrollAndCaptureOptimized(modalInfo, onProgress) {
        const { scrollContainer } = modalInfo;

        if (!scrollContainer) {
            throw new Error('Container de scroll não encontrado');
        }

        this.state.members.clear();
        this.state.memberCache.clear();
        this.state.lastReportedProgress = 30; // Começa em 30% (início da fase de extração)
        this.initCaches();

        this.log('========================================');
        this.log('INICIANDO SCROLL MEGA OTIMIZADO v6.0.7...');
        this.log(`📊 Membros estimados: ${this.state.estimatedMembers}`);
        this.log('========================================');

        const CONFIG = this.CONFIG.SCROLL;
        const viewHeight = scrollContainer.clientHeight;
        const totalHeight = scrollContainer.scrollHeight;

        this.log(`Dimensões: viewport=${viewHeight}px, total=${totalHeight}px`);

        // Vai para o topo
        scrollContainer.scrollTop = 0;
        await this.delay(600);

        // Captura inicial
        const initialNew = this.extractVisibleMembersOptimized(scrollContainer);
        this.log(`✅ Captura inicial: ${initialNew} membros`);

        // Função para calcular progresso proporcional (30% a 95%)
        const calculateProgress = (membersCount) => {
            const extractionRange = 65; // 30% até 95% = 65 pontos
            const baseProgress = 30;
            const memberProgress = (membersCount / this.state.estimatedMembers) * extractionRange;
            const totalProgress = Math.min(95, baseProgress + memberProgress);
            
            // REGRA ABSOLUTA: progresso NUNCA regride
            const currentProgress = Math.max(this.state.lastReportedProgress, totalProgress);
            this.state.lastReportedProgress = currentProgress;
            
            return currentProgress;
        };

        // Progress debounced
        const debouncedProgress = this.debounce((data) => {
            if (onProgress) onProgress(data);
        }, this.CONFIG.PERFORMANCE.DEBOUNCE_PROGRESS);

        // Enviar progresso inicial
        if (onProgress) {
            const membersArray = Array.from(this.state.members.values());
            const progress = calculateProgress(membersArray.length);
            onProgress({
                loaded: membersArray.length,
                members: membersArray,
                progress: progress
            });
        }

        let scrollAttempts = 0;
        let noNewMembersCount = 0;
        let lastMemberCount = this.state.members.size;
        let consecutiveFastScrolls = 0;

        // Calcular step adaptativo inicial
        let scrollStep = viewHeight * CONFIG.MIN_STEP_PERCENT;
        let currentDelay = CONFIG.DELAY_NORMAL;

        // Histórico de velocidade
        const velocityHistory = [];
        const maxVelocityHistory = 10;

        // Loop de scroll
        while (scrollAttempts < CONFIG.MAX_ATTEMPTS) {
            // Verificar se deve parar
            if (this.state.shouldStop) {
                this.log('⏹️ Extração interrompida pelo usuário');
                break;
            }

            // Verificar se está pausado
            while (this.state.isPaused) {
                this.log('⏸️ Extração pausada, aguardando...');
                await this.delay(500);
                
                // Se for parar durante a pausa
                if (this.state.shouldStop) {
                    this.log('⏹️ Extração interrompida durante pausa');
                    break;
                }
            }

            // Verificar novamente após sair da pausa
            if (this.state.shouldStop) {
                break;
            }

            // Verificar limite máximo
            if (this.state.members.size >= this.CONFIG.EXTRACTION.MAX_MEMBERS) {
                this.log('⚠️ Limite máximo de membros atingido');
                break;
            }

            const scrollStart = Date.now();
            const positionBefore = scrollContainer.scrollTop;

            // Scroll adaptativo
            scrollContainer.scrollTop += scrollStep;
            await this.delay(currentDelay);

            const positionAfter = scrollContainer.scrollTop;
            const actualScrolled = positionAfter - positionBefore;

            // Extrair membros
            const newMembers = this.extractVisibleMembersOptimized(scrollContainer);
            const totalMembers = this.state.members.size;
            const scrollTime = Date.now() - scrollStart;

            // Calcular velocidade
            const velocity = newMembers / scrollTime;
            velocityHistory.push(velocity);
            if (velocityHistory.length > maxVelocityHistory) {
                velocityHistory.shift();
            }

            // ADAPTAÇÃO INTELIGENTE
            if (scrollAttempts % CONFIG.VELOCITY_CHECK_INTERVAL === 0 && velocityHistory.length >= 5) {
                const avgVelocity = velocityHistory.reduce((a, b) => a + b, 0) / velocityHistory.length;

                if (avgVelocity > 0.05) {
                    currentDelay = CONFIG.DELAY_SLOW;
                    scrollStep = viewHeight * CONFIG.MIN_STEP_PERCENT;
                    consecutiveFastScrolls = 0;
                } else if (avgVelocity < 0.01) {
                    currentDelay = CONFIG.DELAY_FAST;
                    scrollStep = Math.min(viewHeight * CONFIG.MAX_STEP_PERCENT, scrollStep * 1.2);
                    consecutiveFastScrolls++;
                } else {
                    currentDelay = CONFIG.DELAY_NORMAL;
                    scrollStep = viewHeight * ((CONFIG.MIN_STEP_PERCENT + CONFIG.MAX_STEP_PERCENT) / 2);
                }
            }

            // Log periódico
            if (scrollAttempts % 20 === 0 || newMembers > 0) {
                const scrollProgress = Math.min(100, Math.round(
                    (scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight)) * 100
                ));
                const extractionProgress = calculateProgress(totalMembers);
                this.log(
                    `Scroll ${scrollAttempts}: +${newMembers} | ` +
                    `Total: ${totalMembers} | Extração: ${extractionProgress.toFixed(1)}% | ` +
                    `Scroll: ${scrollProgress}% | Speed: ${currentDelay}ms/${scrollStep.toFixed(0)}px`
                );
            }

            // Progresso debounced com cálculo proporcional
            if (scrollAttempts % 3 === 0 || newMembers > 0) {
                const membersArray = Array.from(this.state.members.values());
                const progress = calculateProgress(membersArray.length);
                debouncedProgress({
                    loaded: membersArray.length,
                    members: membersArray,
                    progress: progress
                });
            }

            // Controle de novos membros
            if (totalMembers > lastMemberCount) {
                noNewMembersCount = 0;
                lastMemberCount = totalMembers;
                await this.delay(CONFIG.DELAY_FAST);
            } else {
                noNewMembersCount++;
            }

            // Detecção de final
            const atBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= 
                           scrollContainer.scrollHeight - 10;

            if (actualScrolled < 5 || atBottom) {
                this.log('🏁 Chegou ao final da lista');
                for (let i = 0; i < 2; i++) {
                    await this.delay(150);
                    this.extractVisibleMembersOptimized(scrollContainer);
                }
                break;
            }

            // Parada antecipada
            if (noNewMembersCount >= CONFIG.NO_NEW_LIMIT || consecutiveFastScrolls > 20) {
                this.log('⏸️ Finalizando - critério de parada atingido');
                break;
            }

            scrollAttempts++;
        }

        // Varredura final
        this.log('🔍 Varredura final...');
        scrollContainer.scrollTop = 0;
        await this.delay(300);

        let sweepCount = 0;
        const maxSweeps = 30;

        while (scrollContainer.scrollTop + scrollContainer.clientHeight < scrollContainer.scrollHeight - 10 && 
               sweepCount < maxSweeps) {
            this.extractVisibleMembersOptimized(scrollContainer);
            scrollContainer.scrollTop += scrollContainer.clientHeight * 0.5;
            await this.delay(100);
            sweepCount++;
        }

        this.extractVisibleMembersOptimized(scrollContainer);

        // Progresso final (garantir 95%)
        if (onProgress) {
            const membersArray = Array.from(this.state.members.values());
            const finalProgress = Math.max(this.state.lastReportedProgress, 95);
            this.state.lastReportedProgress = finalProgress;
            
            onProgress({
                loaded: membersArray.length,
                members: membersArray,
                progress: finalProgress
            });
        }

        // Limpar caches
        if (this.domCache) {
            this.domCache.clear();
        }

        this.log('========================================');
        this.log('✅ EXTRAÇÃO COMPLETA v6.0.7!');
        this.log(`📊 Total: ${this.state.members.size} membros únicos`);
        this.log(`📊 Estimativa inicial: ${this.state.estimatedMembers} membros`);
        this.log(`📊 Scrolls: ${scrollAttempts} tentativas`);
        this.log(`📊 Velocidade média: ${(this.state.members.size / scrollAttempts).toFixed(2)} membros/scroll`);
        this.log('========================================');
    },

    // ========================================
    // MÉTODOS AUXILIARES
    // ========================================
    getGroupName() {
        try {
            const mainHeader = document.querySelector('#main header');
            if (!mainHeader) return 'Grupo';

            const titleSpan = mainHeader.querySelector('span[title]');
            if (titleSpan) {
                const title = titleSpan.getAttribute('title');
                if (title && title.length < 100 && !title.includes('+55')) {
                    return title;
                }
            }

            const spans = mainHeader.querySelectorAll('span[dir="auto"]');
            for (const span of spans) {
                const text = span.textContent?.trim();
                if (text && text.length > 2 && text.length < 80 && !text.includes('+55')) {
                    return text;
                }
            }

            return 'Grupo';
        } catch (error) {
            return 'Grupo';
        }
    },



    async openGroupInfo() {
        try {
            this.log('📂 Abrindo informações do grupo...');

            // Aguardar header com retry
            let header = null;
            const maxAttempts = 10;
            const delayBetweenAttempts = 500;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                header = document.querySelector('#main header');
                if (header) {
                    this.log(`✅ Header encontrado na tentativa ${attempt}`);
                    break;
                }
                this.log(`⏳ Aguardando header... tentativa ${attempt}/${maxAttempts}`);
                await this.delay(delayBetweenAttempts);
            }

            if (!header) {
                throw new Error('Header não encontrado após múltiplas tentativas');
            }

            const clickable = header.querySelector('[role="button"]') ||
                            header.querySelector('div[tabindex="0"]') ||
                            header;

            clickable.click();
            await this.delay(1200);
            return true;
        } catch (error) {
            throw error;
        }
    },

    async clickSeeAllMembers() {
        try {
            this.log('🔍 Procurando botão de membros...');
            await this.delay(300);

            const buttons = document.querySelectorAll('div[role="button"]');
            for (const button of buttons) {
                const text = button.textContent || '';
                if (/\d+\s*(membros|members)/i.test(text) || /ver tud|see all/i.test(text)) {
                    this.log('✅ Botão encontrado');
                    button.click();
                    await this.delay(1500);
                    return true;
                }
            }

            return false;
        } catch (error) {
            this.log('⚠️ Erro ao procurar botão:', error);
            return false;
        }
    },

    findMembersModal() {
        try {
            const dialogs = document.querySelectorAll('[role="dialog"]');

            for (const dialog of dialogs) {
                // PRIMEIRO: buscar listitems diretamente (funciona para grupos pequenos E grandes)
                const items = dialog.querySelectorAll('[role="listitem"], [role="row"]');
                
                if (items.length > 0) {
                    this.log(`✅ Modal encontrado: ${items.length} itens`);
                    
                    // Tentar detectar número total de membros do header do modal
                    this.detectEstimatedMembers(dialog);
                    
                    // Encontrar container scrollável que contém os itens
                    let scrollContainer = null;
                    
                    const divs = dialog.querySelectorAll('div');
                    for (const div of divs) {
                        const style = window.getComputedStyle(div);
                        const hasScroll = style.overflowY === 'auto' || style.overflowY === 'scroll';
                        
                        if (hasScroll && div.contains(items[0])) {
                            scrollContainer = div;
                            break;
                        }
                    }
                    
                    // Fallback: usar o pai dos itens se não encontrar container scrollável
                    if (!scrollContainer) {
                        scrollContainer = items[0].parentElement;
                        this.log('⚠️ Usando container pai (grupo pequeno sem scroll)');
                    }
                    
                    return { modal: dialog, scrollContainer };
                }
            }

            return null;
        } catch (error) {
            this.log('❌ Erro ao buscar modal:', error);
            return null;
        }
    },

    detectEstimatedMembers(dialog) {
        try {
            // Procurar texto com padrão "XXX membros" ou "XXX members"
            const allText = dialog.textContent || '';
            const memberPatterns = [
                /(\d+)\s*membros/i,
                /(\d+)\s*members/i,
                /(\d+)\s*participantes/i,
                /(\d+)\s*participants/i
            ];
            
            for (const pattern of memberPatterns) {
                const match = allText.match(pattern);
                if (match && match[1]) {
                    const count = parseInt(match[1], 10);
                    if (count > 0 && count < 100000) { // Validação básica
                        this.state.estimatedMembers = count;
                        this.log(`📊 Estimativa detectada: ${count} membros`);
                        return;
                    }
                }
            }
            
            // Fallback: usar 100 como padrão
            this.state.estimatedMembers = 100;
            this.log('📊 Usando estimativa padrão: 100 membros');
        } catch (error) {
            this.state.estimatedMembers = 100;
            this.log('⚠️ Erro ao detectar estimativa, usando padrão: 100');
        }
    },



    async closeModalAndPanels() {
        try {
            this.log('🔒 Fechando painéis...');

            if (this.state.modalInfo) {
                const closeButtons = this.state.modalInfo.modal.querySelectorAll(
                    '[data-icon="x"], [aria-label*="Fechar"]'
                );
                for (const btn of closeButtons) {
                    btn.click();
                    await this.delay(200);
                }
            }

            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                keyCode: 27,
                bubbles: true
            }));
            await this.delay(200);
        } catch (error) {
            this.log('⚠️ Erro ao fechar:', error);
        }
    },

    // ========================================
    // FUNÇÃO PRINCIPAL
    // ========================================
    async extractMembers(onProgress, onComplete, onError) {
        try {
            if (this.state.isExtracting) {
                throw new Error('Extração já em andamento');
            }

            this.state.isExtracting = true;
            this.state.isPaused = false;
            this.state.shouldStop = false;
            this.state.members.clear();
            this.state.memberCache.clear();
            this.state.lastReportedProgress = 30; // Reset para nova extração (começa em 30%)

            this.log('=== INICIANDO EXTRAÇÃO v6.0.7 MEGA OTIMIZADA ===');

            this.state.groupName = this.getGroupName();

            onProgress?.({ status: 'Abrindo informações...', count: 0 });
            await this.openGroupInfo();
            await this.delay(1000);

            onProgress?.({ status: 'Expandindo lista...', count: 0 });
            await this.clickSeeAllMembers();
            await this.delay(1200);

            onProgress?.({ status: 'Localizando membros...', count: 0 });
            this.state.modalInfo = this.findMembersModal();

            if (!this.state.modalInfo) {
                throw new Error('Modal não encontrado');
            }

            onProgress?.({ status: 'Capturando membros...', count: 0 });

            await this.scrollAndCaptureOptimized(this.state.modalInfo, (data) => {
                onProgress?.({
                    status: 'Capturando membros...',
                    count: data.loaded,
                    members: data.members
                });
            });

            await this.closeModalAndPanels();

            this.state.isExtracting = false;

            const membersArray = Array.from(this.state.members.values());
            const result = {
                groupName: this.state.groupName,
                totalMembers: membersArray.length,
                members: membersArray,
                extractedAt: new Date().toISOString()
            };

            this.log('=== ✅ EXTRAÇÃO CONCLUÍDA ===');
            this.log(`📋 ${result.totalMembers} membros únicos`);

            onComplete?.(result);
            return result;

        } catch (error) {
            this.state.isExtracting = false;
            this.log('❌ Erro:', error);
            onError?.(error.message);
            throw error;
        }
    },

    stopExtraction() {
        this.state.isExtracting = false;
        this.state.shouldStop = true;
        this.state.isPaused = false;
        if (this.domCache) {
            this.domCache.clear();
        }
        this.log('⏹️ Extração interrompida');
    },

    pauseExtraction() {
        this.state.isPaused = true;
        this.log('⏸️ Extração pausada');
    },

    resumeExtraction() {
        this.state.isPaused = false;
        this.log('▶️ Extração retomada');
    },

    // Delegate to inject.js API for group listing
    async getGroups(includeArchived = true) {
        this.log('⚠️ getGroups() chamado no WhatsAppExtractor - delegando para __waExtractorAPI');
        
        // This method exists for compatibility but delegates to the inject.js API
        if (window.__waExtractorAPI && typeof window.__waExtractorAPI.getGroups === 'function') {
            try {
                // A API retorna diretamente, não uma Promise - então envolvemos em Promise.resolve()
                const result = window.__waExtractorAPI.getGroups({ includeArchived });
                return Promise.resolve(result);
            } catch (e) {
                return Promise.resolve({ 
                    success: false, 
                    error: e.message || 'Erro ao carregar grupos' 
                });
            }
        }
        
        return Promise.resolve({ 
            success: false, 
            error: 'API de grupos não disponível. Recarregue a página.' 
        });
    },

    debugDOM() {
        console.log('=== 🔍 DEBUG DOM v6.0.7 ===');

        const dialogs = document.querySelectorAll('[role="dialog"]');
        console.log(`Dialogs: ${dialogs.length}`);

        dialogs.forEach((d, i) => {
            console.log(`\nDialog ${i}:`);
            const scrollables = [];

            d.querySelectorAll('div').forEach(div => {
                const style = window.getComputedStyle(div);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                    if (div.scrollHeight > div.clientHeight + 50) {
                        const items = div.querySelectorAll('[role="listitem"]');
                        scrollables.push({
                            scrollHeight: div.scrollHeight,
                            clientHeight: div.clientHeight,
                            items: items.length
                        });
                    }
                }
            });

            console.log('  Scrollables:', scrollables);
        });

        console.log('\n📊 Cache stats:');
        console.log('  Members cached:', this.state.memberCache.size);
        console.log('  Unique members:', this.state.members.size);
    }
};

// Inicializar caches ao carregar
WhatsAppExtractor.initCaches();

window.WhatsAppExtractor = WhatsAppExtractor;
window.debugWA = () => WhatsAppExtractor.debugDOM();

console.log('[WA Extractor] ✅ v6.0.7 MEGA OTIMIZADO carregado');
console.log('[WA Extractor] 🚀 Performance: LRU Cache, Adaptive Scrolling, Debounced Updates');
console.log('[WA Extractor] 📊 Progress: 30-95% for extraction (65% of bar)');
console.log('[WA Extractor] 💡 Use debugWA() no console para debug');