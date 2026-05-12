// storage.js - IndexedDB Storage v6.0.2

class ExtractionStorage {
    constructor() {
        this.dbName = 'WAExtractorDB';
        this.dbVersion = 2;
        this.db = null;
    }

    // ========================================
    // INICIALIZAÇÃO DO BANCO
    // ========================================
    async init() {
        return new Promise((resolve, reject) => {
            console.log('[Storage] Inicializando IndexedDB...');

            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('[Storage] Erro ao abrir DB:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[Storage] ✅ DB aberto com sucesso');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                console.log('[Storage] Atualizando estrutura do DB...');
                const db = event.target.result;

                // Store para extrações
                if (!db.objectStoreNames.contains('extractions')) {
                    const extractionsStore = db.createObjectStore('extractions', {
                        keyPath: 'id',
                        autoIncrement: true
                    });

                    extractionsStore.createIndex('groupId', 'groupId', { unique: false });
                    extractionsStore.createIndex('groupName', 'groupName', { unique: false });
                    extractionsStore.createIndex('extractedAt', 'extractedAt', { unique: false });
                    extractionsStore.createIndex('totalMembers', 'totalMembers', { unique: false });

                    console.log('[Storage] Store "extractions" criada');
                }

                // Store para grupos favoritos
                if (!db.objectStoreNames.contains('favorites')) {
                    db.createObjectStore('favorites', { keyPath: 'groupId' });
                    console.log('[Storage] Store "favorites" criada');
                }

                // Store para configurações
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                    console.log('[Storage] Store "settings" criada');
                }
            };
        });
    }

    // ========================================
    // SALVAR EXTRAÇÃO
    // ========================================
    async saveExtraction(data) {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('extractions', 'readwrite');
            const store = tx.objectStore('extractions');

            const record = {
                groupId: data.groupId || this.generateGroupId(data.groupName),
                groupName: data.groupName,
                members: data.members,
                totalMembers: data.totalMembers || data.members.length,
                isArchived: data.isArchived || false,
                extractedAt: data.extractedAt || new Date().toISOString(),
                metadata: {
                    version: '6.0.2',
                    browser: navigator.userAgent,
                    timestamp: Date.now()
                }
            };

            const request = store.add(record);

            request.onsuccess = () => {
                console.log('[Storage] ✅ Extração salva com ID:', request.result);
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('[Storage] Erro ao salvar:', request.error);
                reject(request.error);
            };
        });
    }

    // ========================================
    // OBTER HISTÓRICO
    // ========================================
    async getExtractionHistory(options = {}) {
        if (!this.db) {
            await this.init();
        }

        const {
            groupId = null,
            groupName = null,
            limit = 50,
            offset = 0,
            sortBy = 'extractedAt',
            sortOrder = 'desc'
        } = options;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('extractions', 'readonly');
            const store = tx.objectStore('extractions');
            let request;

            if (groupId) {
                const index = store.index('groupId');
                request = index.openCursor(
                    IDBKeyRange.only(groupId), 
                    sortOrder === 'desc' ? 'prev' : 'next'
                );
            } else if (groupName) {
                const index = store.index('groupName');
                request = index.openCursor(
                    IDBKeyRange.only(groupName), 
                    sortOrder === 'desc' ? 'prev' : 'next'
                );
            } else {
                const index = store.index(sortBy);
                request = index.openCursor(null, sortOrder === 'desc' ? 'prev' : 'next');
            }

            const results = [];
            let skipCount = 0;

            request.onsuccess = (event) => {
                const cursor = event.target.result;

                if (cursor) {
                    if (skipCount < offset) {
                        skipCount++;
                        cursor.continue();
                        return;
                    }

                    if (results.length < limit) {
                        results.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(results);
                    }
                } else {
                    resolve(results);
                }
            };

            request.onerror = () => {
                console.error('[Storage] Erro ao buscar histórico:', request.error);
                reject(request.error);
            };
        });
    }

    // ========================================
    // OBTER EXTRAÇÃO POR ID
    // ========================================
    async getExtraction(id) {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('extractions', 'readonly');
            const store = tx.objectStore('extractions');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ========================================
    // DELETAR EXTRAÇÃO
    // ========================================
    async deleteExtraction(id) {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('extractions', 'readwrite');
            const store = tx.objectStore('extractions');
            const request = store.delete(id);

            request.onsuccess = () => {
                console.log('[Storage] ✅ Extração deletada:', id);
                resolve(true);
            };

            request.onerror = () => {
                console.error('[Storage] Erro ao deletar:', request.error);
                reject(request.error);
            };
        });
    }

    // ========================================
    // LIMPAR TODO HISTÓRICO
    // ========================================
    async clearAllExtractions() {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('extractions', 'readwrite');
            const store = tx.objectStore('extractions');
            const request = store.clear();

            request.onsuccess = () => {
                console.log('[Storage] ✅ Todo histórico limpo');
                resolve(true);
            };

            request.onerror = () => {
                console.error('[Storage] Erro ao limpar:', request.error);
                reject(request.error);
            };
        });
    }

    // ========================================
    // LIMPAR HISTÓRICO ANTIGO
    // ========================================
    async cleanOldExtractions(daysToKeep = 30) {
        if (!this.db) {
            await this.init();
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffTimestamp = cutoffDate.toISOString();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('extractions', 'readwrite');
            const store = tx.objectStore('extractions');
            const index = store.index('extractedAt');
            const range = IDBKeyRange.upperBound(cutoffTimestamp);
            const request = index.openCursor(range);

            let deletedCount = 0;

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    console.log(`[Storage] ✅ ${deletedCount} extrações antigas removidas`);
                    resolve(deletedCount);
                }
            };

            request.onerror = () => {
                console.error('[Storage] Erro ao limpar:', request.error);
                reject(request.error);
            };
        });
    }

    // ========================================
    // ESTATÍSTICAS
    // ========================================
    async getStats() {
        if (!this.db) {
            await this.init();
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('extractions', 'readonly');
            const store = tx.objectStore('extractions');
            const countRequest = store.count();

            countRequest.onsuccess = () => {
                const totalExtractions = countRequest.result;

                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = () => {
                    const extractions = getAllRequest.result;

                    const stats = {
                        totalExtractions,
                        totalGroups: new Set(extractions.map(e => e.groupId)).size,
                        totalMembers: extractions.reduce((sum, e) => sum + e.totalMembers, 0),
                        averageMembersPerGroup: totalExtractions > 0
                            ? Math.round(extractions.reduce((sum, e) => sum + e.totalMembers, 0) / totalExtractions)
                            : 0,
                        oldestExtraction: extractions.length > 0
                            ? extractions.reduce((oldest, e) =>
                                e.extractedAt < oldest.extractedAt ? e : oldest
                            ).extractedAt
                            : null,
                        newestExtraction: extractions.length > 0
                            ? extractions.reduce((newest, e) =>
                                e.extractedAt > newest.extractedAt ? e : newest
                            ).extractedAt
                            : null
                    };

                    resolve(stats);
                };

                getAllRequest.onerror = () => reject(getAllRequest.error);
            };

            countRequest.onerror = () => reject(countRequest.error);
        });
    }

    // ========================================
    // UTILITÁRIOS
    // ========================================
    generateGroupId(groupName) {
        let hash = 0;
        for (let i = 0; i < groupName.length; i++) {
            const char = groupName.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `group_${Math.abs(hash)}`;
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
            console.log('[Storage] Conexão fechada');
        }
    }
}

// ========================================
// SINGLETON INSTANCE
// ========================================
let storageInstance = null;

function getStorage() {
    if (!storageInstance) {
        storageInstance = new ExtractionStorage();
    }
    return storageInstance;
}

// ========================================
// EXPORTS (WINDOW GLOBAL)
// ========================================
window.ExtractionStorage = ExtractionStorage;
window.getStorage = getStorage;

console.log('[Storage] ✅ Module v6.0.2 loaded');