// utils-optimized.js - Utilitários de Performance e Otimização v6.0.2

// ========================================
// DEBOUNCE E THROTTLE
// ========================================
const PerformanceUtils = {
    /**
     * Debounce: executa função apenas após período de inatividade
     */
    debounce(func, wait, immediate = false) {
        let timeout;
        return function executedFunction(...args) {
            const context = this;
            const later = () => {
                timeout = null;
                if (!immediate) func.apply(context, args);
            };

            const callNow = immediate && !timeout;
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);

            if (callNow) func.apply(context, args);
        };
    },

    /**
     * Throttle: limita execuções a uma por período
     */
    throttle(func, limit) {
        let inThrottle;
        let lastFunc;
        let lastRan;

        return function(...args) {
            const context = this;

            if (!inThrottle) {
                func.apply(context, args);
                lastRan = Date.now();
                inThrottle = true;
            } else {
                clearTimeout(lastFunc);
                lastFunc = setTimeout(() => {
                    if ((Date.now() - lastRan) >= limit) {
                        func.apply(context, args);
                        lastRan = Date.now();
                    }
                }, Math.max(limit - (Date.now() - lastRan), 0));
            }
        };
    },

    /**
     * RequestIdleCallback wrapper
     */
    runWhenIdle(callback, options = {}) {
        const { timeout = 1000 } = options;

        if ('requestIdleCallback' in window) {
            return new Promise((resolve) => {
                requestIdleCallback((deadline) => {
                    resolve(callback(deadline));
                }, { timeout });
            });
        }

        // Fallback
        return new Promise((resolve) => {
            setTimeout(() => resolve(callback()), 0);
        });
    },

    /**
     * Batch DOM updates usando requestAnimationFrame
     */
    batchUpdate(updates) {
        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                updates();
                resolve();
            });
        });
    },

    /**
     * Processar array em chunks
     */
    async processInChunks(items, processor, chunkSize = 100, onProgress = null) {
        const results = [];
        const totalChunks = Math.ceil(items.length / chunkSize);

        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            const currentChunk = Math.floor(i / chunkSize) + 1;

            const processBatch = () => chunk.map(processor);
            const chunkResults = await this.runWhenIdle(processBatch);

            results.push(...chunkResults);

            if (onProgress) {
                onProgress({
                    current: results.length,
                    total: items.length,
                    chunk: currentChunk,
                    totalChunks: totalChunks,
                    progress: (results.length / items.length) * 100
                });
            }

            if (i + chunkSize < items.length) {
                await new Promise(r => setTimeout(r, 0));
            }
        }

        return results;
    }
};

// ========================================
// CACHE LRU OTIMIZADO
// ========================================
class LRUCache {
    constructor(maxSize = 100) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) {
            return null;
        }
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }
        this.cache.set(key, value);
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }

    keys() {
        return Array.from(this.cache.keys());
    }

    values() {
        return Array.from(this.cache.values());
    }
}

// ========================================
// SMART CACHE COM TTL
// ========================================
class SmartCache {
    constructor(options = {}) {
        this.maxAge = options.maxAge || 5 * 60 * 1000; // 5 minutos
        this.maxSize = options.maxSize || 1000;
        this.cache = new Map();
    }

    set(key, value, customMaxAge = null) {
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            maxAge: customMaxAge || this.maxAge
        });
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        if (Date.now() - item.timestamp > item.maxAge) {
            this.cache.delete(key);
            return null;
        }

        return item.value;
    }

    has(key) {
        return this.get(key) !== null;
    }

    invalidate(key) {
        this.cache.delete(key);
    }

    invalidatePattern(pattern) {
        for (const key of this.cache.keys()) {
            if (pattern.test(key)) {
                this.cache.delete(key);
            }
        }
    }

    clear() {
        this.cache.clear();
    }

    cleanup() {
        const now = Date.now();
        for (const [key, item] of this.cache.entries()) {
            if (now - item.timestamp > item.maxAge) {
                this.cache.delete(key);
            }
        }
    }

    get size() {
        return this.cache.size;
    }
}

// ========================================
// MEMORY POOL
// ========================================
class MemoryPool {
    constructor(factory, resetFn = null, initialSize = 10) {
        this.factory = factory;
        this.resetFn = resetFn;
        this.available = [];
        this.inUse = new Set();

        for (let i = 0; i < initialSize; i++) {
            this.available.push(this.factory());
        }
    }

    acquire() {
        let obj;
        if (this.available.length > 0) {
            obj = this.available.pop();
        } else {
            obj = this.factory();
        }
        this.inUse.add(obj);
        return obj;
    }

    release(obj) {
        if (!this.inUse.has(obj)) return;
        this.inUse.delete(obj);

        if (this.resetFn) {
            this.resetFn(obj);
        }

        this.available.push(obj);
    }

    clear() {
        this.available = [];
        this.inUse.clear();
    }

    get stats() {
        return {
            available: this.available.length,
            inUse: this.inUse.size,
            total: this.available.length + this.inUse.size
        };
    }
}

// ========================================
// PERFORMANCE MONITOR
// ========================================
class PerformanceMonitor {
    constructor() {
        this.marks = new Map();
        this.measures = [];
    }

    mark(name) {
        this.marks.set(name, performance.now());
    }

    measure(name, startMark, endMark = null) {
        const start = this.marks.get(startMark);
        const end = endMark ? this.marks.get(endMark) : performance.now();

        if (!start) {
            console.warn(`Mark "${startMark}" not found`);
            return null;
        }

        const duration = end - start;
        this.measures.push({
            name,
            startMark,
            endMark,
            duration,
            timestamp: Date.now()
        });

        return duration;
    }

    getAverageDuration(measureName) {
        const filtered = this.measures.filter(m => m.name === measureName);
        if (filtered.length === 0) return 0;

        const sum = filtered.reduce((acc, m) => acc + m.duration, 0);
        return sum / filtered.length;
    }

    clear() {
        this.marks.clear();
        this.measures = [];
    }

    report() {
        console.log('=== Performance Report ===');

        const grouped = {};
        for (const measure of this.measures) {
            if (!grouped[measure.name]) {
                grouped[measure.name] = [];
            }
            grouped[measure.name].push(measure.duration);
        }

        for (const [name, durations] of Object.entries(grouped)) {
            const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
            const min = Math.min(...durations);
            const max = Math.max(...durations);

            console.log(`${name}:`);
            console.log(`  Calls: ${durations.length}`);
            console.log(`  Avg: ${avg.toFixed(2)}ms`);
            console.log(`  Min: ${min.toFixed(2)}ms`);
            console.log(`  Max: ${max.toFixed(2)}ms`);
        }
    }
}

// ========================================
// VIRTUAL SCROLL OTIMIZADO
// ========================================
class VirtualScroll {
    constructor(container, options = {}) {
        this.container = container;
        this.itemHeight = options.itemHeight || 60;
        this.buffer = options.buffer || 3;
        this.renderItem = options.renderItem || ((item) => item.toString());

        this.items = [];
        this.visibleItems = [];
        this.scrollTop = 0;
        this.containerHeight = 0;

        this.content = null;
        this.viewport = null;
        this.handleScroll = null;
        this.resizeObserver = null;

        this.init();
    }

    init() {
        this.container.style.overflow = 'auto';
        this.container.style.position = 'relative';

        this.content = document.createElement('div');
        this.content.style.position = 'relative';
        this.container.appendChild(this.content);

        this.viewport = document.createElement('div');
        this.viewport.style.position = 'absolute';
        this.viewport.style.width = '100%';
        this.content.appendChild(this.viewport);

        // Throttled scroll handler
        this.handleScroll = PerformanceUtils.throttle(() => {
            this.scrollTop = this.container.scrollTop;
            this.render();
        }, 16);

        this.container.addEventListener('scroll', this.handleScroll);

        this.resizeObserver = new ResizeObserver(() => {
            this.updateContainerHeight();
        });
        this.resizeObserver.observe(this.container);
    }

    setItems(items) {
        this.items = items;
        this.content.style.height = `${items.length * this.itemHeight}px`;
        this.render();
    }

    updateContainerHeight() {
        this.containerHeight = this.container.clientHeight;
        this.render();
    }

    render() {
        if (!this.items || this.items.length === 0) return;

        const startIndex = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.buffer);
        const endIndex = Math.min(
            this.items.length,
            Math.ceil((this.scrollTop + this.containerHeight) / this.itemHeight) + this.buffer
        );

        this.viewport.style.transform = `translateY(${startIndex * this.itemHeight}px)`;

        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i < endIndex; i++) {
            const el = this.renderItem(this.items[i], i);
            fragment.appendChild(el);
        }

        PerformanceUtils.batchUpdate(() => {
            this.viewport.innerHTML = '';
            this.viewport.appendChild(fragment);
        });
    }

    scrollToIndex(index) {
        this.container.scrollTop = index * this.itemHeight;
    }

    destroy() {
        if (this.handleScroll) {
            this.container.removeEventListener('scroll', this.handleScroll);
            this.handleScroll = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.viewport && this.viewport.parentNode) {
            this.viewport.remove();
        }

        if (this.content && this.content.parentNode) {
            this.content.remove();
        }

        this.items = [];
        this.viewport = null;
        this.content = null;
    }
}

// ========================================
// BATCH PROCESSOR
// ========================================
class BatchProcessor {
    constructor(options = {}) {
        this.batchSize = options.batchSize || 50;
        this.delayBetweenBatches = options.delayBetweenBatches || 0;
        this.onProgress = options.onProgress || null;
        this.useIdleCallback = options.useIdleCallback !== false;
    }

    async process(items, processor) {
        const results = [];
        const totalBatches = Math.ceil(items.length / this.batchSize);

        for (let i = 0; i < items.length; i += this.batchSize) {
            const batch = items.slice(i, i + this.batchSize);
            const currentBatch = Math.floor(i / this.batchSize) + 1;

            const processBatch = () => batch.map(processor);

            const batchResults = this.useIdleCallback
                ? await PerformanceUtils.runWhenIdle(processBatch)
                : processBatch();

            results.push(...batchResults);

            if (this.onProgress) {
                this.onProgress({
                    processed: results.length,
                    total: items.length,
                    batch: currentBatch,
                    totalBatches,
                    progress: (results.length / items.length) * 100
                });
            }

            if (this.delayBetweenBatches > 0 && i + this.batchSize < items.length) {
                await new Promise(r => setTimeout(r, this.delayBetweenBatches));
            }
        }

        return results;
    }
}

// ========================================
// EXPORTS (WINDOW GLOBAL)
// ========================================
window.PerformanceUtils = PerformanceUtils;
window.LRUCache = LRUCache;
window.SmartCache = SmartCache;
window.MemoryPool = MemoryPool;
window.PerformanceMonitor = PerformanceMonitor;
window.VirtualScroll = VirtualScroll;
window.BatchProcessor = BatchProcessor;

console.log('[Utils] ✅ Performance utilities v6.0.2 loaded');