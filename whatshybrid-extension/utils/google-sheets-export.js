// google-sheets-export.js - Exportação para Google Sheets v6.0.2

class GoogleSheetsExporter {
    constructor() {
        this.sheetsAPIUrl = 'https://docs.google.com/spreadsheets/create';
    }

    // ========================================
    // COPIAR PARA GOOGLE SHEETS (TSV)
    // ========================================
    async copyForSheets(data) {
        try {
            console.log('[Sheets] Preparando dados para Google Sheets...');

            const headers = [
                'Nome',
                'Telefone',
                'Admin',
                'Grupo',
                'Status Grupo',
                'Data Extração'
            ];

            const rows = data.members.map(member => [
                member.name || '',
                member.phone || '',
                member.isAdmin ? 'Sim' : 'Não',
                data.groupName || '',
                data.isArchived ? 'Arquivado' : 'Ativo',
                new Date(member.extractedAt).toLocaleString('pt-BR')
            ]);

            const tsvContent = [headers, ...rows]
                .map(row => row.join('\t'))
                .join('\n');

            await navigator.clipboard.writeText(tsvContent);

            console.log('[Sheets] ✅ Dados copiados para área de transferência');

            return {
                success: true,
                format: 'TSV',
                rows: rows.length + 1,
                instructions: 'Cole (Ctrl+V) diretamente no Google Sheets'
            };
        } catch (error) {
            console.error('[Sheets] Erro ao copiar:', error);
            throw error;
        }
    }

    // ========================================
    // COPIAR COM FORMATAÇÃO RICA (HTML)
    // ========================================
    async copyForSheetsWithFormatting(data) {
        try {
            console.log('[Sheets] Preparando dados formatados...');

            const html = this.generateHTMLTable(data);
            const tsv = await this.generateTSV(data);

            // Tentar clipboard com múltiplos formatos
            try {
                const clipboardItem = new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([tsv], { type: 'text/plain' })
                });

                await navigator.clipboard.write([clipboardItem]);
                console.log('[Sheets] ✅ Dados formatados copiados');

                return {
                    success: true,
                    format: 'HTML + TSV',
                    rows: data.members.length + 1
                };
            } catch (e) {
                // Fallback para texto simples
                console.log('[Sheets] Fallback para TSV simples');
                return await this.copyForSheets(data);
            }
        } catch (error) {
            console.error('[Sheets] Erro ao copiar formatado:', error);
            return await this.copyForSheets(data);
        }
    }

    // ========================================
    // GERAR HTML TABLE
    // ========================================
    generateHTMLTable(data) {
        const headerStyle = 'style="background-color: #4CAF50; color: white; font-weight: bold; padding: 8px; border: 1px solid #ddd;"';
        const cellStyle = 'style="padding: 8px; border: 1px solid #ddd;"';
        const adminStyle = 'style="padding: 8px; border: 1px solid #ddd; background-color: #FFF9C4;"';

        const headers = [
            'Nome',
            'Telefone',
            'Admin',
            'Grupo',
            'Status',
            'Data Extração'
        ];

        const headerRow = `
            <tr>
                ${headers.map(h => `<th ${headerStyle}>${h}</th>`).join('')}
            </tr>
        `;

        const dataRows = data.members.map(member => {
            const isAdmin = member.isAdmin;
            const style = isAdmin ? adminStyle : cellStyle;

            return `
                <tr>
                    <td ${style}>${this.escapeHtml(member.name)}</td>
                    <td ${cellStyle}>${this.escapeHtml(member.phone || '')}</td>
                    <td ${style}>${isAdmin ? '👑 Sim' : 'Não'}</td>
                    <td ${cellStyle}>${this.escapeHtml(data.groupName)}</td>
                    <td ${cellStyle}>${data.isArchived ? '📦 Arquivado' : '💬 Ativo'}</td>
                    <td ${cellStyle}>${new Date(member.extractedAt).toLocaleString('pt-BR')}</td>
                </tr>
            `;
        }).join('');

        return `
            <table style="border-collapse: collapse; font-family: Arial, sans-serif;">
                <thead>${headerRow}</thead>
                <tbody>${dataRows}</tbody>
            </table>
        `;
    }

    // ========================================
    // GERAR TSV
    // ========================================
    async generateTSV(data) {
        const headers = ['Nome', 'Telefone', 'Admin', 'Grupo', 'Status', 'Data Extração'];

        const rows = data.members.map(member => [
            member.name || '',
            member.phone || '',
            member.isAdmin ? 'Sim' : 'Não',
            data.groupName || '',
            data.isArchived ? 'Arquivado' : 'Ativo',
            new Date(member.extractedAt).toLocaleString('pt-BR')
        ]);

        return [headers, ...rows]
            .map(row => row.join('\t'))
            .join('\n');
    }

    // ========================================
    // GERAR URL PARA ABRIR NO SHEETS
    // ========================================
    generateSheetsURL(data) {
        const sheetTitle = encodeURIComponent(`${data.groupName} - Membros`);
        return `https://docs.google.com/spreadsheets/create?title=${sheetTitle}`;
    }

    // ========================================
    // ABRIR GOOGLE SHEETS
    // ========================================
    async openInSheets(data) {
        try {
            await this.copyForSheetsWithFormatting(data);
            const url = this.generateSheetsURL(data);
            window.open(url, '_blank');

            return {
                success: true,
                message: 'Google Sheets aberto. Cole os dados com Ctrl+V',
                action: 'paste'
            };
        } catch (error) {
            console.error('[Sheets] Erro ao abrir:', error);
            throw error;
        }
    }

    // ========================================
    // UTILITÁRIOS
    // ========================================
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getInstructions() {
        return {
            simple: [
                '1. Clique em "Copiar para Sheets"',
                '2. Abra o Google Sheets (sheets.google.com)',
                '3. Crie uma nova planilha',
                '4. Cole os dados (Ctrl+V ou Cmd+V)',
                '5. Pronto! Os dados estarão formatados'
            ],
            tips: [
                '💡 Os dados são copiados com formatação',
                '💡 Admins são destacados automaticamente',
                '💡 Você pode colar em qualquer planilha existente',
                '💡 Funciona também com Excel e LibreOffice'
            ]
        };
    }
}

// ========================================
// HELPER FUNCTIONS
// ========================================
function downloadAsCSV(data, filename) {
    const headers = ['Nome', 'Telefone', 'Admin', 'Grupo', 'Status', 'Data'];

    const rows = data.members.map(m => [
        m.name,
        m.phone || '',
        m.isAdmin ? 'Sim' : 'Não',
        data.groupName,
        data.isArchived ? 'Arquivado' : 'Ativo',
        new Date(m.extractedAt).toLocaleString('pt-BR')
    ]);

    const csv = [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'membros.csv';
    a.click();

    URL.revokeObjectURL(url);
}

async function checkSheetsAvailability() {
    try {
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            return { available: false, reason: 'Clipboard API não disponível' };
        }

        const testWindow = window.open('', '_blank');
        if (testWindow) {
            testWindow.close();
            return { available: true };
        } else {
            return { available: true, warning: 'Pop-ups podem estar bloqueados' };
        }
    } catch (error) {
        return { available: false, reason: error.message };
    }
}

// ========================================
// EXPORTS (WINDOW GLOBAL)
// ========================================
window.GoogleSheetsExporter = GoogleSheetsExporter;
window.downloadAsCSV = downloadAsCSV;
window.checkSheetsAvailability = checkSheetsAvailability;

console.log('[Google Sheets] ✅ Export module v6.0.2 loaded');