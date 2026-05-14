/**
 * Sidepanel Inline Scripts - Movido para arquivo separado por CSP
 * WhatsHybrid v6.8.2
 */

// Initialize all modules after page load
window.addEventListener('load', async function() {
    console.log('[Modules] Inicializando módulos v53...');
    
    // Aguarda módulos estarem carregados via init.js
    // O init.js já faz a inicialização automática
    
    // Tour de onboarding removido — usuário pediu para não aparecer em
    // toda inicialização. O script `onboarding.js` continua carregado
    // (mantém handlers de reset e estado em chrome.storage para versões
    // futuras), mas não é mais auto-iniciado.

    // Garantir renderização após 1 segundo
    setTimeout(function() {
        if (typeof window.renderModuleViews === 'function') {
            console.log('[Modules] Chamando renderModuleViews após load...');
            window.renderModuleViews();
        }
    }, 1000);
});

// Atualiza estatísticas de tarefas
function updateTasksStats() {
    if (!window.TasksModule) return;
    const stats = window.TasksModule.getStats();
    
    const el1 = document.getElementById('stat_total');
    const el2 = document.getElementById('stat_pending');
    const el3 = document.getElementById('stat_overdue');
    const el4 = document.getElementById('stat_completed');
    
    if (el1) el1.textContent = stats.total || 0;
    if (el2) el2.textContent = stats.pending || 0;
    if (el3) el3.textContent = stats.overdue || 0;
    if (el4) el4.textContent = stats.completed || 0;
}

// Carrega estatísticas de treinamento para a aba simplificada
async function loadTrainingStatsSimplified() {
    try {
        const data = await chrome.storage.local.get([
            'whl_few_shot_examples',
            'whl_knowledge_base'
        ]);
        
        const examples = data.whl_few_shot_examples || [];
        const kb = data.whl_knowledge_base || {};
        const faqs = kb.faqs || [];
        const products = kb.products || [];
        
        // Atualizar os elementos na UI
        const elExamples = document.getElementById('training_stat_examples');
        const elFaqs = document.getElementById('training_stat_faqs');
        const elProducts = document.getElementById('training_stat_products');
        const elAccuracy = document.getElementById('training_stat_accuracy');
        
        if (elExamples) elExamples.textContent = examples.length;
        if (elFaqs) elFaqs.textContent = faqs.length;
        if (elProducts) elProducts.textContent = products.length;
        
        // Calcular precisão média baseada na qualidade dos exemplos
        if (examples.length > 0 && elAccuracy) {
            const avgQuality = examples.reduce((sum, ex) => sum + (ex.quality || 8), 0) / examples.length;
            elAccuracy.textContent = `${Math.round(avgQuality * 10)}%`;
        }
        
        console.log('[Sidepanel] Stats de treinamento carregadas');
    } catch (error) {
        console.error('[Sidepanel] Erro ao carregar stats de treinamento:', error);
    }
}

// Expor globalmente
window.loadTrainingStatsSimplified = loadTrainingStatsSimplified;

// Setup eventos dos botões
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Sidepanel] DOMContentLoaded - configurando handlers...');

    // CRM Header button - Abrir em nova aba
    const btnCrmHeader = document.getElementById('btnOpenCrmFullscreen');
    if (btnCrmHeader) {
        btnCrmHeader.addEventListener('click', () => {
            console.log('[Sidepanel] Abrindo CRM em nova aba...');
            chrome.tabs.create({ url: chrome.runtime.getURL('crm/crm.html') });
        });
        console.log('[Sidepanel] ✅ Handler btnOpenCrmFullscreen configurado');
    }

    // Training Fullscreen button - Abrir em nova aba
    const btnTrainingFullscreen = document.getElementById('btnOpenTrainingFullscreen');
    if (btnTrainingFullscreen) {
        btnTrainingFullscreen.addEventListener('click', () => {
            console.log('[Sidepanel] Abrindo Treinamento de IA em nova aba...');
            chrome.tabs.create({ url: chrome.runtime.getURL('training/training.html') });
        });
        console.log('[Sidepanel] ✅ Handler btnOpenTrainingFullscreen configurado');
    }

    // CRM Fullscreen button - Abrir em nova aba
    const btnCrmFullscreen = document.getElementById('crm_open_fullscreen');
    if (btnCrmFullscreen) {
        btnCrmFullscreen.addEventListener('click', () => {
            console.log('[Sidepanel] Abrindo CRM em nova aba (fullscreen)...');
            chrome.tabs.create({ url: chrome.runtime.getURL('crm/crm.html') });
        });
        console.log('[Sidepanel] ✅ Handler crm_open_fullscreen configurado');
    }

    // CRM buttons
    document.getElementById('crm_new_deal')?.addEventListener('click', () => {
        // Preferir CRMModule (canônico), com fallback legado
        if (window.CRMModule?.showDealModal) {
            window.CRMModule.showDealModal();
        } else if (window.showNewDealModal) {
            window.showNewDealModal();
        } else {
            console.warn('[Sidepanel] Nenhuma função de modal de negócio disponível');
        }
    });

    document.getElementById('crm_new_contact')?.addEventListener('click', () => {
        // Preferir CRMModule (canônico), com fallback legado
        if (window.CRMModule?.showContactModal) {
            window.CRMModule.showContactModal();
        } else if (window.showNewContactModal) {
            window.showNewContactModal();
        } else {
            console.warn('[Sidepanel] Nenhuma função de modal de contato disponível');
        }
    });

    document.getElementById('crm_refresh')?.addEventListener('click', async () => {
        if (window.CRMModule?.reloadData) {
            await window.CRMModule.reloadData();
        }
        if (window.renderModuleViews) {
            window.renderModuleViews();
        }
    });

    // Analytics buttons
    document.getElementById('analytics_refresh')?.addEventListener('click', () => {
        if (window.renderModuleViews) window.renderModuleViews();
        if (window.NotificationsModule) {
            window.NotificationsModule.success('Dashboard atualizado!');
        }
    });

    document.getElementById('analytics_reset')?.addEventListener('click', async () => {
        if (confirm('Tem certeza que deseja resetar todas as métricas? Esta ação não pode ser desfeita.')) {
            if (window.AnalyticsModule) {
                await window.AnalyticsModule.resetAll();
                if (window.renderModuleViews) window.renderModuleViews();
                if (window.NotificationsModule) {
                    window.NotificationsModule.success('Métricas resetadas!');
                }
            }
        }
    });

    // AI Test buttons
    document.getElementById('ai_test_btn')?.addEventListener('click', async () => {
        const input = document.getElementById('ai_test_input')?.value?.trim();
        if (!input) return;

        if (!window.SmartRepliesModule?.isConfigured()) {
            alert('Configure o provedor de IA primeiro');
            return;
        }

        try {
            document.getElementById('ai_test_btn').disabled = true;
            document.getElementById('ai_test_btn').textContent = '⏳ Gerando...';

            const reply = await window.SmartRepliesModule.generateReply('test', [
                { role: 'user', content: input }
            ]);

            document.getElementById('ai_test_output').style.display = 'block';
            document.getElementById('ai_test_result').textContent = reply;
        } catch (error) {
            alert('Erro ao gerar resposta: ' + error.message);
        } finally {
            document.getElementById('ai_test_btn').disabled = false;
            document.getElementById('ai_test_btn').textContent = '🚀 Gerar Resposta';
        }
    });

    document.getElementById('ai_correct_btn')?.addEventListener('click', async () => {
        const input = document.getElementById('ai_test_input')?.value?.trim();
        if (!input) return;

        if (!window.SmartRepliesModule?.isConfigured()) {
            alert('Configure o provedor de IA primeiro');
            return;
        }

        try {
            document.getElementById('ai_correct_btn').disabled = true;
            document.getElementById('ai_correct_btn').textContent = '⏳...';

            const result = await window.SmartRepliesModule.correctText(input);

            document.getElementById('ai_test_output').style.display = 'block';
            document.getElementById('ai_test_result').innerHTML = result.hasChanges 
                ? '<strong>Corrigido:</strong><br>' + result.corrected
                : '<em>Texto já está correto!</em>';
        } catch (error) {
            alert('Erro ao corrigir texto: ' + error.message);
        } finally {
            document.getElementById('ai_correct_btn').disabled = false;
            document.getElementById('ai_correct_btn').textContent = '✏️ Corrigir Texto';
        }
    });

    // Dispatch settings buttons
    document.getElementById('sp_save_settings')?.addEventListener('click', async () => {
        const delayMin = parseFloat(document.getElementById('sp_delay_min')?.value) || 2;
        const delayMax = parseFloat(document.getElementById('sp_delay_max')?.value) || 6;
        
        try {
            await chrome.storage.local.set({
                whl_delay_min: delayMin,
                whl_delay_max: delayMax
            });
            
            const statusEl = document.getElementById('sp_config_status');
            if (statusEl) {
                statusEl.textContent = '✅ Configurações salvas!';
                setTimeout(() => statusEl.textContent = 'Pronto.', 2000);
            }
        } catch (error) {
            console.error('[Sidepanel] Erro ao salvar configurações:', error);
            alert('Erro ao salvar configurações: ' + error.message);
        }
    });

    document.getElementById('sp_reload_settings')?.addEventListener('click', async () => {
        try {
            const { whl_delay_min, whl_delay_max } = await chrome.storage.local.get(['whl_delay_min', 'whl_delay_max']);
            
            const minEl = document.getElementById('sp_delay_min');
            const maxEl = document.getElementById('sp_delay_max');
            
            if (minEl) minEl.value = whl_delay_min || 2;
            if (maxEl) maxEl.value = whl_delay_max || 6;
            
            const statusEl = document.getElementById('sp_config_status');
            if (statusEl) {
                statusEl.textContent = '✅ Configurações recarregadas!';
                setTimeout(() => statusEl.textContent = 'Pronto.', 2000);
            }
        } catch (error) {
            console.error('[Sidepanel] Erro ao recarregar configurações:', error);
            alert('Erro ao recarregar configurações: ' + error.message);
        }
    });

    // Scheduler button
    document.getElementById('sp_add_schedule')?.addEventListener('click', async () => {
        if (window.addSchedule) {
            await window.addSchedule();
        } else {
            console.warn('[Sidepanel] addSchedule function not available');
        }
    });

    // Anti-ban buttons
    document.getElementById('sp_save_antiban')?.addEventListener('click', async () => {
        if (window.saveAntiBanSettings) {
            await window.saveAntiBanSettings();
        } else {
            console.warn('[Sidepanel] saveAntiBanSettings function not available');
        }
    });

    document.getElementById('sp_reset_daily_count')?.addEventListener('click', async () => {
        if (confirm('Resetar o contador diário de mensagens?')) {
            try {
                await chrome.storage.local.set({ whl_daily_count: 0, whl_daily_count_date: new Date().toDateString() });
                alert('Contador resetado!');
            } catch (error) {
                console.error('[Sidepanel] Erro ao resetar contador:', error);
                alert('Erro ao resetar contador: ' + error.message);
            }
        }
    });

    // Notification test button
    document.getElementById('sp_test_notification')?.addEventListener('click', async () => {
        if (window.testNotification) {
            await window.testNotification();
        } else {
            console.warn('[Sidepanel] testNotification function not available');
        }
    });

    // Template save button
    document.getElementById('sp_save_draft')?.addEventListener('click', async () => {
        if (window.saveDraft) {
            await window.saveDraft();
        } else {
            console.warn('[Sidepanel] saveDraft function not available');
        }
    });

    // Report buttons
    document.getElementById('sp_export_report')?.addEventListener('click', async () => {
        if (window.exportReportCSV) {
            await window.exportReportCSV();
        } else {
            console.warn('[Sidepanel] exportReportCSV function not available');
        }
    });

    document.getElementById('sp_copy_failed')?.addEventListener('click', async () => {
        if (window.copyFailedNumbers) {
            await window.copyFailedNumbers();
        } else {
            console.warn('[Sidepanel] copyFailedNumbers function not available');
        }
    });

    // ============================================
    // QUICK REPLIES HANDLERS
    // ============================================
    
    // Add quick reply
    document.getElementById('qr-add-btn')?.addEventListener('click', async () => {
        const trigger = document.getElementById('qr-trigger')?.value.trim();
        const response = document.getElementById('qr-response')?.value.trim();
        const btn = document.getElementById('qr-add-btn');
        
        if (!trigger || !response) {
            if (btn) {
                btn.textContent = '❌ Preencha campos!';
                setTimeout(() => {
                    btn.textContent = '➕ Adicionar Resposta Rápida';
                }, 2000);
            }
            return;
        }
        
        try {
            if (btn) btn.textContent = '⏳ Salvando...';
            await window.quickReplies?.addReply(trigger, response);
            document.getElementById('qr-trigger').value = '';
            document.getElementById('qr-response').value = '';
            renderQuickRepliesList();
            if (btn) {
                btn.textContent = '✅ Adicionada!';
                setTimeout(() => {
                    btn.textContent = '➕ Adicionar Resposta Rápida';
                }, 2000);
            }
        } catch (e) {
            if (btn) {
                btn.textContent = `❌ ${e.message}`;
                setTimeout(() => {
                    btn.textContent = '➕ Adicionar Resposta Rápida';
                }, 3000);
            }
        }
    });

    // ============================================
    // TEAM SYSTEM HANDLERS
    // ============================================
    
    // Sender name input
    document.getElementById('team-sender-name')?.addEventListener('change', async (e) => {
        await window.teamSystem?.setSenderName(e.target.value);
        console.log('[TeamSystem] Nome do remetente salvo:', e.target.value);
    });
    
    // Add team member
    document.getElementById('team-add-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('team-member-name')?.value.trim();
        const phone = document.getElementById('team-member-phone')?.value.trim();
        const btn = document.getElementById('team-add-btn');
        
        if (!phone) {
            if (btn) {
                btn.textContent = '❌ Número!';
                setTimeout(() => {
                    btn.textContent = '➕ Adicionar';
                }, 2000);
            }
            return;
        }
        
        try {
            if (btn) btn.textContent = '⏳ Salvando...';
            await window.teamSystem?.addMember(name, phone);
            document.getElementById('team-member-name').value = '';
            document.getElementById('team-member-phone').value = '';
            renderTeamMembersList();
            renderTeamStats();
            if (btn) {
                btn.textContent = '✅ Adicionado!';
                setTimeout(() => {
                    btn.textContent = '➕ Adicionar';
                }, 2000);
            }
        } catch (e) {
            if (btn) {
                btn.textContent = '❌ Erro!';
                setTimeout(() => {
                    btn.textContent = '➕ Adicionar';
                }, 3000);
            }
        }
    });
    
    // Select all members
    document.getElementById('team-select-all')?.addEventListener('click', () => {
        window.teamSystem?.selectAll();
        renderTeamMembersList();
        renderTeamStats();
    });
    
    // Clear selection
    document.getElementById('team-clear-selection')?.addEventListener('click', () => {
        window.teamSystem?.clearSelection();
        renderTeamMembersList();
        renderTeamStats();
    });
    
    // Send to team
    document.getElementById('team-send-btn')?.addEventListener('click', async () => {
        const message = document.getElementById('team-message')?.value.trim();
        const statusEl = document.getElementById('team-send-status');
        const btn = document.getElementById('team-send-btn');
        
        if (!message) {
            if (statusEl) {
                statusEl.textContent = '❌ Digite uma mensagem';
                statusEl.className = 'sp-status';
            }
            return;
        }
        
        const selected = window.teamSystem?.getSelected() || [];
        if (selected.length === 0) {
            if (statusEl) {
                statusEl.textContent = '❌ Selecione pelo menos um membro';
                statusEl.className = 'sp-status';
            }
            return;
        }
        
        // Simple confirmation via button feedback instead of blocking alert
        if (btn && !btn.dataset.confirmed) {
            btn.textContent = `⚠️ Confirmar envio para ${selected.length} membro(s)?`;
            btn.dataset.confirmed = 'pending';
            setTimeout(() => {
                if (btn.dataset.confirmed === 'pending') {
                    btn.textContent = '📤 Enviar para Selecionados';
                    delete btn.dataset.confirmed;
                }
            }, 3000);
            return;
        }
        
        if (btn) {
            delete btn.dataset.confirmed;
            btn.textContent = '⏳ Enviando...';
            btn.disabled = true;
        }
        
        if (statusEl) {
            statusEl.textContent = `⏳ Enviando para ${selected.length} membro(s)...`;
            statusEl.className = 'sp-status';
        }
        
        try {
            const results = await window.teamSystem?.sendToTeam(message);
            if (statusEl) {
                statusEl.textContent = `✅ Enviado: ${results.success}/${results.total} | ❌ Falhas: ${results.failed}`;
                statusEl.className = 'sp-status';
            }
            if (btn) {
                btn.textContent = '✅ Concluído!';
                setTimeout(() => {
                    btn.textContent = '📤 Enviar para Selecionados';
                    btn.disabled = false;
                }, 2000);
            }
            document.getElementById('team-message').value = '';
            renderTeamMembersList();
            renderTeamStats();
            
            // Show details if there were failures
            if (results.failed > 0) {
                const failedDetails = results.details
                    .filter(d => d.status === 'failed')
                    .map(d => `${d.member}: ${d.error || 'Erro desconhecido'}`)
                    .join('\n');
                if (statusEl) {
                    statusEl.textContent += `\n\nDetalhes das falhas:\n${failedDetails}`;
                }
            }
        } catch (e) {
            if (statusEl) {
                statusEl.textContent = `❌ Erro: ${e.message}`;
                statusEl.className = 'sp-status';
            }
            if (btn) {
                btn.textContent = '📤 Enviar para Selecionados';
                btn.disabled = false;
            }
        }
    });

    console.log('[Sidepanel] ✅ Todos os handlers configurados');
});

// ============================================
// RENDER FUNCTIONS FOR NEW FEATURES
// ============================================

function renderQuickRepliesList() {
    const list = document.getElementById('qr-list');
    const countEl = document.getElementById('qr-count');
    const replies = window.quickReplies?.getAll() || [];
    
    if (countEl) {
        countEl.textContent = `${replies.length} resposta${replies.length !== 1 ? 's' : ''}`;
    }
    
    if (!list) return;
    
    if (replies.length === 0) {
        list.innerHTML = '<div class="sp-muted" style="text-align: center; padding: 20px;">Nenhuma resposta rápida cadastrada</div>';
        updateQuickRepliesStats();
        return;
    }
    
    list.innerHTML = replies.map(r => {
        // FIX HIGH XSS: r.trigger e r.id vêm de input do usuário e devem ser escapados.
        // O onclick inline com interpolação de string permitia code injection; trocado
        // por handler delegado via data attribute.
        const safeId = escapeHtml(String(r.id || ''));
        const safeTrigger = escapeHtml(String(r.trigger || ''));
        return `
        <div class="sp-card" style="margin-bottom: 8px; padding: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 10px;">
                <div style="flex: 1;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <span style="font-weight: 600; color: var(--mod-primary);">/${safeTrigger}</span>
                        <span class="sp-muted" style="font-size: 11px;">Usado ${r.usageCount || 0}x</span>
                    </div>
                    <div style="font-size: 12px; color: var(--mod-text-muted); white-space: pre-wrap; word-break: break-word;">
                        ${escapeHtml(r.response.slice(0, 100))}${r.response.length > 100 ? '...' : ''}
                    </div>
                </div>
                <button class="sp-btn sp-btn-danger qr-delete-btn" data-id="${safeId}" style="padding: 4px 8px; font-size: 11px;">
                    🗑️
                </button>
            </div>
        </div>
    `;}).join('');

    // FIX: handler delegado em vez de onclick inline (CSP-friendly + sem XSS)
    list.querySelectorAll('.qr-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            if (typeof window.deleteQuickReply === 'function') window.deleteQuickReply(id);
        });
    });
    
    updateQuickRepliesStats();
}

function updateQuickRepliesStats() {
    const stats = window.quickReplies?.getStats();
    if (!stats) return;
    
    const totalEl = document.getElementById('qr-stat-total');
    const usageEl = document.getElementById('qr-stat-usage');
    const mostUsedEl = document.getElementById('qr-stat-most-used');
    
    if (totalEl) totalEl.textContent = stats.total;
    if (usageEl) usageEl.textContent = stats.totalUsage;
    if (mostUsedEl) {
        if (stats.mostUsed.length > 0) {
            mostUsedEl.textContent = `/${stats.mostUsed[0].trigger}`;
        } else {
            mostUsedEl.textContent = '-';
        }
    }
}

async function deleteQuickReply(id) {
    // Use inline confirmation instead of blocking alert
    const btn = event?.target;
    if (btn && !btn.dataset.confirmDelete) {
        btn.textContent = '⚠️';
        btn.dataset.confirmDelete = 'pending';
        setTimeout(() => {
            if (btn.dataset.confirmDelete === 'pending') {
                btn.textContent = '🗑️';
                delete btn.dataset.confirmDelete;
            }
        }, 3000);
        return;
    }
    
    if (btn) delete btn.dataset.confirmDelete;
    
    await window.quickReplies?.removeReply(id);
    renderQuickRepliesList();
}

function renderTeamMembersList() {
    const list = document.getElementById('team-members-list');
    const members = window.teamSystem?.getAll() || [];
    
    if (!list) return;
    
    if (members.length === 0) {
        list.innerHTML = '<div class="sp-muted" style="text-align: center; padding: 20px;">Nenhum membro cadastrado</div>';
        return;
    }
    
    list.innerHTML = members.map(m => {
        // FIX HIGH XSS: m.id, m.phone vêm do storage do usuário; podem ser injetados.
        // onchange/onclick inline com interpolação direta = injeção via aspas.
        const safeId = escapeHtml(String(m.id || ''));
        const safePhone = escapeHtml(window.teamSystem?.formatPhone(m.phone) || String(m.phone || ''));
        return `
        <div class="sp-card ${m.selected ? 'selected' : ''}" style="margin-bottom: 6px; padding: 8px; ${m.selected ? 'background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3);' : ''}">
            <div style="display: flex; align-items: center; gap: 10px;">
                <label style="display: flex; align-items: center; cursor: pointer;">
                    <input type="checkbox" ${m.selected ? 'checked' : ''} class="team-toggle-cb" data-id="${safeId}" style="width: 18px; height: 18px; cursor: pointer;">
                </label>
                <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 13px;">
                        ${escapeHtml(m.name || 'Sem nome')}
                    </div>
                    <div style="font-size: 11px; color: var(--mod-text-muted);">
                        ${safePhone}
                    </div>
                    ${m.messagesSent > 0 ? `
                        <div style="font-size: 10px; color: var(--mod-text-muted); margin-top: 2px;">
                            📤 ${m.messagesSent} mensagem${m.messagesSent !== 1 ? 's' : ''} enviada${m.messagesSent !== 1 ? 's' : ''}
                        </div>
                    ` : ''}
                </div>
                <button class="sp-btn sp-btn-danger team-delete-btn" data-id="${safeId}" style="padding: 4px 8px; font-size: 11px;">
                    🗑️
                </button>
            </div>
        </div>
    `;}).join('');

    // FIX: handlers delegados em vez de onchange/onclick inline
    list.querySelectorAll('.team-toggle-cb').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.currentTarget.dataset.id;
            if (typeof window.toggleTeamMember === 'function') window.toggleTeamMember(id);
        });
    });
    list.querySelectorAll('.team-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            if (typeof window.deleteTeamMember === 'function') window.deleteTeamMember(id);
        });
    });
}

function renderTeamStats() {
    const stats = window.teamSystem?.getStats();
    if (!stats) return;
    
    const totalEl = document.getElementById('team-stat-total');
    const selectedEl = document.getElementById('team-stat-selected');
    const sentEl = document.getElementById('team-stat-sent');
    
    if (totalEl) totalEl.textContent = stats.totalMembers;
    if (selectedEl) selectedEl.textContent = stats.selectedCount;
    if (sentEl) sentEl.textContent = stats.totalMessagesSent;
}

function toggleTeamMember(id) {
    window.teamSystem?.toggleSelection(id);
    renderTeamMembersList();
    renderTeamStats();
}

async function deleteTeamMember(id) {
    // Use inline confirmation instead of blocking alert
    const btn = event?.target;
    if (btn && !btn.dataset.confirmDelete) {
        btn.textContent = '⚠️';
        btn.dataset.confirmDelete = 'pending';
        setTimeout(() => {
            if (btn.dataset.confirmDelete === 'pending') {
                btn.textContent = '🗑️';
                delete btn.dataset.confirmDelete;
            }
        }, 3000);
        return;
    }
    
    if (btn) delete btn.dataset.confirmDelete;
    
    await window.teamSystem?.removeMember(id);
    renderTeamMembersList();
    renderTeamStats();
}

function escapeHtml(text) {
    const fn = window.WHLHtmlUtils?.escapeHtml || window.escapeHtml;
    if (typeof fn === 'function' && fn !== escapeHtml) return fn(text);
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

// Expor funções globais para uso nos onclick do HTML
window.toggleTeamMember = toggleTeamMember;
window.deleteTeamMember = deleteTeamMember;
window.deleteQuickReply = deleteQuickReply;
// Manter compatibilidade com handlers inline (mas preferir a versão central quando existir)
window.escapeHtml = window.WHLHtmlUtils?.escapeHtml || escapeHtml;
window.renderQuickRepliesList = renderQuickRepliesList;
window.renderTeamMembersList = renderTeamMembersList;
window.renderTeamStats = renderTeamStats;

// Initialize new features when views are loaded
window.addEventListener('load', () => {
    setTimeout(() => {
        // Load sender name
        if (window.teamSystem) {
            const senderNameInput = document.getElementById('team-sender-name');
            if (senderNameInput) {
                senderNameInput.value = window.teamSystem.getSenderName() || '';
            }
        }
        
        // Initial render
        renderQuickRepliesList();
        renderTeamMembersList();
        renderTeamStats();
        
        // Initialize TTS handlers
        initTTSHandlers();
    }, 1000);
});

// ============================================
// TEXT-TO-SPEECH HANDLERS
// ============================================

function initTTSHandlers() {
    console.log('[Sidepanel] Inicializando handlers TTS...');
    
    // Carregar configurações salvas
    loadTTSSettings();
    
    // Speed slider
    const speedSlider = document.getElementById('sp_tts_speed');
    const speedValue = document.getElementById('sp_tts_speed_value');
    if (speedSlider && speedValue) {
        speedSlider.addEventListener('input', () => {
            const speed = parseFloat(speedSlider.value);
            speedValue.textContent = `${speed.toFixed(1)}x`;
            if (window.TTS) {
                window.TTS.setSpeed(speed);
            }
        });
    }
    
    // Volume slider
    const volumeSlider = document.getElementById('sp_tts_volume');
    const volumeValue = document.getElementById('sp_tts_volume_value');
    if (volumeSlider && volumeValue) {
        volumeSlider.addEventListener('input', () => {
            const volume = parseFloat(volumeSlider.value);
            volumeValue.textContent = `${Math.round(volume * 100)}%`;
            if (window.TTS) {
                window.TTS.setVolume(volume);
            }
        });
    }
    
    // Voice selector
    const voiceSelect = document.getElementById('sp_tts_voice');
    if (voiceSelect) {
        populateVoiceOptions(voiceSelect);
        voiceSelect.addEventListener('change', () => {
            if (window.TTS) {
                window.TTS.setVoice(voiceSelect.value);
            }
        });
    }
    
    // Test button
    const testBtn = document.getElementById('sp_tts_test');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            updateTTSStatus('🔊 Testando voz...');
            try {
                if (window.TTS) {
                    await window.TTS.speak('Olá! Esta é uma mensagem de teste do WhatsHybrid. A leitura de mensagens está funcionando corretamente.');
                    updateTTSStatus('✅ Teste concluído!');
                } else {
                    updateTTSStatus('❌ TTS não disponível');
                }
            } catch (error) {
                updateTTSStatus(`❌ Erro: ${error.message}`);
            }
        });
    }
    
    // Read last message button
    const readLastBtn = document.getElementById('sp_tts_read_last');
    if (readLastBtn) {
        readLastBtn.addEventListener('click', async () => {
            updateTTSStatus('📖 Lendo última mensagem...');
            try {
                // Enviar mensagem para content script para ler última mensagem
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url?.includes('web.whatsapp.com')) {
                    chrome.tabs.sendMessage(tab.id, { action: 'TTS_READ_LAST_MESSAGE' }, (response) => {
                        if (response?.success) {
                            updateTTSStatus('✅ Lendo mensagem...');
                        } else {
                            updateTTSStatus(response?.error || '❌ Nenhuma mensagem encontrada');
                        }
                    });
                } else {
                    updateTTSStatus('❌ Abra o WhatsApp Web primeiro');
                }
            } catch (error) {
                updateTTSStatus(`❌ Erro: ${error.message}`);
            }
        });
    }
    
    // TTS Enabled checkbox
    const enabledCheckbox = document.getElementById('sp_tts_enabled');
    if (enabledCheckbox) {
        enabledCheckbox.addEventListener('change', () => {
            saveTTSSettings();
            updateTTSStatus(enabledCheckbox.checked ? '✅ TTS ativado' : '⏹️ TTS desativado');
        });
    }
    
    console.log('[Sidepanel] ✅ Handlers TTS configurados');
}

function populateVoiceOptions(selectEl) {
    // Tentar obter vozes do TTS
    if (window.TTS) {
        setTimeout(() => {
            const voices = window.TTS.getVoices();
            selectEl.innerHTML = '';
            
            // Filtrar vozes em português primeiro
            const ptVoices = voices.filter(v => v.lang.startsWith('pt'));
            const otherVoices = voices.filter(v => !v.lang.startsWith('pt'));
            
            // Grupo de português
            if (ptVoices.length > 0) {
                const ptGroup = document.createElement('optgroup');
                ptGroup.label = '🇧🇷 Português';
                ptVoices.forEach(voice => {
                    const opt = document.createElement('option');
                    opt.value = voice.name;
                    opt.textContent = `${voice.name} (${voice.lang})`;
                    ptGroup.appendChild(opt);
                });
                selectEl.appendChild(ptGroup);
            }
            
            // Outras vozes
            if (otherVoices.length > 0) {
                const otherGroup = document.createElement('optgroup');
                otherGroup.label = '🌍 Outras';
                otherVoices.slice(0, 10).forEach(voice => {
                    const opt = document.createElement('option');
                    opt.value = voice.name;
                    opt.textContent = `${voice.name} (${voice.lang})`;
                    otherGroup.appendChild(opt);
                });
                selectEl.appendChild(otherGroup);
            }
            
            if (voices.length === 0) {
                selectEl.innerHTML = '<option value="">Nenhuma voz disponível</option>';
            }
        }, 500);
    } else {
        // Fallback: usar speechSynthesis direto
        const loadVoices = () => {
            const voices = speechSynthesis.getVoices();
            selectEl.innerHTML = '';
            
            const ptVoices = voices.filter(v => v.lang.startsWith('pt'));
            const otherVoices = voices.filter(v => !v.lang.startsWith('pt'));
            
            if (ptVoices.length > 0) {
                const ptGroup = document.createElement('optgroup');
                ptGroup.label = '🇧🇷 Português';
                ptVoices.forEach(voice => {
                    const opt = document.createElement('option');
                    opt.value = voice.name;
                    opt.textContent = `${voice.name} (${voice.lang})`;
                    ptGroup.appendChild(opt);
                });
                selectEl.appendChild(ptGroup);
            }
            
            if (otherVoices.length > 0) {
                const otherGroup = document.createElement('optgroup');
                otherGroup.label = '🌍 Outras';
                otherVoices.slice(0, 10).forEach(voice => {
                    const opt = document.createElement('option');
                    opt.value = voice.name;
                    opt.textContent = `${voice.name} (${voice.lang})`;
                    otherGroup.appendChild(opt);
                });
                selectEl.appendChild(otherGroup);
            }
        };
        
        if (speechSynthesis.getVoices().length > 0) {
            loadVoices();
        } else {
            speechSynthesis.onvoiceschanged = loadVoices;
        }
    }
}

async function loadTTSSettings() {
    try {
        const result = await chrome.storage.local.get(['whl_tts_settings']);
        const settings = result.whl_tts_settings || {};
        
        // Aplicar configurações na UI
        const speedSlider = document.getElementById('sp_tts_speed');
        const speedValue = document.getElementById('sp_tts_speed_value');
        const volumeSlider = document.getElementById('sp_tts_volume');
        const volumeValue = document.getElementById('sp_tts_volume_value');
        const enabledCheckbox = document.getElementById('sp_tts_enabled');
        
        if (speedSlider && settings.speed !== undefined) {
            speedSlider.value = settings.speed;
            if (speedValue) speedValue.textContent = `${settings.speed.toFixed(1)}x`;
        }
        
        if (volumeSlider && settings.volume !== undefined) {
            volumeSlider.value = settings.volume;
            if (volumeValue) volumeValue.textContent = `${Math.round(settings.volume * 100)}%`;
        }
        
        if (enabledCheckbox && settings.enabled !== undefined) {
            enabledCheckbox.checked = settings.enabled;
        }
        
        console.log('[TTS] Configurações carregadas');
    } catch (error) {
        console.error('[TTS] Erro ao carregar configurações:', error);
    }
}

async function saveTTSSettings() {
    try {
        const speedSlider = document.getElementById('sp_tts_speed');
        const volumeSlider = document.getElementById('sp_tts_volume');
        const enabledCheckbox = document.getElementById('sp_tts_enabled');
        const voiceSelect = document.getElementById('sp_tts_voice');
        
        const settings = {
            speed: speedSlider ? parseFloat(speedSlider.value) : 1.0,
            volume: volumeSlider ? parseFloat(volumeSlider.value) : 1.0,
            enabled: enabledCheckbox ? enabledCheckbox.checked : true,
            voice: voiceSelect ? voiceSelect.value : ''
        };
        
        await chrome.storage.local.set({ whl_tts_settings: settings });
        console.log('[TTS] Configurações salvas');
    } catch (error) {
        console.error('[TTS] Erro ao salvar configurações:', error);
    }
}

function updateTTSStatus(message) {
    const statusEl = document.getElementById('sp_tts_status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.style.opacity = '1';
        setTimeout(() => {
            statusEl.style.opacity = '0.7';
        }, 3000);
    }
}

// Expor funções TTS
window.initTTSHandlers = initTTSHandlers;
window.loadTTSSettings = loadTTSSettings;
window.saveTTSSettings = saveTTSSettings;
